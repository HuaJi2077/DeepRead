<script setup>
// 动态对话页：对应路由 /chat/:id（见 src/router/index.js）
// - 标题与消息均来自 SQLite：进入页面时按 :id 加载对话及消息列表
// - 用户在输入框发送指令后，chat store 调用后端执行并自动跳转/刷新本页
// - 消息渲染复用原站样式类（用户气泡 ._9663006 / 助手回答 ._4f9bf79），
//   字体、颜色、间距与全局样式 ui.css 保持一致

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import ChatInput from '@/components/ChatInput.vue'
import ToastTip from '@/components/ToastTip.vue'
import HelpButton from '@/components/HelpButton.vue'

// 顶部标题栏与消息操作使用的 SVG 图标（图标已去重：复制/分享为消息与回答共用）
// 新对话与侧边栏共用同一文件（new-chat），顶部 20px 场景用 .icon-20 控制尺寸
import iconMenuToggle from '@/assets/icons/header-menu.svg?raw'
import iconNewChat from '@/assets/icons/new-chat.svg?raw'
import iconZap from '@/assets/icons/zap.svg?raw'
import iconShare from '@/assets/icons/share.svg?raw'
import iconCopy from '@/assets/icons/copy.svg?raw'
import iconMsgEdit from '@/assets/icons/message-edit.svg?raw'
import iconAnsRegenerate from '@/assets/icons/answer-regenerate.svg?raw'
import iconAnsLike from '@/assets/icons/answer-like.svg?raw'
import iconAnsDislike from '@/assets/icons/answer-dislike.svg?raw'
import iconChevronDown from '@/assets/icons/chevron-down.svg?raw'

const ui = useUiStore()          // 界面状态（模式标签/侧边栏折叠）
const chatStore = useChatStore() // 对话数据（历史列表与当前消息）
const settings = useSettingsStore() // 用户设置（记忆阅读进度 → 打开对话的滚动位置）
const route = useRoute()

// 当前对话 id（来自动态路由 /chat/:id）
// 注意：侧边栏高亮（chatStore.activeChatId）统一由 App.vue 监听路由维护，
// 此处不要反向写回——路由切换是异步的，组件内同步写回会在
// 「开启新对话」清空高亮后把旧 id 又写回去，造成需要点两次才取消高亮。
const chatId = computed(() => route.params.id)

// 监听路由 id 变化，加载对应对话消息
// 加载期间隐藏消息区（visibility），滚动定位到最底部后再显示——
// 避免「先在顶部渲染一瞬、再瞬移到底部」的跳变观感；
// 同时开强制贴底窗口：历史图片异步重建/加载会持续撑高内容，
// 高度每次变化都重新贴底，杜绝「先看到图片再跳底」
const listEntering = ref(false)

watch(
  chatId,
  async (id) => {
    if (!id) return
    listEntering.value = true
    // 设置可能尚未加载完成（App 启动竞态）：等一拍，避免用默认值误判滚动位置
    if (!settings.loaded) await settings.load()
    await chatStore.loadConversation(id)
    // 记忆阅读进度开 → 定位最底部（直接看最新回复，并开强制贴底跟随图片重建）；
    // 关 → 从最顶部开始（从头阅读），不开贴底窗口，否则图片异步撑高会被拖回底部
    const toTop = !settings.rememberProgress
    // 强制贴底窗口须在 await 之后开启：forceFollowUntil 在下方才声明，
    // 同步阶段（首个 await 前）赋值会触发 TDZ 引用错误
    if (!toTop) forceFollowUntil = Date.now() + 2500
    await nextTick()
    const snap = toTop ? snapToTop : snapToBottom
    snap()
    // 历史图片为异步重建/加载，到位后内容高度继续增长（由 ResizeObserver 跟随）；
    // 首帧校准完成后再显示列表（rAF 回调在本轮渲染后执行）
    requestAnimationFrame(() => {
      snap()
      listEntering.value = false
    })
    setTimeout(snap, 300)
  },
  { immediate: true },
)

// 模式文案映射
const modes = { default: '对话模式', expert: '阅读模式', vision: '我的书架' }
const currentModeLabel = computed(() => modes[ui.mode] || modes.default)

// 对话标题：优先从当前消息对应的对话题目；未加载时回退「新对话」
const chatTitle = computed(() => {
  const conv = chatStore.chats.find((c) => c.id === chatId.value)
  return conv ? conv.title : '新对话'
})

// 加载占位文案：按发送时所选工具区分（AI → 思考中 / 搜索 → 搜索中）
const loadingTip = computed(() => {
  if (chatStore.loadingTool === 'ai') return 'AI正在思考...'
  if (chatStore.loadingTool === 'search') return '正在搜索中...'
  return '正在加载中…'
})

/* 正文 URL 自动转超链接（Wiki 搜索结果等）：
   按 URL 切分文本，非 URL 段保持纯文本换行原样。
   历史消息（库中存的是纯文本）经此同样获得可点链接 */
const URL_RE = /(https?:\/\/[^\s]+)/g

function splitWithLinks(text) {
  return String(text).split(URL_RE).map((seg, i) => ({
    text: seg,
    isUrl: i % 2 === 1,
  }))
}

// 助手消息操作条图标（重新生成/点赞/点踩/分享，与原站顺序一致；
// 复制为首个操作，需绑定复制逻辑，单独渲染不进本数组）
const ansActions = [iconAnsRegenerate, iconAnsLike, iconAnsDislike, iconShare]

/* ---------- 居中提示（ToastTip）：复制结果反馈 ---------- */
const toastMsg = ref('')
let toastTimer = null

function showToast(msg) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 1500)
}

/* ---------- 消息复制（用户/助手消息操作条的复制按钮） ---------- */

/** 取消息中已成功加载的图片块（流式中未到位/加载失败的不参与复制） */
function visibleImages(msg) {
  return (msg.blocks || []).filter(
    (b) => b.type === 'image' && b.visible !== false && !b.failed,
  )
}

/** 图片源 → PNG Blob（剪贴板仅稳定支持 image/png，其余格式经 canvas 转码） */
async function toPngBlob(src) {
  const res = await fetch(src)
  const blob = await res.blob()
  if (blob.type === 'image/png') return blob
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  canvas.getContext('2d').drawImage(bmp, 0, 0)
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('转码失败'))), 'image/png'),
  )
}

/**
 * 复制用文本：剔除标题行（页码头《XXX》第 X / X 页 已读：X% 与目录标题「查看书籍的目录」均不复制）
 * - 有 blocks：只取文字块，页码头（header）/ 目录链接（toc）与图片均不参与
 * - 无 blocks（用户消息/旧数据）：按 content 降级，剔除首行标题（若有 header 块）
 */
function copyableText(msg) {
  const blocks = msg.blocks || []
  const texts = blocks.filter((b) => b.type === 'text' && b.text).map((b) => b.text)
  if (texts.length) return texts.join('\n\n')
  const content = msg.content || ''
  const firstLineEnd = content.indexOf('\n')
  const hasHeader = blocks.some((b) => b.type === 'header')
  if (hasHeader) {
    return firstLineEnd === -1 ? '' : content.slice(firstLineEnd).trim()
  }
  const firstLine = firstLineEnd === -1 ? content : content.slice(0, firstLineEnd)
  if (firstLine.startsWith('《')) {
    return firstLineEnd === -1 ? '' : content.slice(firstLineEnd).trim()
  }
  return content
}

/**
 * 复制一条消息：
 * - 纯文本消息（用户消息/无图回复）→ 文本写入剪贴板
 * - 含图片消息 → 首张图片转 PNG 写入剪贴板（文本一并写入）；
 *   图片无法进剪贴板（源失效/格式转码失败/浏览器不支持）时提示「图片无法复制」
 */
async function copyMessage(msg) {
  const text = copyableText(msg)
  const images = visibleImages(msg)

  if (!images.length) {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制')
    } catch {
      showToast('复制失败')
    }
    return
  }

  try {
    const png = await toPngBlob(images[0].src)
    // 两种类型必须放进同一个 ClipboardItem：Chrome 不支持多个 ClipboardItem
    //（"Support for multiple ClipboardItems is not implemented"），图片与文本
    // 合并写入后剪贴板同时携带两个 flavor
    const payload = { 'image/png': png }
    if (text) payload['text/plain'] = new Blob([text], { type: 'text/plain' })
    await navigator.clipboard.write([new ClipboardItem(payload)])
    showToast('已复制')
  } catch {
    // 图片进不了剪贴板：文本仍尽力复制，同时提示图片无法复制
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      /* 兜底失败不再叠加提示 */
    }
    showToast('图片无法复制')
  }
}

/* ---------- 目录消息：点击章节链接自动发送「跳转：章节名」 ---------- */

/**
 * 点击目录条目 → 等同于用户输入「跳转：XXX」发送
 * （后端按目录标题定位页码并输出该页内容，右侧导航自动记录新页码头）
 */
function sendJumpCommand(title) {
  if (!title) return
  chatStore.sendMessage(`跳转：${title}`)
}

// 原站由 JS 实测写入的内联变量：--container-height / --dsl-virtual-list-width
// 这里同样按当前容器实测，保证滚动区与渐变遮罩尺寸一致
const listEl = ref(null)
const containerHeight = ref(540)
const listWidth = ref(910)

function measureList() {
  const el = listEl.value
  if (!el) return
  containerHeight.value = el.offsetHeight
  listWidth.value = el.offsetWidth
}

// ===== 滚动位置跟踪：回到底部按钮的显隐 =====
// 距底部不足 80px 视为「已在底部」；消息加载/流式增长后内容变高，
// 重新判定一次（rAF 等待本轮布局更新完成）
const atBottom = ref(true)

function updateAtBottom() {
  const el = listEl.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

function scrollToBottom() {
  const el = listEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

/** 立即跳到列表最底部（无平滑动画，用于进入会话的初始定位） */
function snapToBottom() {
  const el = listEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
  updateAtBottom()
}

/** 立即跳到列表最顶部（记忆阅读进度关闭时，进入会话从头开始看） */
function snapToTop() {
  const el = listEl.value
  if (!el) return
  el.scrollTop = 0
  updateAtBottom()
}

/* ---------- 底部跟随：进入会话 / 发送消息 / 流式输出 / 图片加载 ----------
 * 问题背景：进入会话后内容高度会持续变化（历史图片异步重建撑高、
 * 流式逐字增长、图片加载完成替换占位），只做几次定时 snap 会
 * 「先看到旧位置再跳底」，观感突兀。
 * 方案：ResizeObserver 监听内容区高度变化——
 * - 强制窗口期内（进入会话 / 刚发送消息）一律贴底
 * - 平时仅当已处于底部（跟随模式）才贴底；用户主动滚动立即解除强制
 */
let forceFollowUntil = 0
let contentObserver = null

function cancelForceFollow() {
  forceFollowUntil = 0
}

/** 内容高度变化时的贴底策略：窗口期内强制贴底，否则仅跟随模式下贴底 */
function followIfNearBottom() {
  if (Date.now() < forceFollowUntil || atBottom.value) snapToBottom()
}

/** 图片加载完成：先解除 loading 再下一帧贴底（v-show 生效后高度才变化） */
function onImageLoaded(block) {
  block.loading = false
  requestAnimationFrame(followIfNearBottom)
}

watch(
  () => chatStore.messages.length,
  (len, oldLen) => {
    // 新发送的用户消息：开强制贴底窗口（新回复从底部开始流式输出）
    if (len > (oldLen ?? 0) && chatStore.messages[len - 1]?.role === 'user') {
      forceFollowUntil = Date.now() + 1500
      requestAnimationFrame(snapToBottom)
    }
    requestAnimationFrame(() => {
      updateAtBottom()
      updateCurrentToc()
    })
    // 虚拟列表测量/渲染在 rAF 之后才完成，延迟补算一次初始高亮
    setTimeout(updateCurrentToc, 250)
  },
)

// ===== 右侧章节导航：汇总各助手消息的页码头（header 块） =====
// 文案形如《书名》第 X / X 章 已读：X%，取每条助手消息的第一个 header 块
const tocItems = computed(() => {
  const items = []
  chatStore.messages.forEach((msg, index) => {
    if (msg.role !== 'assistant') return
    const header = (msg.blocks || []).find((b) => b.type === 'header' && b.text)
    if (header) items.push({ index, text: header.text })
  })
  return items
})

// 当前定位章节（折叠态蓝色圆点）：滚动时取判定线（视口上 1/3）越过
// 的最后一个章节消息；全部在其上方之前为 -1（无高亮）
const currentTocIndex = ref(-1)

function updateCurrentToc() {
  const list = listEl.value
  const items = tocItems.value
  if (!list || !items.length) {
    currentTocIndex.value = -1
    return
  }
  const listTop = list.getBoundingClientRect().top
  const probe = list.scrollTop + list.clientHeight / 3
  let current = -1
  let foundAny = false
  items.forEach((item) => {
    const target = list.querySelector(`[data-virtual-list-item-key="${item.index}"]`)
    if (!target) return
    foundAny = true
    if (target.getBoundingClientRect().top - listTop + list.scrollTop <= probe) {
      current = item.index
    }
  })
  // 目标元素全未渲染（虚拟列表尚未挂载/测量）时保留旧值，避免误清高亮
  if (foundAny) currentTocIndex.value = current
}

// 点击章节条目：滚动到对应消息（header 所在元素）的顶部
function jumpToChapter(index) {
  const list = listEl.value
  const target = list?.querySelector(`[data-virtual-list-item-key="${index}"]`)
  if (!list || !target) return
  const top =
    target.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - 12
  list.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
}

function onWindowResize() {
  measureList()
  updateAtBottom()
}

function onListScroll() {
  updateAtBottom()
  updateCurrentToc()
}

onMounted(() => {
  measureList()
  updateAtBottom()
  requestAnimationFrame(updateCurrentToc)
  document.fonts?.ready.then(measureList)
  window.addEventListener('resize', onWindowResize)
  listEl.value?.addEventListener('scroll', onListScroll, { passive: true })
  // 内容区高度变化（流式逐字 / 图片加载 / 历史重建）→ 按跟随策略贴底
  const itemsEl = listEl.value?.querySelector('.ds-virtual-list-items')
  if (itemsEl && typeof ResizeObserver !== 'undefined') {
    contentObserver = new ResizeObserver(followIfNearBottom)
    contentObserver.observe(itemsEl)
  }
  // 用户主动滚动（滚轮/触摸/按键）解除强制贴底，尊重浏览位置
  listEl.value?.addEventListener('wheel', cancelForceFollow, { passive: true })
  listEl.value?.addEventListener('touchmove', cancelForceFollow, { passive: true })
  listEl.value?.addEventListener('keydown', cancelForceFollow)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onWindowResize)
  listEl.value?.removeEventListener('scroll', onListScroll)
  contentObserver?.disconnect()
  contentObserver = null
  listEl.value?.removeEventListener('wheel', cancelForceFollow)
  listEl.value?.removeEventListener('touchmove', cancelForceFollow)
  listEl.value?.removeEventListener('keydown', cancelForceFollow)
})
</script>

<template>
  <!-- 对话页外层容器 -->
  <div class="_7780f2e">
    <div class="_765a5cd">
      <div class="_2be88ba">
        <!-- 顶部 header：左侧标题与模式标签 -->
        <div class="f8d1e4c0 the-header">
          <div class="_9fcbeda" :class="{ _7ee190f: !ui.sidebarCollapsed }">
            <!-- 对话标题 -->
            <div class="afa34042 e0a1edb7 e37a04e4 _5a50d80" tabindex="0" style="outline: none;">
              {{ chatTitle }}
            </div>
            <!-- 当前模式标签 -->
            <div class="c03d486a">
              <div class="ds-icon a1ac5b47" style="font-size: 12px; width: 12px; height: 12px;" v-html="iconZap"></div>
              <span class="_46a12ab">{{ currentModeLabel }}</span>
            </div>
          </div>
        </div>

        <!-- 顶部 header：右侧操作按钮（padding-right 为右上角固定帮助按钮让位） -->
        <div class="_1aa2651 the-header" style="padding-right: 58px;">
          <!-- 打开/关闭侧边栏 -->
          <div
            role="button"
            class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--xl ds-button--icon-relative-m"
            tabindex="0"
            @click="ui.toggleSidebar()"
          >
            <div class="ds-button__background"></div>
            <div class="ds-button__icon ds-button__icon--last-child" v-html="iconMenuToggle"></div>
          </div>

          <!-- 居中的标题与模式（滚动后显示） -->
          <div class="_9986c0c">
            <div class="d00ed9c9">{{ chatTitle }}</div>
            <div class="c03d486a">
              <div class="ds-icon a1ac5b47" style="font-size: 12px; width: 12px; height: 12px;" v-html="iconZap"></div>
              <span class="_46a12ab">{{ currentModeLabel }}</span>
            </div>
          </div>

          <div class="_19943ce"></div>
          <div class="_348bebe"></div>

          <!-- 新对话 -->
          <div
            role="button"
            class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--xl ds-button--icon-relative-m"
            tabindex="0"
            style="min-width: 44px;"
            @click="ui.newChat()"
          >
            <div class="ds-button__background"></div>
            <div class="ds-button__icon ds-button__icon--last-child icon-20" v-html="iconNewChat"></div>
          </div>

          <!-- 分享（占位） -->
          <div
            role="button"
            class="ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--l ds-button--icon-relative-m _57370c5 _5dedc1e"
            tabindex="0"
            style="--dsl-button-height: 34px;"
          >
            <div class="ds-button__background"></div>
            <div class="ds-button__icon ds-button__icon--last-child">
              <div class="ds-icon" style="font-size: inherit;" v-html="iconShare"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 消息虚拟列表容器（注意：与 60px 高的 header._2be88ba 平级，占满剩余高度）
           chat-scroll + --show-scrollbar：显示滚动滑块（默认 ds-virtual-list
           隐藏原生滚动条，滑块样式见 local-overrides.css） -->
      <div
        ref="listEl"
        class="ds-virtual-list ds-virtual-list--printable ds-virtual-list--show-scrollbar chat-scroll ds-scroll-area ds-scroll-area--show-on-focus-within ds-scroll-area--enabled _2bd7b35"
        tabindex="0"
        :style="{
          display: 'flex',
          flexDirection: 'column',
          '--container-height': containerHeight + 'px',
          '--dsl-virtual-list-width': listWidth + 'px'
        }"
      >
        <!-- 滚动条轨道（sticky 定位，覆盖在内容上方） -->
        <div
          class="ds-scroll-area__gutters"
          :style="{
            '--container-height': containerHeight + 'px',
            position: 'sticky',
            top: '0px',
            left: '0px',
            right: '0px',
            width: '100%',
            height: '0px'
          }"
        >
          <div
            class="ds-scroll-area__horizontal-gutter"
            style="left: 3px; right: 3px; display: none; top: calc(var(--container-height) - 11px); height: 8px;"
          >
            <div class="ds-scroll-area__horizontal-bar" style="display: none;"></div>
          </div>
          <div
            class="ds-scroll-area__vertical-gutter"
            style="right: 3px; top: 3px; bottom: calc(0px - var(--container-height) + 3px); width: 8px;"
          >
            <div class="ds-scroll-area__vertical-bar" style="display: none;"></div>
          </div>
        </div>

        <!-- 消息列表内容区（listEntering：进入会话定位到底部前暂隐藏，防顶部闪现） -->
        <div
          class="ds-virtual-list-items _6f2c522"
          :class="{ 'chat-list--entering': listEntering }"
          style="box-sizing: content-box; padding-top: 0px; padding-left: calc((100% - var(--message-list-max-width)) / 2); padding-right: calc((100% - var(--message-list-max-width)) / 2); flex-shrink: 0; flex-grow: 1;"
        >
          <div
            class="ds-virtual-list-visible-items"
            style="position: relative; transform: translateY(0px); --dsl-virtual-list-transform-y: 0px; --dsl-virtual-list-ios-compensation-y: 0px;"
          >
            <!-- 空状态：尚未发送消息时展示提示 -->
            <div
              v-if="chatStore.messages.length === 0 && !chatStore.loading"
              class="ds-markdown ds-assistant-message-main-content"
              style="padding: 40px 0; text-align: center; color: var(--dsw-alias-label-tertiary);"
            >
              <p>输入「开始阅读：书名」开始阅读，支持「下一页 / 上一页」翻页、「目录」查看目录、「跳转：章节名」跳转。</p>
            </div>

            <!-- 消息循环：按 role 区分用户/助手样式 -->
            <template v-for="(msg, index) in chatStore.messages" :key="msg.id">
              <!-- 用户提问消息 -->
              <div v-if="msg.role === 'user'" class="_9663006 _2c189bc" :data-virtual-list-item-key="index">
                <div class="d29f3d7d ds-message _63c77b1" style="--panel-width: 0px;">
                  <div class="fbb737a4">{{ msg.content }}</div>
                </div>
                <!-- 用户消息操作条 -->
                <div class="_11d6b3a">
                  <div class="_425ea0b">
                    <div class="ds-flex _78e0558 _0bbda35" style="align-items: flex-end; gap: 0px;">
                      <!-- 复制 -->
                      <div
                        role="button"
                        aria-label="复制"
                        class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l db183363"
                        tabindex="0"
                        @click="copyMessage(msg)"
                      >
                        <div class="ds-button__background"></div>
                        <div class="ds-button__icon ds-button__icon--last-child">
                          <div>
                            <div class="ds-icon" style="font-size: inherit;" v-html="iconCopy"></div>
                          </div>
                        </div>
                      </div>
                      <!-- 编辑 -->
                      <div
                        aria-disabled="false"
                        role="button"
                        class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l d4910adc"
                        tabindex="0"
                        style="margin-left: 10px;"
                      >
                        <div class="ds-button__background"></div>
                        <div class="ds-button__icon ds-button__icon--last-child">
                          <div class="ds-icon" style="font-size: inherit;" v-html="iconMsgEdit"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 助手回答消息：按内容块（blocks）顺序渲染
                   header 块 = 加粗页码头（不做流式，立即显示）
                   text   块 = 正文段落（store 中逐字流式填充）
                   image  块 = 原书图片（流式推进到位置才置 visible，到位再加载） -->
              <div v-else class="_4f9bf79 d7dc56a8 _43c05b5" :data-virtual-list-item-key="index">
                <div class="ds-message _63c77b1" style="--panel-width: 0px;">
                  <div class="ds-markdown ds-assistant-message-main-content">
                    <template v-if="msg.blocks && msg.blocks.length">
                      <!-- key 用块唯一 bkey（store 生成）：blocks 被整体替换时
                           强制重建 DOM，img 是新元素必然触发 load 事件，
                           防止复用旧 img（src 未变不触发 load）卡在加载中 -->
                      <template v-for="block in msg.blocks" :key="block.bkey">
                        <!-- 页码头：加粗完整显示，不打字机 -->
                        <p v-if="block.type === 'header'" class="ds-markdown-paragraph chat-page-header">
                          {{ block.text }}
                        </p>
                        <!-- 正文段落：流式填充中显示已输出部分；URL 段转超链接（新标签页打开） -->
                        <p v-else-if="block.type === 'text' && block.text" class="ds-markdown-paragraph">
                          <template v-for="(seg, si) in splitWithLinks(block.text)" :key="si">
                            <a
                              v-if="seg.isUrl"
                              class="chat-text-link"
                              :href="seg.text"
                              target="_blank"
                              rel="noopener noreferrer"
                            >{{ seg.text }}</a>
                            <span v-else style="white-space: pre-wrap;">{{ seg.text }}</span>
                          </template>
                        </p>
                        <!-- 目录块：每章蓝色超链接，点击自动发送「跳转：章节名」 -->
                        <div v-else-if="block.type === 'toc'" class="chat-toc-block">
                          <a
                            v-for="(entry, i) in block.entries"
                            :key="i"
                            class="chat-toc-link"
                            role="button"
                            tabindex="0"
                            @click="sendJumpCommand(entry.title)"
                          >
                            <span>{{ i + 1 }}. {{ entry.title }}</span>
                            <span v-if="entry.page" class="chat-toc-link__page">（第 {{ entry.page }} {{ block.unit }}）</span>
                          </a>
                        </div>
                        <!-- 图片块：占位提示在图片原位（多图多条提示），
                             三态：加载中提示 → 图片本体 → 加载出错提示 -->
                        <template v-else-if="block.type === 'image' && block.visible !== false">
                          <p v-if="block.loading && !block.failed" class="ds-markdown-paragraph chat-image-fallback">
                            图片加载中...
                          </p>
                          <img
                            v-show="!block.loading && !block.failed"
                            :src="block.src"
                            alt="书籍页面图片"
                            class="chat-page-image"
                            @load="onImageLoaded(block)"
                            @error="block.failed = true"
                          />
                          <p v-if="block.failed" class="ds-markdown-paragraph chat-image-fallback">图片加载出错</p>
                        </template>
                      </template>
                    </template>
                    <!-- 兜底：无 blocks 的消息（异常/极旧数据）直接渲染纯文本 -->
                    <p v-else class="ds-markdown-paragraph">
                      <span style="white-space: pre-wrap;">{{ msg.content }}</span>
                    </p>
                  </div>
                </div>
                <!-- 助手消息操作条 -->
                <div class="ds-flex _0a3d93b" style="align-items: center; gap: 10px; flex-wrap: wrap-reverse;">
                  <div class="ds-flex _965abe9 _54866f7" style="align-items: center; gap: 10px;">
                    <!-- 复制（首个操作，绑定复制逻辑） -->
                    <div
                      role="button"
                      aria-label="复制"
                      class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l db183363"
                      tabindex="0"
                      @click="copyMessage(msg)"
                    >
                      <div class="ds-button__background"></div>
                      <div class="ds-button__icon ds-button__icon--last-child">
                        <div class="ds-icon" style="font-size: inherit;" v-html="iconCopy"></div>
                      </div>
                    </div>
                    <!-- 重新生成/点赞/点踩/分享 -->
                    <div
                      v-for="(icon, i) in ansActions"
                      :key="i"
                      role="button"
                      class="ds-button ds-button--iconLabelTertiary ds-button--icon ds-button--capsule ds-button--xs ds-button--icon-relative-l db183363"
                      tabindex="0"
                    >
                      <div class="ds-button__background"></div>
                      <div class="ds-button__icon ds-button__icon--last-child">
                        <div class="ds-icon" style="font-size: inherit;" v-html="icon"></div>
                      </div>
                    </div>
                  </div>
                  <div style="flex: 1 1 0%;"></div>
                </div>
              </div>
            </template>

            <!-- 加载中占位：紧随用户消息之后（回复位置），非顶部。
                 按发送时所选工具区分文案：AI → 思考中 / 搜索 → 搜索中 / 其余 → 通用加载 -->
            <div
              v-if="chatStore.loading"
              class="_4f9bf79 d7dc56a8 _43c05b5"
            >
              <div class="ds-message _63c77b1" style="--panel-width: 0px;">
                <div class="ds-markdown ds-assistant-message-main-content">
                  <p class="ds-markdown-paragraph">
                    <span style="white-space: pre-wrap;">{{ loadingTip }}</span>
                  </p>
                </div>
              </div>
            </div>

            <!-- 列表底部留白：为 sticky 输入区让位，防止最后一条消息被遮挡 -->
            <div style="padding-bottom: 160px;"></div>
          </div>
        </div>

        <!--
          底部输入区：必须是滚动容器（.ds-virtual-list）的直接子元素，
          通过 sticky + bottom:0 固定在底部（原站结构，样式见 ui.css ._871cbca）。
          注意：不能放进 ds-virtual-list-visible-items 内——它带有 transform，
          会使 sticky 定位失效，导致输入区随消息滚动。
        -->
        <div class="_871cbca">
          <div class="d72636e2"></div>
          <ChatInput surface="_3d616d3" />
          <div class="_0fcaa63">内容由 AI 生成，请仔细甄别</div>

          <!-- 回到底部按钮：浮于输入区上方、与发送按钮同一竖轴线（右对齐偏移
               计算见 local-overrides.css .chat-jump），仅在离开底部时淡入 -->
          <div class="chat-jump" :class="{ 'chat-jump--visible': !atBottom }">
            <div
              role="button"
              aria-label="回到底部"
              class="chat-jump__btn"
              tabindex="0"
              @click="scrollToBottom"
            >
              <div v-html="iconChevronDown"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧章节导航（复刻原站滚动导航，参考新版样式.txt）：
           折叠态 = 34px 窄条 + 一列圆点短横（当前章节蓝色放大 1.5 倍），
           悬停 = 章节文字渐显、面板出现白底与阴影（最大 240px），
           点击条目跳转对应章节，鼠标离开渐隐收回。样式见 local-overrides.css -->
      <div v-if="tocItems.length" class="chat-toc" role="navigation" aria-label="章节导航">
        <!-- 半透明磨砂背景胶囊（始终可见，撑起窄条外观） -->
        <div class="chat-toc__pill"></div>
        <!-- 导航面板：折叠时透明不可点（仅剩圆点），悬停后出现背景与文字 -->
        <div class="chat-toc__panel">
          <div class="chat-toc__list">
            <div
              v-for="item in tocItems"
              :key="item.index"
              class="chat-toc__item"
              :class="{ 'chat-toc__item--current': item.index === currentTocIndex }"
              role="button"
              tabindex="0"
              :title="item.text"
              @click="jumpToChapter(item.index)"
            >
              <span class="chat-toc__text">{{ item.text }}</span>
              <span class="chat-toc__dotbox"><span class="chat-toc__dot"></span></span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 帮助按钮 + 帮助菜单弹窗（共用组件，内容解析 data/help.json） -->
    <HelpButton />

    <!-- 复制结果提示：半透明黑底白字（与阅读器边界提示同款，见 ToastTip.vue） -->
    <ToastTip :message="toastMsg" />
  </div>
</template>
