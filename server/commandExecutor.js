/**
 * 指令执行器
 *
 * 负责：
 * 1. 加载 data/commands.json 中的指令配置
 * 2. 将用户输入文本匹配到对应指令 action
 * 3. 执行动作并返回结果，同时把 user/assistant 消息写入 SQLite
 *
 * 解耦设计：
 * - commands.json 只定义「输入指令 ↔ 执行动作」的映射，不包含业务逻辑
 * - commandExecutor.js 负责 action 的实现，便于后续扩展新动作
 * - chatStore.js 只负责数据持久化，不关心指令含义
 */

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'
import { readShelf } from './shelfStore.js'
import {
  createConversation,
  getConversation,
  updateConversation,
  addMessage,
  getMessages,
} from './chatStore.js'
import { extractPage, getTotalPages, getToc } from './bookReader.js'
import { askAI } from './tools/aiClient.js'
import { searchWiki } from './tools/wikiSearch.js'
import { formatPageHeader } from '../src/utils/reading.js'

const COMMANDS_FILE = path.join(DATA_DIR, 'commands.json')

/** 加载指令配置 */
function loadCommands() {
  try {
    const raw = fs.readFileSync(COMMANDS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

/**
 * 匹配用户输入到指令
 * - OPEN_BOOK 为严格前缀指令：必须以「开始阅读」开头，后跟可选冒号与书名
 * - JUMP_TO  为严格前缀指令：必须以「跳转」开头，后跟可选冒号与章节名/页码
 * - 其余指令（NEXT_PAGE / PREV_PAGE / VIEW_TOC 等）为包含匹配
 */
function matchCommand(input) {
  const commands = loadCommands()
  const text = input.trim()
  const lowerText = text.toLowerCase()

  // 优先处理「开始阅读」类指令：必须以该前缀开头
  if (lowerText.startsWith('开始阅读')) {
    const openBookCmd = commands.find((c) => c.action === 'OPEN_BOOK')
    if (openBookCmd) return openBookCmd
  }

  // 「跳转」类指令：同样以该前缀开头（避免与包含「跳转」二字的普通闲聊误触）
  if (text.startsWith('跳转')) {
    const jumpCmd = commands.find((c) => c.action === 'JUMP_TO')
    if (jumpCmd) return jumpCmd
  }

  // 其余指令使用包含匹配
  for (const cmd of commands) {
    if (!cmd.patterns || !cmd.action) continue
    if (cmd.action === 'OPEN_BOOK' || cmd.action === 'JUMP_TO') continue // 已单独处理
    for (const pattern of cmd.patterns) {
      if (lowerText.includes(pattern.toLowerCase())) {
        return cmd
      }
    }
  }
  return null
}

/**
 * 校验「开始阅读」指令格式是否正确
 * 正确格式："开始阅读" + 可选冒号（中文「：」或英文「:」）+ 非空书名，
 * 即「开始阅读：书名」「开始阅读:书名」「开始阅读书名」均可
 */
function isValidOpenBookInput(input) {
  const text = input.trim()
  if (!text.startsWith('开始阅读')) return false
  return extractBookTitle(text).length > 0
}

/**
 * 从用户输入中提取书名
 * 冒号可省略：紧跟前缀的书名同样有效
 */
function extractBookTitle(input) {
  const rest = input.trim().slice(4) // 去掉「开始阅读」
  return rest.replace(/^[:：]/, '').trim()
}

/**
 * 从「跳转」指令中提取跳转目标（章节名或页码数字）
 * 「跳转：第一章」「跳转:第一章」「跳转第一章」→「第一章」
 */
function extractJumpTarget(input) {
  const rest = input.trim().slice(2) // 去掉「跳转」
  return rest.replace(/^[\s:：]+/, '').trim()
}

/**
 * 根据关键词在书架中查找书籍
 * 匹配规则：
 * 1. 优先精确匹配（书名完全相等），避免「局外人」误命中「局外人（注释版）」
 * 2. 无精确匹配时退化为包含匹配
 * @returns {{ matches: Object[] }} 命中的书籍数组（调用方按数量决定行为：
 *   0 → 没有这本书；>1 → 有书籍同名；=1 → 正常打开）
 */
function findBooksByKeyword(keyword) {
  const books = readShelf().filter((b) => !b.invalid)
  const exact = books.filter((b) => b.title === keyword)
  if (exact.length > 0) return { matches: exact }
  const lower = keyword.toLowerCase()
  return { matches: books.filter((b) => b.title.toLowerCase().includes(lower)) }
}

/**
 * 组装 assistant 回复（页码头 + 内容块）
 * - blocks：发给前端的展示序列，首块为加粗页码头（header），其后为按序的文字/图片块
 * - content：写入 SQLite 的纯文本（页码头 + 全部文字块，图片不入库——
 *   历史会话由前端按 pageNumber 从原电子书重新提取图片）
 * 页码头格式由共享工具统一生成（src/utils/reading.js），EPUB 单位为「章」
 */
function buildPagePayload(book, pageNum, totalPages, blocks) {
  const unit = book.format === 'epub' ? '章' : '页'
  const header = formatPageHeader(book.title, pageNum, totalPages, unit)
  const bodyText = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
  const content = bodyText ? `${header}\n\n${bodyText}` : header
  return { content, blocks: [{ type: 'header', text: header }, ...blocks] }
}

/**
 * 执行用户输入的指令
 * @param {string} input 用户输入文本
 * @param {string|null} conversationId 当前对话 id（无则新建）
 * @param {'ai'|'search'|null} tool 未定义指令的处理工具（输入框左下角开关，
 *   两者互斥）：'ai'=发送给 AI 提问，'search'=发送给 Wiki 搜索，null=提示指令错误
 * @returns {Promise<Object>} { conversationId, title, role: 'assistant', content, bookId, pageNumber, messages }
 */
export async function executeCommand(input, conversationId = null, tool = null) {
  const command = matchCommand(input)
  const text = input.trim()

  // 「开始阅读」类指令：格式错误时直接返回「指令错误」
  if (text.toLowerCase().startsWith('开始阅读')) {
    if (!command || command.action !== 'OPEN_BOOK' || !isValidOpenBookInput(text)) {
      const reply = '指令错误'
      const conv = ensureConversation(conversationId, '新对话')
      addMessage(conv.id, 'user', input)
      addMessage(conv.id, 'assistant', reply)
      return buildResponse(conv, reply)
    }

    // 格式正确：提取书名并在书架中查找
    const title = extractBookTitle(text)
    const { matches } = findBooksByKeyword(title)

    // 未找到任何匹配
    if (matches.length === 0) {
      const reply = '没有这本书'
      const conv = ensureConversation(conversationId, '新对话')
      addMessage(conv.id, 'user', input)
      addMessage(conv.id, 'assistant', reply)
      return buildResponse(conv, reply)
    }

    // 多本同名/同关键词书籍：无法确定读哪本，提示用户先去书架改名
    if (matches.length > 1) {
      const reply = `有书籍同名，请先改名（共找到 ${matches.length} 本《${title}》相关书籍，请先在「我的书架」中重命名以区分）`
      const conv = ensureConversation(conversationId, '新对话')
      addMessage(conv.id, 'user', input)
      addMessage(conv.id, 'assistant', reply)
      return buildResponse(conv, reply)
    }

    const book = matches[0]

    // 以书名为对话标题；如果是新对话则创建，否则复用当前对话
    const conv = ensureConversation(conversationId, book.title, book.id)
    if (conv.title !== book.title || conv.bookId !== book.id) {
      updateConversation(conv.id, { title: book.title, bookId: book.id, pageNumber: 1 })
      // 同步本地快照：buildResponse 以 conv.title 返回给前端，
      // 旧值会让侧边栏/顶栏停留在「新对话」而不是书名
      conv.title = book.title
      conv.bookId = book.id
    }
    addMessage(conv.id, 'user', input)

    const { blocks, totalPages } = await extractPage(book, 1)
    updateConversation(conv.id, { pageNumber: 1 })
    const { content, blocks: replyBlocks } = buildPagePayload(book, 1, totalPages, blocks)
    addMessage(conv.id, 'assistant', content, 1)
    return buildResponse(conv, content, book.id, 1, replyBlocks)
  }

  // 未识别指令 → 按所选工具分流（AI 提问 / Wiki 搜索 / 都未选则提示指令错误）。
  // 工具内部异常不致命：捕获后把错误信息作为回复返回，对话仍正常落库
  if (!command) {
    const conv = ensureConversation(conversationId, '新对话')
    addMessage(conv.id, 'user', input)
    let reply
    if (tool === 'ai') {
      try {
        reply = await askAI(text)
      } catch (err) {
        reply = `AI 功能出错：${err.message}`
      }
    } else if (tool === 'search') {
      try {
        reply = await searchWiki(text)
      } catch (err) {
        reply = `搜索失败：${err.message}`
      }
    } else {
      reply = '指令错误'
    }
    addMessage(conv.id, 'assistant', reply)
    return buildResponse(conv, reply)
  }

  const action = command.action

  // 彩蛋指令：无需关联书籍，直接输出彩蛋图片。
  // 图片走静态路由 /data/easter-egg.png（见 staticServe.js），blocks 持久化
  // 到 messages.blocks——否则重进会话时无 pageNumber 可重建，图片会丢失
  if (action === 'EASTER_EGG') {
    // 仅「一上来就触发」（对话尚无任何消息）命名为「彩蛋」；
    // 已有内容的对话保持原名，不因触发彩蛋被强制改名
    const existed = conversationId ? getConversation(conversationId) : null
    const conv = ensureConversation(conversationId, '彩蛋')
    if (existed && getMessages(existed.id).length === 0 && conv.title !== '彩蛋') {
      updateConversation(conv.id, { title: '彩蛋' })
      conv.title = '彩蛋'
    }
    addMessage(conv.id, 'user', input)
    const content = '彩蛋'
    const replyBlocks = [{ type: 'image', src: '/data/easter-egg.png' }]
    addMessage(conv.id, 'assistant', content, null, replyBlocks)
    return buildResponse(conv, content, conv.bookId, null, replyBlocks)
  }

  // 翻页类指令：必须有已关联书籍的对话
  const conv = conversationId ? getConversation(conversationId) : null
  if (!conv || !conv.bookId) {
    const fallback = ensureConversation(conversationId, '新对话')
    addMessage(fallback.id, 'user', input)
    const reply = '请先输入「开始阅读：书名」开始阅读。'
    addMessage(fallback.id, 'assistant', reply)
    return buildResponse(fallback, reply)
  }

  const books = readShelf()
  const book = books.find((b) => b.id === conv.bookId && !b.invalid)
  if (!book) {
    addMessage(conv.id, 'user', input)
    const reply = '当前对话关联的电子书已失效，请重新输入书名。'
    addMessage(conv.id, 'assistant', reply)
    return buildResponse(conv, reply)
  }

  // 目录指令：展示当前书籍的目录（页码头特殊为「查看书籍的目录」，
  // 仍作为 header 块返回 → 前端右侧章节导航可记录并跳转到该消息）；
  // 不改页码，无目录输出「此书籍没有目录」。
  // 目录块（type: 'toc'）持久化到 messages.blocks：目录是「非页面内容」，
  // 历史重建若按 pageNumber 提取会把目录消息错换成该页正文
  if (action === 'VIEW_TOC') {
    const toc = await getToc(book)
    addMessage(conv.id, 'user', input)
    const header = '查看书籍的目录'
    const pageNumber = conv.pageNumber || 1

    if (!toc.length) {
      const reply = '此书籍没有目录'
      addMessage(conv.id, 'assistant', reply, pageNumber)
      return buildResponse(conv, reply, conv.bookId, pageNumber)
    }

    const unit = book.format === 'epub' ? '章' : '页'
    const tocText = toc
      .map((t, i) => `${i + 1}. ${t.title}${t.page ? `（第 ${t.page} ${unit}）` : ''}`)
      .join('\n')
    const content = `${header}\n\n${tocText}`
    const replyBlocks = [
      { type: 'header', text: header },
      {
        type: 'toc',
        unit,
        // 前端渲染为蓝色超链接，点击自动发送「跳转：标题」
        entries: toc.map((t) => ({ title: t.title, page: t.page })),
      },
    ]
    addMessage(conv.id, 'assistant', content, pageNumber, replyBlocks)
    return buildResponse(conv, content, conv.bookId, pageNumber, replyBlocks)
  }

  // 跳转指令：目标为章节名（在目录中匹配）或页码数字，直接定位并输出该页内容。
  // 回复仍是标准页码头《XXX》第 X / X 章 已读：X% → 右侧章节导航自动记录，
  // 已读百分比随目标页码变化
  if (action === 'JUMP_TO') {
    const target = extractJumpTarget(text)
    addMessage(conv.id, 'user', input)
    const totalPages = await getTotalPages(book)
    const unit = book.format === 'epub' ? '章' : '页'

    const fail = (reply) => {
      addMessage(conv.id, 'assistant', reply)
      return buildResponse(conv, reply)
    }

    if (!target) return fail('指令错误')

    // 目标解析：纯数字 = 页码直跳；否则在目录中按标题匹配（精确优先，包含兜底）
    let targetPage = null
    if (/^\d+$/.test(target)) {
      targetPage = parseInt(target, 10)
    } else {
      const toc = await getToc(book)
      if (!toc.length) return fail('此书籍没有目录，无法跳转')
      const hit = toc.find((t) => t.title === target) || toc.find((t) => t.title.includes(target))
      if (!hit || !hit.page) {
        return fail(`目录中没有找到「${target}」，请输入「目录」查看可跳转的章节`)
      }
      targetPage = hit.page
    }

    if (targetPage < 1 || targetPage > totalPages) {
      return fail(`没有第 ${targetPage} ${unit}，本书共 ${totalPages} ${unit}`)
    }

    const { blocks } = await extractPage(book, targetPage)
    updateConversation(conv.id, { pageNumber: targetPage })
    const { content, blocks: replyBlocks } = buildPagePayload(book, targetPage, totalPages, blocks)
    addMessage(conv.id, 'assistant', content, targetPage)
    return buildResponse(conv, content, conv.bookId, targetPage, replyBlocks)
  }

  // 计算目标页码（先做边界检查：第一页再往前 / 最后一页再往后 → 直接提示，不翻页）
  const totalPages = await getTotalPages(book)
  const currentPage = conv.pageNumber || 1

  if (action === 'NEXT_PAGE' && currentPage >= totalPages) {
    addMessage(conv.id, 'user', input)
    const reply = '已是最后一页'
    addMessage(conv.id, 'assistant', reply)
    return buildResponse(conv, reply)
  }
  if (action === 'PREV_PAGE' && currentPage <= 1) {
    addMessage(conv.id, 'user', input)
    const reply = '已是第一页'
    addMessage(conv.id, 'assistant', reply)
    return buildResponse(conv, reply)
  }

  let targetPage = currentPage
  if (action === 'NEXT_PAGE') targetPage = Math.min(totalPages, targetPage + 1)
  if (action === 'PREV_PAGE') targetPage = Math.max(1, targetPage - 1)

  addMessage(conv.id, 'user', input)
  const { blocks } = await extractPage(book, targetPage)
  updateConversation(conv.id, { pageNumber: targetPage })
  const { content, blocks: replyBlocks } = buildPagePayload(book, targetPage, totalPages, blocks)
  addMessage(conv.id, 'assistant', content, targetPage)
  return buildResponse(conv, content, conv.bookId, targetPage, replyBlocks)
}

/** 获取或创建对话 */
function ensureConversation(id, defaultTitle, bookId = null) {
  if (id) {
    const existing = getConversation(id)
    if (existing) return existing
  }
  return createConversation(defaultTitle, bookId)
}

function buildResponse(conv, content, bookId = null, pageNumber = 1, blocks = []) {
  return {
    conversationId: conv.id,
    title: conv.title,
    role: 'assistant',
    content,
    blocks,
    bookId: bookId ?? conv.bookId,
    pageNumber,
    messages: getMessages(conv.id),
  }
}
