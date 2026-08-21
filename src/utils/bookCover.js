/**
 * 书籍元数据与封面提取（纯前端、全离线）
 *
 * 导入时在浏览器内解析书籍：
 * - EPUB：epubjs 读取 OPF 元数据（书名/作者）与内嵌封面图
 * - PDF ：pdfjs 渲染第 1 页为封面图，书名取文档 Title（缺失则用文件名）
 * - TXT ：无元数据/封面，书名用文件名，生成占位封面
 * 提取失败时统一降级为「文件名 + 占位封面」，保证任何文件都能导入
 *
 * 产出：{ title, author, coverBlob } → 随书籍一起上传给本地后端落盘
 */

import ePub from 'epubjs'
import * as pdfjsLib from 'pdfjs-dist'
// pdfjs 必须显式指定 worker（Vite 本地打包，无 CDN）
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/** canvas 转 Blob（jpeg） */
function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

/** 文件名去掉扩展名作为兜底书名 */
function fileNameTitle(file) {
  const name = (file?.name || '').replace(/\.[^.]+$/, '').trim()
  return name || '未命名'
}

/**
 * 元数据书名可信度检查
 * 某些 PDF 用非 UTF-16BE 编码写中文 Title，解码后是乱码/控制字符，
 * 检测到替换符或控制字符时回退文件名
 */
function sanitizeTitle(title, file) {
  const t = (title || '').trim()
  if (!t || /[\uFFFD\u0000-\u001F]/.test(t)) return fileNameTitle(file)
  return t
}

/**
 * 生成占位封面（无内嵌封面的书籍使用）
 * 480x640（3:4 书封比例），底色渐变 + 书名首字 + 完整书名 + 格式角标
 */
async function generateCover(title, format) {
  const canvas = document.createElement('canvas')
  canvas.width = 480
  canvas.height = 640
  const ctx = canvas.getContext('2d')

  // 按格式区分底色：epub 蓝青 / pdf 暖红 / txt 灰蓝
  const palettes = {
    epub: ['#3964fe', '#0aa5a2'],
    pdf: ['#e0564f', '#8a2f6b'],
    txt: ['#5b7a9d', '#2f4858'],
  }
  const [c1, c2] = palettes[format] || palettes.txt
  const grad = ctx.createLinearGradient(0, 0, 480, 640)
  grad.addColorStop(0, c1)
  grad.addColorStop(1, c2)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 480, 640)

  // 中央书名首字
  const first = [...title][0] || '书'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '600 220px Inter, "Microsoft YaHei", sans-serif'
  ctx.fillText(first, 240, 280)

  // 底部完整书名（超出宽度截断）
  let shown = title
  ctx.font = '500 34px Inter, "Microsoft YaHei", sans-serif'
  while (ctx.measureText(shown).width > 420 && shown.length > 1) shown = shown.slice(0, -1)
  ctx.fillText(shown + (shown.length < title.length ? '…' : ''), 240, 520)

  // 左上角格式角标
  ctx.font = '600 26px Inter, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.textAlign = 'left'
  ctx.fillText(format.toUpperCase(), 28, 44)

  return canvasToBlob(canvas, 0.9)
}

/** EPUB：epubjs 解析元数据与内嵌封面 */
async function extractEpub(file) {
  const book = ePub(await file.arrayBuffer())
  try {
    const meta = await book.loaded.metadata
    const title = sanitizeTitle(meta?.title, file)
    const author = (meta?.creator || '').trim() || '未知作者'

    let coverBlob = null
    try {
      // coverUrl() 返回 blob: 或 data: URL，统一 fetch 成 Blob
      const url = await book.coverUrl()
      if (url) {
        const resp = await fetch(url)
        coverBlob = await resp.blob()
      }
    } catch {
      coverBlob = null
    }
    return { title, author, coverBlob }
  } finally {
    book.destroy?.()
  }
}

/** PDF：pdfjs 读取 Title 元数据，渲染第 1 页为封面 */
async function extractPdf(file) {
  const task = pdfjsLib.getDocument({ data: await file.arrayBuffer() })
  const pdf = await task.promise
  try {
    let title = ''
    let author = ''
    try {
      const info = (await pdf.getMetadata())?.info
      title = (info?.Title || '').trim()
      author = (info?.Author || '').trim()
    } catch {
      /* 元数据可选 */
    }

    // 第 1 页按封面比例（3:4）渲染为 jpeg
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(480 / base.width, 640 / base.height) * 1.6
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise

    const coverBlob = await canvasToBlob(canvas)
    return { title: sanitizeTitle(title, file), author: author || '未知作者', coverBlob }
  } finally {
    await pdf.destroy()
  }
}

/** TXT：无元数据，书名取文件名 */
async function extractTxt(file) {
  return { title: fileNameTitle(file), author: '未知作者', coverBlob: null }
}

/**
 * 提取书籍信息入口
 * @param {File} file 用户选择的本地文件（.epub/.pdf/.txt）
 * @param {(percent:number)=>void} [onProgress] 进度回调（0~1，阶段粗略反馈）
 */
export async function extractBookInfo(file, onProgress) {
  const format = (file.name.split('.').pop() || '').toLowerCase()
  const extractor = { epub: extractEpub, pdf: extractPdf, txt: extractTxt }[format]
  if (!extractor) throw new Error(`不支持的格式：.${format}（仅支持 EPUB / PDF / TXT）`)

  onProgress?.(0.1)
  let info
  try {
    info = await extractor(file)
  } catch (err) {
    // 解析失败（文件损坏等）：降级为文件名 + 占位封面，仍可导入
    console.warn('[书架] 元数据提取失败，使用文件名兜底：', err)
    info = { title: fileNameTitle(file), author: '未知作者', coverBlob: null }
  }

  onProgress?.(0.7)
  if (!info.coverBlob) info.coverBlob = await generateCover(info.title, format)
  onProgress?.(1)
  return { ...info, format }
}
