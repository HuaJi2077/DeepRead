/**
 * 对话数据管理（Pinia）
 *
 * 职责：
 * - 维护侧边栏对话历史列表（从 SQLite 加载）
 * - 维护当前对话的消息列表
 * - 发送消息时调用后端指令执行 API，并根据返回结果跳转/刷新本页
 * - assistant 回复按内容块（blocks）流式输出：
 *   页码头（header，加粗、不做流式）→ 文字块（打字机逐字）→ 图片块（到位再显示），
 *   三类块按后端给出的原文顺序依次呈现
 * - 重新打开历史会话时，图片不来自数据库（SQLite 只存文字），
 *   而是按消息记录的 pageNumber 调后端从原电子书重新提取
 *
 * 注意：对话高亮（activeChatId）仍由 App.vue 监听路由维护，
 * 这里只负责数据加载与发送动作。
 */

import { defineStore } from 'pinia'
import router from '@/router'

const API_BASE = '/api/chat'

/**
 * 流式输出节奏（模拟自然打字）：
 * - 普通字符：每字 24ms（约 40 字/秒，接近真人阅读速度）
 * - 逗号/顿号类停顿：60ms
 * - 句末标点停顿：120ms
 * 逐字停顿比「每批 N 字符固定间隔」更自然，长句读起来有呼吸感。
 */
const STREAM_DELAY_NORMAL = 24
const STREAM_DELAY_PAUSE = 60
const STREAM_DELAY_SENTENCE = 120

/** 图片块到位前的前置停顿（让文字先停一拍，再加载图片，视觉上更像「翻到」） */
const STREAM_DELAY_IMAGE = 180

/** 按字符类型返回流式停顿时间 */
function streamDelayOf(ch) {
  if ('。！？；…'.includes(ch)) return STREAM_DELAY_SENTENCE
  if ('，、：,.!?:;'.includes(ch)) return STREAM_DELAY_PAUSE
  return STREAM_DELAY_NORMAL
}

/** 块 key 发号器：每次生成 blocks 分配递增序号，用于 v-for 的 key */
let blockKeySeq = 0

/**
 * 把后端返回的 blocks 转换为前端流式展示结构：
 * - header：原文保留，立即完整显示（不流式）
 * - toc   ：目录条目列表（蓝色超链接），立即完整显示（不流式）
 * - text  ：full 存全文、text 从空开始逐字填充
 * - image ：visible=false，流式推进到该块时再置 true（到位再加载）
 * 每块带唯一 bkey：v-for 以 bkey 为 key，任何一次 blocks 整体替换都会
 * 重建 DOM（含 img 元素）——img 是新元素就必然触发 load 事件，
 * 避免复用旧元素时 src 未变导致 load 不触发、卡在「图片加载中」
 */
function toStreamBlocks(blocks) {
  return (blocks || []).map((b) => {
    const bkey = `b${blockKeySeq++}`
    if (b.type === 'header') return { type: 'header', text: b.text, bkey }
    if (b.type === 'toc') return { type: 'toc', unit: b.unit, entries: b.entries || [], bkey }
    if (b.type === 'image') {
      return { type: 'image', src: b.src, bkey, visible: false, loading: true }
    }
    return { type: 'text', full: b.text || '', text: '', bkey }
  })
}

/**
 * 历史会话用 blocks 规范化（GET /page 返回的是纯数据，无前端状态字段）：
 * - image 块：立即可见（visible），加载中（loading 直到 img @load）
 * - text  块：直接给 text 字段，模板按 text 渲染
 * 同样分配全新 bkey（理由见 toStreamBlocks）
 */
function normalizeBlocks(blocks) {
  return (blocks || []).map((b) => {
    const bkey = `b${blockKeySeq++}`
    if (b.type === 'image') return { ...b, bkey, visible: true, loading: true }
    if (b.type === 'text') return { type: 'text', text: b.text || '', bkey }
    return { ...b, bkey }
  })
}

/** 立即完成一个流式块的展示（切走会话等中断场景，保证内容完整不丢） */
function finishBlock(b) {
  if (b.type === 'text') b.text = b.full
  if (b.type === 'image') b.visible = true
}

/**
 * 从库内纯文本 content 拆出展示块（历史会话图片重建失败时的降级路径）：
 * 首行若匹配页码头格式（以《开头），作为 header 块加粗，其余作为 text 块
 * 同样分配 bkey（模板 v-for 以 bkey 为 key，不能为 undefined）
 */
function splitContentToBlocks(content) {
  const text = content || ''
  const firstLineEnd = text.indexOf('\n')
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd)
  if (firstLine.startsWith('《')) {
    const rest = firstLineEnd === -1 ? '' : text.slice(firstLineEnd).trim()
    const blocks = [{ type: 'header', text: firstLine, bkey: `b${blockKeySeq++}` }]
    if (rest) {
      blocks.push({ type: 'text', full: rest, text: rest, bkey: `b${blockKeySeq++}` })
    }
    return blocks
  }
  return [{ type: 'text', full: text, text, bkey: `b${blockKeySeq++}` }]
}

/** 历史页重建结果缓存：bookId:page -> blocks（模块级，非响应式） */
const pageBlocksCache = new Map()

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export const useChatStore = defineStore('chat', {
  state: () => ({
    chats: [],              // 侧边栏历史列表（从 SQLite 加载）
    messages: [],           // 当前对话的消息列表
    currentConversationId: null,
    activeChatId: null,     // 由 App.vue 写入；仅用于侧边栏高亮
    loading: false,         // 正在等待后端响应（对话页显示「正在加载中…」）
    loadingTool: null,      // 本次发送使用的工具（'ai'|'search'|null），加载占位按此区分提示文案
    streaming: false,       // 正在流式输出 assistant 内容
  }),

  actions: {
    /**
     * 加载全部对话列表（用于侧边栏；后端未就绪时静默失败，不阻塞界面）
     * @returns {Promise<boolean>} 加载是否成功（供调用方决定是否重试）
     */
    async loadConversations() {
      try {
        const { conversations } = await api('/conversations')
        this.chats = conversations.map((c) => ({ id: c.id, title: c.title }))
        return true
      } catch (err) {
        console.warn('[chat] 加载对话列表失败：', err.message)
        return false
      }
    },

    /**
     * 重建历史消息的展示块（含图片）
     * - 命中缓存直接返回；否则调 GET /page 从原电子书按页提取
     * - 书籍已删除/失效（404）或请求异常：降级为库内文字拆块（无图）
     */
    async rebuildBlocks(bookId, page) {
      const key = `${bookId}:${page}`
      if (pageBlocksCache.has(key)) return pageBlocksCache.get(key)
      try {
        const { blocks } = await api(`/page?bookId=${encodeURIComponent(bookId)}&page=${page}`)
        pageBlocksCache.set(key, blocks)
        return blocks
      } catch (err) {
        console.warn(`[chat] 重建第 ${page} 页内容失败：`, err.message)
        return null
      }
    },

    /**
     * 加载指定对话的消息（渐进渲染）
     *
     * 防重复加载（历史「图片一闪而过」的根因）：
     * - openChat 会先调本方法再 router.push，ChatView 挂载后的 immediate
     *   watcher 又会调一次——第二次的「文字先行」阶段会把刚渲染的图片
     *   整体抹掉，缓存命中的重建虽瞬间替换回 blocks，但若 img 元素被
     *   Vue 按 index 复用、src 未变，load 事件不再触发 → 永远停在
     *   「图片加载中...」。因此这里做两层去重：
     *   ① 同会话已有消息 → 直接跳过（已加载过，无需重复）
     *   ② 同会话加载进行中 → 跳过（并发去重）
     *
     * 渐进渲染：先按库内文字立即显示全部消息，再异步从原电子书重建
     * 含图片的 blocks 原位替换（每个图片块自带「图片加载中...」占位，
     * img @load 后消失；重建失败降级为仅显示库内文字）
     */
    async loadConversation(id) {
      // ① 已加载过同会话且消息非空：跳过（图片/流式状态保持原样）
      if (this.currentConversationId === id && this.messages.length > 0) return
      // ② 发送/流式期间同会话：跳过，避免覆盖正在展示的内容
      if ((this.streaming || this.loading) && this.currentConversationId === id) return
      // ③ 同会话加载进行中：跳过
      if (this._loadingConvId === id) return
      this._loadingConvId = id
      this.currentConversationId = id
      try {
        const { conversation, messages } = await api(`/${id}`)

        // 第一步：文字先行——库内文本立即渲染。
        // 带 blocks 列（如目录消息）的消息用持久化块恢复（含可点击目录链接），
        // 不参与第二步按 pageNumber 的页面重建（目录是「非页面内容」）
        const persistedIds = new Set()
        for (const m of messages) {
          if (m.role !== 'assistant') continue
          if (Array.isArray(m.blocks) && m.blocks.length) {
            m.blocks = normalizeBlocks(m.blocks)
            persistedIds.add(m.id)
          } else {
            m.blocks = splitContentToBlocks(m.content)
          }
        }
        if (this.currentConversationId !== id) return // 已切走，丢弃
        this.messages = messages

        // 第二步：异步重建含图片 blocks，完成后原位替换
        await Promise.all(
          messages.map(async (m) => {
            if (m.role !== 'assistant' || persistedIds.has(m.id)) return
            if (!m.pageNumber || !conversation.bookId) return
            const blocks = await this.rebuildBlocks(conversation.bookId, m.pageNumber)
            if (this.currentConversationId !== id) return // 已切走，丢弃
            if (blocks) m.blocks = normalizeBlocks(blocks)
          }),
        )

        // 同步侧边栏标题（以防后端有更新）
        const idx = this.chats.findIndex((c) => c.id === id)
        if (idx >= 0) {
          this.chats[idx].title = conversation.title
        } else {
          this.chats.unshift({ id: conversation.id, title: conversation.title })
        }
      } catch (err) {
        console.warn('[chat] 加载对话消息失败：', err.message)
      } finally {
        if (this._loadingConvId === id) this._loadingConvId = null
      }
    },

    /**
     * 发送用户输入并执行对应指令
     * @param {string} input 用户输入
     * @param {'ai'|'search'|null} tool 未定义指令的处理工具（null=提示指令错误），
     *   由 ui.send() 依据输入框左下角开关传入；目录链接跳转等内部调用缺省 null
     *
     * 流程（先进入对话页，再流式输出）：
     * 1. 若在主页发送：先调 POST /conversations 预创建对话拿到 id，
     *    立即跳转到对话页——加载提示显示在对话页，主页不再出现加载状态
     * 2. 对话页本地追加临时 user 消息 + loading 占位
     * 3. 请求后端执行指令（后端已把 user/assistant 完整消息写入 SQLite）
     * 4. 用真实记录替换临时消息，assistant 挂载 blocks 开始流式输出：
     *    header 立即完整显示 → 文字逐字输出 → 图片推进到位置再显示
     * 5. 流式期间用户切走会话：立即补全当前消息并停止，不产生跨会话渲染
     */
    async sendMessage(input, tool = null) {
      if (!input.trim() || this.loading || this.streaming) return

      const trimmedInput = input.trim()
      const tempUserId = `temp-user-${Date.now()}`

      this.loading = true
      this.loadingTool = tool
      try {
        // 主页发送：预创建对话并立即进入对话页（加载提示只出现在对话页）
        if (!this.currentConversationId) {
          const created = await api('/conversations', { method: 'POST' })
          this.currentConversationId = created.conversationId
          this.messages = [] // 新对话从空开始（清掉上一对话的残留消息）
          this.chats.unshift({ id: created.conversationId, title: created.title })
        }
        const convId = this.currentConversationId
        if (router.currentRoute.value.params.id !== convId) {
          await router.push(`/chat/${convId}`)
        }

        // 立即显示用户消息与加载占位（真实记录返回后替换）
        this.messages.push({
          id: tempUserId,
          role: 'user',
          content: trimmedInput,
        })

        const result = await api('/execute', {
          method: 'POST',
          body: { input: trimmedInput, conversationId: convId, tool },
        })

        // 后端返回的消息列表最后两条即本次的 user / assistant 记录
        const realUserMsg = result.messages[result.messages.length - 2]
        const realAssistantMsg = result.messages[result.messages.length - 1]

        // 替换临时 user 为真实记录；assistant 挂 blocks 从空开始流式
        this.messages = this.messages.filter((m) => m.id !== tempUserId)
        if (realUserMsg) this.messages.push(realUserMsg)
        this.messages.push({
          ...realAssistantMsg,
          blocks: toStreamBlocks(result.blocks?.length ? result.blocks : null),
        })
        // 注意：必须取数组内的元素作为流式目标——Pinia state 中的对象是
        // reactive 代理，直接修改 push 前的原始对象不会触发视图更新。
        const streamMsg = this.messages[this.messages.length - 1]
        // 兜底：后端未返回 blocks（异常情况）时降级为纯文本流式
        if (!streamMsg.blocks.length && streamMsg.content) {
          streamMsg.blocks = toStreamBlocks([{ type: 'text', text: streamMsg.content }])
        }

        this.loading = false
        this.currentConversationId = result.conversationId

        // 同步侧边栏（新对话置顶 / 已有对话更新标题）
        const idx = this.chats.findIndex((c) => c.id === result.conversationId)
        if (idx >= 0) {
          this.chats[idx].title = result.title
        } else {
          this.chats.unshift({ id: result.conversationId, title: result.title })
        }

        // 按块顺序流式输出：header 立即 → 文字逐字 → 图片到位再显示
        await this.streamBlocks(result.conversationId, streamMsg)
      } catch (err) {
        // 请求失败：移除临时 user 消息，并显示错误提示
        this.messages = this.messages.filter((m) => m.id !== tempUserId)
        this.messages.push({
          id: `temp-err-${Date.now()}`,
          role: 'assistant',
          blocks: splitContentToBlocks(`请求失败：${err.message}`),
        })
      } finally {
        this.loading = false
        this.loadingTool = null
        this.streaming = false
      }
    },

    /**
     * 按块顺序流式渲染 assistant 消息
     * - header 块立即完整显示（加粗标题不做打字机效果）
     * - text 块逐字填充，标点处自然停顿
     * - image 块推进到位置时才置 visible（到位再加载，防止图片先于前文出现）
     * - 每步检查会话是否已被切走：切走则一次性补全剩余内容并返回，
     *   避免向已切换的会话数组继续渲染（历史「图片卡在底部」的根因之一）
     */
    async streamBlocks(convId, msg) {
      this.streaming = true
      try {
        for (const block of msg.blocks) {
          if (this.currentConversationId !== convId) {
            msg.blocks.forEach(finishBlock)
            return
          }
          if (block.type === 'header' || block.type === 'toc') {
            continue // header / 目录链接已完整挂载，直接显示（不打字机）
          }
          if (block.type === 'image') {
            await new Promise((r) => setTimeout(r, STREAM_DELAY_IMAGE))
            block.visible = true
            continue
          }
          // text 块：打字机逐字填充
          block.text = ''
          for (const ch of block.full) {
            if (this.currentConversationId !== convId) {
              msg.blocks.forEach(finishBlock)
              return
            }
            block.text += ch
            await new Promise((r) => setTimeout(r, streamDelayOf(ch)))
          }
          block.text = block.full
        }
      } finally {
        this.streaming = false
      }
    },

    /** 打开指定对话 */
    async openChat(id) {
      await this.loadConversation(id)
      await router.push(`/chat/${id}`)
    },

    /**
     * 重命名对话（侧边栏三点菜单）
     * 本地即时更新，失败时回滚并提示
     */
    async renameChat(id, title) {
      const chat = this.chats.find((c) => c.id === id)
      if (!chat) return
      const oldTitle = chat.title
      chat.title = title
      try {
        await api(`/${id}`, { method: 'PATCH', body: { title } })
      } catch (err) {
        chat.title = oldTitle
        console.error('[chat] 重命名失败：', err.message)
        throw err
      }
    },

    /**
     * 删除对话（侧边栏三点菜单）
     * 本地即时移除；若删除的是当前打开的对话，同时清空消息并回主页
     */
    async deleteChat(id) {
      try {
        await api(`/${id}`, { method: 'DELETE' })
        this.chats = this.chats.filter((c) => c.id !== id)
        if (this.currentConversationId === id) {
          this.currentConversationId = null
          this.messages = []
          if (router.currentRoute.value.params.id === id) {
            await router.push('/')
          }
        }
      } catch (err) {
        console.error('[chat] 删除对话失败：', err.message)
        throw err
      }
    },

    /** 开启新对话：清空当前状态并回到主页 */
    newChat() {
      this.currentConversationId = null
      this.messages = []
      this.activeChatId = null
      router.push('/')
    },

    /** 重置当前高亮（App.vue 的 watch 会进一步同步 activeChatId） */
    resetActive() {
      this.activeChatId = null
      this.currentConversationId = null
      this.messages = []
    },
  },
})
