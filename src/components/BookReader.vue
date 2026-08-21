<script setup>
/**
 * 书籍阅读器（全屏弹层，支持三种格式，全离线渲染）
 * - EPUB：epubjs 渲染，上一页/下一页翻页
 * - PDF ：pdfjs 逐页渲染 canvas，上一页/下一页翻页
 * - TXT ：整篇文本滚动阅读（无翻页概念）
 * 翻页交互（EPUB/PDF）：
 * - 顶部「上一页/下一页」按钮
 * - 屏幕最左/右侧主题蓝箭头图标（left.svg / right.svg）
 * - 鼠标滚轮：向下 = 下一页，向上 = 上一页（EPUB 需挂到 iframe 内部文档）
 * 边界提示：已是第一页/最后一页 → 屏幕中心半透明黑底白字提示
 * 顶部实时显示当前阅读进度（百分比）
 * 书籍文件通过本地后端静态服务（/data/books/...）加载，自动链接本地文件
 */

import { onBeforeUnmount, onMounted, ref, computed, watch } from 'vue'
import ePub from 'epubjs'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useShelfStore } from '@/stores/shelf'
import { useSettingsStore } from '@/stores/settings'
import ToastTip from './ToastTip.vue'
import iconLeft from '@/assets/icons/left.svg?raw'
import iconRight from '@/assets/icons/right.svg?raw'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const props = defineProps({
  book: { type: Object, required: true },
})
const emit = defineEmits(['close'])

const shelf = useShelfStore()
const settings = useSettingsStore()

/* ---------- 阅读进度（百分比） ----------
 * 各格式换算：EPUB 章节 index / 总章节数；PDF 当前页 / 总页数；TXT 滚动比例
 * progressNow 响应式供顶部栏展示；落盘防抖 600ms（PATCH shelf.json），
 * 值未变化直接跳过；关闭/卸载时立即 flush 未保存值
 */
const progressNow = ref(0)
let lastProgress = -1
let progressTimer = null

function reportProgress(p) {
  p = Math.max(0, Math.min(100, Math.round(p)))
  progressNow.value = p
  if (p === lastProgress) return
  lastProgress = p
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => {
    progressTimer = null
    shelf.saveProgress(props.book.id, lastProgress)
  }, 600)
}

function flushProgress() {
  if (progressTimer) {
    clearTimeout(progressTimer)
    progressTimer = null
    shelf.saveProgress(props.book.id, lastProgress)
  }
}

/* ---------- 边界提示（屏幕中心 toast） ---------- */
const toastMsg = ref('')
let toastTimer = null

function showToast(msg) {
  toastMsg.value = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toastMsg.value = ''), 1500)
}

const loading = ref(true)
const error = ref('')
const pageText = ref('') // PDF 页码 / EPUB 章节提示

// ---------- EPUB ----------
const epubContainer = ref(null)
let epubBook = null
let rendition = null
let epubIndex = 0      // 当前章节索引
let epubSpineLen = 1   // 总章节数

/** 记忆阅读进度开启且本书有进度时的起始位置（0-100 百分比，否则 0） */
function savedProgress() {
  return settings.rememberProgress && props.book.progress > 0 ? props.book.progress : 0
}

async function mountEpub() {
  epubBook = ePub(props.book.file) // 相对路径走本地后端
  rendition = epubBook.renderTo(epubContainer.value, { width: '100%', height: '100%', spread: 'none' })
  // 章节索引占比 = 阅读进度（relocated 在首次打开与每次翻页时触发）
  rendition.on('relocated', (loc) => {
    epubIndex = loc?.start?.index ?? 0
    reportProgress((epubIndex / epubSpineLen) * 100)
  })
  // EPUB 内容渲染在 iframe 内，滚轮事件需挂到内部文档
  rendition.on('rendered', (section, view) => {
    view?.document?.addEventListener('wheel', onWheel, { passive: false })
  })
  // 暗黑模式下给 iframe 正文套暗色主题（默认为白底黑字，与明暗主题同步）
  applyEpubTheme()
  // spine 在 book 打开完成前为空数组：过早读取会让 epubSpineLen=1，
  // 边界检查恒真 → 翻页被「已是最后一页」短路。
  // 注意不能用 await book.ready —— 它包含 navigation 等链，部分 EPUB 会永久 pending；
  // loaded.spine 在 unpack 时无条件 resolve，安全且先于首次 relocated 触发
  const spine = await epubBook.loaded.spine
  epubSpineLen = spine?.length || 1
  // 记忆进度：按已存百分比换算起始章索引（关闭记忆则从头开始）
  let target = 0
  const saved = savedProgress()
  if (saved > 0) {
    target = Math.min(epubSpineLen - 1, Math.round((saved / 100) * epubSpineLen))
  }
  await rendition.display(target)
}

/** EPUB iframe 正文主题（明/暗），随设置页暗黑开关实时切换 */
function applyEpubTheme() {
  rendition?.themes.default(
    settings.darkMode
      ? { body: { background: '#1b1b1c', color: '#e3e4e6' } }
      : { body: { background: '#fff', color: '#1f2329' } },
  )
}

// ---------- PDF ----------
const pdfCanvas = ref(null)
let pdfDoc = null
let pdfPageNum = 0
let pdfRenderTask = null // 当前渲染任务：快速翻页时先取消旧任务，避免同一 canvas 并发渲染报错

async function renderPdfPage(num) {
  const page = await pdfDoc.getPage(num)
  const canvas = pdfCanvas.value
  // 按阅读区宽度适配缩放
  const holder = canvas.parentElement
  const scale = (holder.clientWidth - 32) / page.getViewport({ scale: 1 }).width
  const viewport = page.getViewport({ scale: Math.max(scale, 0.5) })
  canvas.width = viewport.width
  canvas.height = viewport.height
  // 取消进行中的渲染（被取消的任务会 reject，属于正常中断）
  if (pdfRenderTask) {
    try { pdfRenderTask.cancel() } catch { /* 忽略 */ }
  }
  pdfRenderTask = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport })
  try {
    await pdfRenderTask.promise
  } catch (err) {
    if (err?.name === 'RenderingCancelledException') return // 旧任务被新翻页取消，静默退出
    throw err
  }
  pdfPageNum = num
  pageText.value = `${num} / ${pdfDoc.numPages}`
  reportProgress((num / pdfDoc.numPages) * 100)
}

async function mountPdf() {
  // 先整体下载再交给 pdfjs（data 模式），不用 url 模式：
  // url 模式下 pdfjs 网络层会做 range 探测并取消请求（控制台报 net::ERR_ABORTED），
  // 在部分浏览器/陈旧 dev 服务环境下会升级为加载失败甚至触发浏览器下载框。
  // 书籍都在本地后端，整体读入内存（几 MB 级）无性能负担，行为也最稳定
  const resp = await fetch(props.book.file)
  if (!resp.ok) throw new Error(`PDF 加载失败：HTTP ${resp.status}`)
  const data = await resp.arrayBuffer()
  pdfDoc = await pdfjsLib.getDocument({ data }).promise
  // 记忆进度：按已存百分比换算起始页（关闭记忆则从第 1 页开始）
  let target = 1
  const saved = savedProgress()
  if (saved > 0) {
    target = Math.max(1, Math.min(pdfDoc.numPages, Math.round((saved / 100) * pdfDoc.numPages)))
  }
  await renderPdfPage(target)
}

// ---------- TXT ----------
const txtContent = ref('')
const txtEl = ref(null)

/** 通过本地后端拉取 TXT 全文 */
async function mountTxt() {
  const res = await fetch(props.book.file)
  if (!res.ok) throw new Error(`TXT 加载失败：${res.status}`)
  txtContent.value = await res.text()
  // 等待 DOM 更新后按已存进度回跳（记忆进度关闭时从头开始）
  requestAnimationFrame(() => {
    const saved = savedProgress()
    if (saved > 0 && txtEl.value) {
      const max = txtEl.value.scrollHeight - txtEl.value.clientHeight
      txtEl.value.scrollTop = (saved / 100) * max
    }
  })
}

/** TXT 滚动位置 → 阅读进度（滚到底 = 100%） */
function onTxtScroll() {
  const el = txtEl.value
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  reportProgress(max > 0 ? (el.scrollTop / max) * 100 : 100)
}

/* ---------- 翻页（EPUB/PDF；边界时中心提示） ---------- */
const canFlip = () => props.book.format === 'epub' || props.book.format === 'pdf'

function prevPage() {
  if (!canFlip()) return
  if (props.book.format === 'epub') {
    if (epubIndex <= 0) return showToast('已是第一页')
    rendition?.prev()
  } else {
    if (pdfPageNum <= 1) return showToast('已是第一页')
    renderPdfPage(pdfPageNum - 1)
  }
}

function nextPage() {
  if (!canFlip()) return
  if (props.book.format === 'epub') {
    if (epubIndex >= epubSpineLen - 1) return showToast('已是最后一页')
    rendition?.next()
  } else {
    if (pdfPageNum >= pdfDoc.numPages) return showToast('已是最后一页')
    renderPdfPage(pdfPageNum + 1)
  }
}

/* ---------- 滚轮翻页：向下 = 下一页，向上 = 上一页 ----------
 * 300ms 节流 + |deltaY|>10 阈值（过滤触控板噪声）；TXT 保持原生滚动
 */
let wheelLock = 0

function onWheel(e) {
  if (!canFlip()) return
  e.preventDefault()
  const now = Date.now()
  if (now - wheelLock < 300 || Math.abs(e.deltaY) < 10) return
  wheelLock = now
  if (e.deltaY > 0) nextPage()
  else if (e.deltaY < 0) prevPage()
}

/* ---------- 目录（顶部栏按钮 + 纯文字弹层） ----------
 * 数据来自后端 /api/shelf/toc：EPUB 为 nav/ncx 章节、PDF 为书签大纲；
 * TXT / 无书签 PDF / 全无标题 EPUB 返回空数组 → 按钮灰色禁用。
 * 条目 page 与对话模式「第 X / N 页」一致（1-based；EPUB 即 spine 章序）。
 */
const toc = ref([])
const tocOpen = ref(false)
const tocAvailable = computed(() => toc.value.length > 0)

async function loadToc() {
  try {
    const res = await fetch(`/api/shelf/toc?bookId=${encodeURIComponent(props.book.id)}`)
    if (!res.ok) return
    const data = await res.json()
    toc.value = data.toc || []
  } catch {
    toc.value = [] // 拉取失败视为无目录（按钮保持禁用）
  }
}

/** 点击目录条目：EPUB 按 spine 章序跳章，PDF 按页码跳页 */
function jumpToTocEntry(entry) {
  if (!entry?.page) return
  tocOpen.value = false
  if (props.book.format === 'epub') {
    rendition?.display(entry.page - 1)
  } else if (props.book.format === 'pdf' && pdfDoc) {
    const target = Math.max(1, Math.min(entry.page, pdfDoc.numPages))
    renderPdfPage(target)
  }
}

// 阅读中切换暗黑模式：EPUB 正文主题实时跟随（重显当前章应用新主题）
watch(
  () => settings.darkMode,
  () => {
    if (props.book.format !== 'epub' || !rendition) return
    applyEpubTheme()
    rendition.display(epubIndex).catch(() => { /* 重显失败保持现状 */ })
  },
)

onMounted(async () => {
  loadToc() // 目录与书籍渲染互不依赖，并行拉取
  try {
    if (props.book.format === 'epub') await mountEpub()
    else if (props.book.format === 'pdf') await mountPdf()
    else await mountTxt()
  } catch (err) {
    console.error('[阅读器] 打开失败：', err)
    error.value = '书籍打开失败，文件可能已损坏或被移除'
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  flushProgress() // 关闭/切换时立即落盘未保存的进度
  // 释放 epubjs/pdfjs 资源，避免残留 worker 与 DOM
  try {
    rendition?.destroy()
    epubBook?.destroy()
  } catch { /* 忽略销毁异常 */ }
  pdfDoc?.destroy()
})
</script>

<template>
  <div class="reader-overlay">
    <!-- 顶部栏：书名 / 进度 / 页码 / 翻页 / 关闭 -->
    <header class="reader-header">
      <div class="reader-title">
        <span class="reader-name">{{ book.title }}</span>
        <span v-if="book.author" class="reader-author">{{ book.author }}</span>
      </div>
      <div class="reader-actions">
        <!-- 当前阅读进度 -->
        <span class="reader-progress">已读 {{ progressNow }}%</span>
        <span v-if="pageText" class="reader-page">{{ pageText }}</span>
        <button v-if="canFlip()" class="reader-btn" @click="prevPage">上一页</button>
        <button v-if="canFlip()" class="reader-btn" @click="nextPage">下一页</button>
        <!-- 目录：无目录书籍（TXT / 无书签 PDF）灰色禁用 -->
        <button class="reader-btn" :disabled="!tocAvailable" @click="tocOpen = true">目录</button>
        <button class="reader-btn reader-close" @click="emit('close')">返回</button>
      </div>
    </header>

    <!-- 阅读区（滚轮翻页挂载点）；加载/错误提示居中展示在阅读区正中 -->
    <div class="reader-body" @wheel="onWheel">
      <div v-if="loading" class="reader-tip reader-loading">正在打开书籍…</div>
      <div v-if="error" class="reader-tip reader-error">{{ error }}</div>

      <div v-show="book.format === 'epub' && !error" ref="epubContainer" class="reader-epub"></div>
      <div v-show="book.format === 'pdf' && !error" class="reader-pdf">
        <canvas ref="pdfCanvas"></canvas>
      </div>
      <pre v-if="book.format === 'txt' && !error" ref="txtEl" class="reader-txt" @scroll="onTxtScroll">{{ txtContent }}</pre>
    </div>

    <!-- 屏幕最左/右侧翻页箭头（EPUB/PDF；主题蓝） -->
    <button v-if="canFlip() && !error" class="edge-nav edge-left" title="上一页" v-html="iconLeft" @click="prevPage"></button>
    <button v-if="canFlip() && !error" class="edge-nav edge-right" title="下一页" v-html="iconRight" @click="nextPage"></button>

    <!-- 边界提示：屏幕中心，半透明黑底白字（共享组件，ChatView 复制失败提示同款） -->
    <ToastTip :message="toastMsg" />

    <!-- 目录弹层（纯文字列表；点击条目跳转对应章节/页） -->
    <div v-if="tocOpen" class="reader-toc-mask" @click.self="tocOpen = false">
      <div class="reader-toc">
        <div class="reader-toc__header">
          <span class="reader-toc__title">目录</span>
          <button class="reader-btn" @click="tocOpen = false">关闭</button>
        </div>
        <div class="reader-toc__list">
          <div
            v-for="(entry, i) in toc"
            :key="i"
            class="reader-toc__item"
            :style="{ paddingLeft: 14 + (entry.depth || 0) * 18 + 'px' }"
            @click="jumpToTocEntry(entry)"
          >
            <span class="reader-toc__text">{{ entry.title }}</span>
            <span v-if="entry.page" class="reader-toc__page">{{ entry.page }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reader-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-surface-primary, #fff);
}

.reader-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--dsw-alias-border-light, #e5e6eb);
  flex-shrink: 0;
  /* 层级最高：防止 epubjs 动态插入的容器/测量层遮挡顶部按钮 */
  position: relative;
  z-index: 30;
}

/* 加载提示：与错误提示共用 .reader-tip 居中样式（阅读区正中） */
.reader-loading {
  pointer-events: none;
  white-space: nowrap;
}

.reader-title {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.reader-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reader-author {
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary, #8f919f);
  white-space: nowrap;
  flex-shrink: 0;
}

.reader-actions {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

/* 当前阅读进度（主题蓝百分比） */
.reader-progress {
  font-size: 13px;
  font-weight: 600;
  color: rgb(57, 100, 254);
}

.reader-page {
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary, #8f919f);
  margin-right: 8px;
}

.reader-btn {
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-light, #e5e6eb);
  background: var(--dsw-alias-surface-primary, #fff);
  font-size: 13px;
  /* 按钮文字统一：不加粗、黑色 */
  font-weight: 400;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  cursor: pointer;
}

.reader-btn:hover {
  background: var(--dsw-alias-fill-secondary, #f1f3f5);
}

/* 目录按钮禁用态（无目录书籍）：灰色、不可点 */
.reader-btn:disabled {
  color: var(--dsw-alias-label-disable, #c4c6cf);
  background: var(--dsw-alias-surface-primary, #fff);
  cursor: not-allowed;
}

.reader-btn:disabled:hover {
  background: var(--dsw-alias-surface-primary, #fff);
}

.reader-close {
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.reader-body {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
}

.reader-tip {
  /* 绝对定位 + translate 双向居中于阅读区正中（.reader-body 为 relative）。
     不可用 margin:auto：加载阶段内容容器（epub/pdf）仍是 flex 可见子项，
     提示与它并排会被挤偏；只有错误时内容隐藏、提示成为唯一子项才碰巧居中 */
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  font-size: 18px;
  font-weight: 600;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}

.reader-error {
  color: var(--dsw-alias-label-alert, #e0564f);
}

.reader-epub {
  flex: 1;
  min-width: 0;
}

.reader-pdf {
  flex: 1;
  min-width: 0;
  overflow: auto;
  display: flex;
  justify-content: center;
  padding: 16px;
}

.reader-txt {
  flex: 1;
  margin: 0;
  padding: 24px 8%;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.9;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  overflow: auto;
}

/* ---------- 屏幕左右侧翻页箭头（主题蓝） ---------- */
.edge-nav {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  width: 42px;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: rgb(57, 100, 254);
  cursor: pointer;
  border-radius: 50%;
  transition: background-color 0.15s ease;
  z-index: 10;
}

.edge-nav:hover {
  background: rgba(57, 100, 254, 0.08);
}

.edge-left {
  left: 12px;
}

.edge-right {
  right: 12px;
}

.edge-nav :deep(svg) {
  width: 30px;
  height: 30px;
  fill: currentColor;
}

/* ---------- 目录弹层（纯文字；遮罩点击空白处关闭） ---------- */
.reader-toc-mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
}

.reader-toc {
  width: min(420px, calc(100vw - 48px));
  max-height: min(70vh, 560px);
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-surface-primary, #fff);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
  overflow: hidden;
}

/* 暗色模式：目录弹层抬高一档背景，与阅读区区分 */
body[data-ds-dark-theme] .reader-toc {
  background: #232324;
}

.reader-toc__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-light, #e5e6eb);
  flex-shrink: 0;
}

.reader-toc__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #1a1a1a);
}

.reader-toc__list {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: 8px;
}

.reader-toc__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 8px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary, #1a1a1a);
  cursor: pointer;
}

.reader-toc__item:hover {
  background: var(--dsw-alias-fill-secondary, #f1f3f5);
}

.reader-toc__text {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.reader-toc__page {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--dsw-alias-label-tertiary, #8f919f);
}
</style>
