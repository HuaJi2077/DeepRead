/**
 * 电子书内容提取（服务端）
 *
 * 支持格式：
 * - PDF ：pdfjs 提取单页文字层（默认提取，不做 OCR）；
 *         能提取出文字 → 只输出文字；提取不出（扫描页/图片页）→ 渲染整页图片
 * - TXT ：按固定字符数分页
 * - EPUB：jszip + xmldom 直接解包解析（EPUB 本质是 zip 内的 XHTML 集合），
 *         按 spine 章节输出「文字块 + 图片块」按原文顺序混合的序列
 *
 * 输出结构统一为 blocks（内容块序列，顺序即展示顺序）：
 *   [{ type: 'text', text }, { type: 'image', src: dataURL }, ...]
 * 页码提示头（加粗标题）由调用方（commandExecutor / 路由层）拼接。
 *
 * 设计说明：
 * - 不用 epubjs 做服务端解析——它依赖 window/document 等浏览器 API，
 *   Node 环境无法运行；jszip / @xmldom/xmldom 均为纯 JS（epubjs 自带依赖，
 *   已随包离线下载），在 Node 中可直接使用，无需联网安装
 * - 解析结果按文件缓存（zip 结构 / PDF 文档对象），翻页与历史重建时复用，
 *   避免每次都重新解析整本书
 *
 * 所有路径均基于项目根目录的相对路径，由调用方保证安全性。
 */

import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pdf as pdfToImg } from 'pdf-to-img'
import { ROOT } from './config.js'

/** TXT 每页字符数 */
const TXT_PAGE_SIZE = 1500

/**
 * 判定 PDF 页「有可读文字」的最小字符数：
 * 低于该值（如只有页码、页眉残留）视为扫描页，按无文字处理转图片输出
 */
const PDF_MIN_TEXT_LEN = 8

/** EPUB 单章最多输出的插图数（防止插图异常多的章节撑爆响应载荷） */
const EPUB_MAX_IMAGES = 10

/* ==================================================================== *
 *  PDF：文字层提取 + 扫描页图片渲染
 * ==================================================================== */

/**
 * pdfjs 文档缓存：文件路径 -> PDFDocumentProxy
 * 避免每次翻页都重新打开并解析整个 PDF（翻页性能关键路径）。
 * 注意：缓存的文档不再 destroy，进程生命周期内复用。
 */
const pdfDocCache = new Map()

/** 获取（或打开并缓存）pdfjs 文档对象 */
async function getPdfDoc(absPath) {
  let doc = pdfDocCache.get(absPath)
  if (!doc) {
    doc = await pdfjsLib.getDocument(absPath).promise
    pdfDocCache.set(absPath, doc)
  }
  return doc
}

/**
 * PDF 页面图片缓存：文件路径 -> { doc, pages: Map<页码, dataURL> }
 * - doc：pdf-to-img 打开的文档对象（复用，避免每次重新解析 PDF 结构）
 * - pages：已渲染页的 data URL 缓存（按需渲染，不一次性渲染整本）
 */
const pdfImageCache = new Map()

/**
 * 将 PDF 指定页渲染为 PNG 图片（data URL 格式）
 * - 仅在「文字提取失败需转图片」时才会调用
 * - 缩放比 1.5 兼顾清晰度与体积
 * - 异常时返回空数组，由调用方降级为纯文字提示
 */
async function renderPdfPageToImages(absPath, pageNum) {
  try {
    let entry = pdfImageCache.get(absPath)
    if (!entry) {
      entry = { doc: await pdfToImg(absPath, { scale: 1.5 }), pages: new Map() }
      pdfImageCache.set(absPath, entry)
    }
    let dataUrl = entry.pages.get(pageNum)
    if (!dataUrl) {
      const buffer = await entry.doc.getPage(pageNum)
      dataUrl = `data:image/png;base64,${buffer.toString('base64')}`
      entry.pages.set(pageNum, dataUrl)
    }
    return [dataUrl]
  } catch (err) {
    console.error('[bookReader] PDF 页面渲染失败：', err.message)
    return []
  }
}

/* ==================================================================== *
 *  EPUB：zip 解包解析（jszip + xmldom，无浏览器依赖）
 * ==================================================================== */

/** XHTML 中的块级标签：提取正文时按块分行，保持段落结构 */
const EPUB_BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'div', 'pre', 'td',
])

/** 图片扩展名 -> MIME（转 data URL 用；未知扩展名回退 jpeg） */
const IMG_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}
/** 取元素的元素子节点列表（xmldom childNodes 含文本节点，需过滤） */
function elementChildren(el) {
  return Array.prototype.filter.call(el.childNodes || [], (n) => n.nodeType === 1)
}

/** 判断元素是否图片元素（img 或 SVG 内嵌 image） */
function isImageElement(el) {
  const name = el.nodeName.toLowerCase()
  return name === 'img' || name === 'image'
}

/**
 * 递归收集元素内部所有图片后代（不限直接子级）
 * 纯图章节常见结构：div.main > ops:switch > ops:case > svg > image，
 * 图片嵌在多层命名空间包装里，必须深挖才能取到（一比一还原原文件内容）
 */
function collectImageDescendants(el, out = []) {
  for (const child of elementChildren(el)) {
    if (isImageElement(child)) out.push(child)
    else collectImageDescendants(child, out)
  }
  return out
}

/**
 * EPUB 文档缓存：文件路径 -> { zip, opfDir, manifest, spine }
 * - zip：解包后的 JSZip 对象（章节与图片均从中读取）
 * - opfDir：OPF 所在目录（资源相对路径的解析基准）
 * - manifest：id -> { href, mediaType }（OPF 清单）
 * - spine：idref 数组（阅读顺序，长度即总「页」数）
 */
const epubDocCache = new Map()

/** 获取（或解包并缓存）EPUB 结构对象 */
async function getEpubDoc(absPath) {
  let doc = epubDocCache.get(absPath)
  if (!doc) {
    doc = await parseEpub(absPath)
    epubDocCache.set(absPath, doc)
  }
  return doc
}

/**
 * 解析 EPUB 结构（一次解包，后续翻页全部复用）
 * 解析路径：META-INF/container.xml → OPF 文件 → manifest + spine
 * 这与 epubjs 的 unpack 流程等价，但全部在 Node 内完成
 */
async function parseEpub(absPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(absPath))

  // 1) container.xml 固定位置，指向本书的 OPF 数据文件
  const containerFile = zip.file('META-INF/container.xml')
  if (!containerFile) throw new Error('缺少 META-INF/container.xml，不是标准 EPUB')
  const containerDoc = new DOMParser().parseFromString(
    await containerFile.async('string'),
    'application/xml',
  )
  const opfPath = containerDoc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!opfPath) throw new Error('container.xml 中未找到 OPF 路径')

  // 2) OPF：manifest（全部资源清单）+ spine（按阅读顺序排列的章节 id）
  const opfFile = zip.file(opfPath)
  if (!opfFile) throw new Error(`未找到 OPF 文件：${opfPath}`)
  const opfDoc = new DOMParser().parseFromString(await opfFile.async('string'), 'application/xml')
  const manifest = new Map()
  // 注意：xmldom 0.7 的 getElementsByTagName 返回 LiveNodeList（不可 for...of），须 Array.from
  for (const item of Array.from(opfDoc.getElementsByTagName('item'))) {
    manifest.set(item.getAttribute('id'), {
      href: item.getAttribute('href') || '',
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    })
  }
  const spineEl = opfDoc.getElementsByTagName('spine')[0]
  const ncxId = spineEl?.getAttribute('toc') || null
  const spine = Array.from(opfDoc.getElementsByTagName('itemref'), (r) =>
    r.getAttribute('idref'),
  )

  return { zip, opfDir: path.posix.dirname(opfPath), manifest, spine, ncxId }
}

/**
 * 解析单张 EPUB 图片为 data URL（失败返回 null，不中断整体输出）
 * - 相对路径以章节文件所在目录为基准解析到 zip 内条目
 * - data: 内联图片直接透传
 */
async function resolveEpubImage(epubDoc, chapterPath, el) {
  const raw =
    el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href') || ''
  if (!raw) return null
  if (raw.startsWith('data:')) return raw
  try {
    // 去锚点（#xxx）、还原 URL 编码（%20 等），再相对章节目录定位 zip 内路径
    const clean = decodeURIComponent(raw.split('#')[0])
    const baseDir = path.posix.dirname(chapterPath)
    const imgPath = path.posix.normalize(path.posix.join(baseDir, clean))
    const file = epubDoc.zip.file(imgPath)
    if (!file) return null
    const buf = await file.async('nodebuffer')
    const mime = IMG_MIME[path.posix.extname(imgPath).toLowerCase()] || 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/**
 * 从章节 XHTML 按原文顺序提取内容块序列（文字块与图片块交错）
 * - 「最内层」块级元素（内部不再含块级子元素）的文字作为一个 text 块
 * - 图片元素原位输出为 image 块：直接出现的递归提取；叶子块内的
 *   图片后代（svg / ops:switch 等命名空间包装）按序补出——
 *   同一图片被 ops:case(svg) 与 ops:default(img) 双分支引用时按 src 去重
 * - 全章无块级标签（罕见）时回退 body 全文压缩空白
 * - 单张图片解析失败只跳过该图，不影响其余内容
 */
async function extractEpubBlocks(epubDoc, chapterPath, xhtmlDoc) {
  const blocks = []
  const seenSrc = new Set()
  const imageCount = () => blocks.filter((b) => b.type === 'image').length

  /** 解析并输出一个图片元素（超限跳过、失败跳过、同 src 去重） */
  const emitImage = async (el) => {
    if (imageCount() >= EPUB_MAX_IMAGES) return
    const src = await resolveEpubImage(epubDoc, chapterPath, el)
    if (src && !seenSrc.has(src)) {
      seenSrc.add(src)
      blocks.push({ type: 'image', src })
    }
  }

  const walk = async (el) => {
    if (isImageElement(el)) {
      await emitImage(el)
      return
    }

    const children = elementChildren(el)
    const hasBlockChild = children.some((n) => EPUB_BLOCK_TAGS.has(n.nodeName.toLowerCase()))
    if (EPUB_BLOCK_TAGS.has(el.nodeName.toLowerCase()) && !hasBlockChild) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (text) blocks.push({ type: 'text', text })
      // 叶子块内的图片后代（含 svg 包装的整页插图）在文字后原位补出
      for (const img of collectImageDescendants(el)) await emitImage(img)
      return
    }
    for (const child of children) await walk(child)
  }

  let body = xhtmlDoc.getElementsByTagName('body')[0]
  if (!body) {
    // 非 XHTML 章节（如纯 SVG 页面）：直接提取文档内全部图片
    const root = xhtmlDoc.documentElement
    for (const img of root ? collectImageDescendants(root) : []) await emitImage(img)
    return blocks
  }
  await walk(body)

  // 全章未使用块级标签的兜底：body 全文压缩空白作为一个 text 块
  if (blocks.length === 0) {
    const text = (body.textContent || '').replace(/\s+/g, ' ').trim()
    if (text) blocks.push({ type: 'text', text })
  }
  return blocks
}

/* ==================================================================== *
 *  目录提取（TOC）
 *  - EPUB：优先 nav（EPUB3）/ ncx（EPUB2）目录文件，均缺失时回退
 *          逐章提取首个 h1~h6 标题（仅含有标题的章节入目录）
 *  - PDF ：书签大纲（outline），逐条解析目标页码
 *  - TXT ：无目录（返回空数组）
 *  输出：[{ title, page, depth }]（page 为 1-based 页码，与对话模式「第 X / N 页」一致）
 * ==================================================================== */

/** 章节 zip 路径 → spine 序号（0-based）映射（同一文件多次出现取首次） */
function buildEpubSpineIndexMap(epubDoc) {
  const map = new Map()
  epubDoc.spine.forEach((idref, i) => {
    const item = epubDoc.manifest.get(idref)
    if (!item?.href) return
    const p = path.posix.normalize(path.posix.join(epubDoc.opfDir, item.href))
    if (!map.has(p)) map.set(p, i)
  })
  return map
}

/** 元素的指定标签祖先层数（目录缩进深度用） */
function ancestorCount(el, tagName) {
  let n = 0
  let p = el.parentNode
  while (p && p.nodeName) {
    if (p.nodeName.toLowerCase() === tagName) n++
    p = p.parentNode
  }
  return n
}

/**
 * 把一条目录条目（标题 + 章节引用）落入 entries
 * 引用解析不到 spine（如外部链接/已删章节）时静默跳过
 */
function pushEpubTocEntry(entries, indexMap, opfDir, title, href, depth = 0) {
  const cleanTitle = (title || '').replace(/\s+/g, ' ').trim()
  if (!cleanTitle || !href) return
  try {
    const clean = decodeURIComponent(String(href).split('#')[0])
    const p = path.posix.normalize(path.posix.join(opfDir, clean))
    const spineIndex = indexMap.get(p)
    if (spineIndex === undefined) return
    entries.push({ title: cleanTitle, page: spineIndex + 1, depth })
  } catch {
    /* 单条解析失败不影响整体 */
  }
}

/** EPUB 目录：nav/ncx 优先，逐章 h 标题兜底 */
async function extractEpubToc(epubDoc) {
  const indexMap = buildEpubSpineIndexMap(epubDoc)
  const entries = []

  // 1) EPUB3 nav（manifest 中 properties 含 nav 的 XHTML）
  const navItem = [...epubDoc.manifest.values()].find((m) => m.properties?.includes('nav'))
  if (navItem?.href) {
    const navPath = path.posix.normalize(path.posix.join(epubDoc.opfDir, navItem.href))
    const navFile = epubDoc.zip.file(navPath)
    if (navFile) {
      const navDoc = new DOMParser().parseFromString(
        await navFile.async('string'),
        'application/xhtml+xml',
      )
      // 目录内容取 epub:type="toc" 的 nav；无标注时退回全文所有链接
      const navs = Array.from(navDoc.getElementsByTagName('nav'))
      const tocNav = navs.find((n) => {
        const t = n.getAttribute('epub:type') || n.getAttribute('type') || ''
        return t === 'toc'
      })
      const root = tocNav || navDoc.getElementsByTagName('body')[0] || navDoc.documentElement
      for (const a of Array.from(root?.getElementsByTagName('a') || [])) {
        const depth = ancestorCount(a, 'ol') + ancestorCount(a, 'ul') - 1
        pushEpubTocEntry(entries, indexMap, epubDoc.opfDir, a.textContent, a.getAttribute('href'), Math.max(0, depth))
      }
      if (entries.length) return entries
    }
  }

  // 2) EPUB2 ncx（spine 的 toc 属性指向 manifest 条目）
  if (epubDoc.ncxId) {
    const ncxItem = epubDoc.manifest.get(epubDoc.ncxId)
    if (ncxItem?.href) {
      const ncxPath = path.posix.normalize(path.posix.join(epubDoc.opfDir, ncxItem.href))
      const ncxFile = epubDoc.zip.file(ncxPath)
      if (ncxFile) {
        const ncxDoc = new DOMParser().parseFromString(
          await ncxFile.async('string'),
          'application/xml',
        )
        for (const point of Array.from(ncxDoc.getElementsByTagName('navPoint'))) {
          const label = point.getElementsByTagName('navLabel')[0]?.getElementsByTagName('text')[0]
          const src = point.getElementsByTagName('content')[0]?.getAttribute('src') || ''
          const depth = ancestorCount(point, 'navPoint') - 1
          pushEpubTocEntry(entries, indexMap, epubDoc.opfDir, label?.textContent, src, Math.max(0, depth))
        }
        if (entries.length) return entries
      }
    }
  }

  // 3) 兜底：逐章提取首个 h1~h6 标题（无标题章节不入目录）
  for (let i = 0; i < epubDoc.spine.length; i++) {
    const item = epubDoc.manifest.get(epubDoc.spine[i])
    if (!item?.href) continue
    const chapterPath = path.posix.normalize(path.posix.join(epubDoc.opfDir, item.href))
    const chapterFile = epubDoc.zip.file(chapterPath)
    if (!chapterFile) continue
    const xhtmlDoc = new DOMParser().parseFromString(
      await chapterFile.async('string'),
      'application/xhtml+xml',
    )
    for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
      const els = xhtmlDoc.getElementsByTagName(tag)
      if (!els.length) continue
      const title = (els[0].textContent || '').replace(/\s+/g, ' ').trim()
      if (title) entries.push({ title, page: i + 1, depth: 0 })
      break
    }
  }
  return entries
}

/** PDF 目录：书签大纲（outline）递归展平，解析每条的目标页码 */
async function extractPdfToc(pdf) {
  let outline
  try {
    outline = await pdf.getOutline()
  } catch {
    return []
  }
  if (!outline?.length) return []
  const entries = []
  const walk = async (items, depth) => {
    for (const item of items) {
      let page = null
      try {
        let dest = item.dest
        if (typeof dest === 'string') dest = await pdf.getDestination(dest)
        if (Array.isArray(dest) && dest[0]) {
          page = (await pdf.getPageIndex(dest[0])) + 1
        }
      } catch {
        /* 单条解析失败不影响整体 */
      }
      const title = (item.title || '').trim()
      if (title) entries.push({ title, page, depth })
      if (item.items?.length) await walk(item.items, depth + 1)
    }
  }
  await walk(outline, 0)
  return entries
}

/**
 * 获取书籍目录
 * @param {Object} book shelf.json 中的书籍记录
 * @returns {Promise<Array<{title: string, page: number, depth: number}>>}
 *          空数组表示该书无目录（TXT / 无书签 PDF / 全无标题 EPUB）
 */
export async function getToc(book) {
  const absPath = path.join(ROOT, book.file)
  try {
    if (book.format === 'epub') {
      const doc = await getEpubDoc(absPath)
      return await extractEpubToc(doc)
    }
    if (book.format === 'pdf') {
      const pdf = await getPdfDoc(absPath)
      return await extractPdfToc(pdf)
    }
  } catch (err) {
    console.error('[bookReader] 目录解析失败：', err.message)
  }
  return []
}

/* ==================================================================== *
 *  对外接口：总页数 + 单页内容
 * ==================================================================== */

/**
 * 获取书籍总页数（EPUB 为总章节数）
 * @param {Object} book shelf.json 中的书籍记录
 * @returns {Promise<number>}
 */
export async function getTotalPages(book) {
  const absPath = path.join(ROOT, book.file)
  if (book.format === 'pdf') {
    const pdf = await getPdfDoc(absPath)
    return pdf.numPages
  }
  if (book.format === 'txt') {
    const text = fs.readFileSync(absPath, 'utf-8')
    return Math.max(1, Math.ceil(text.length / TXT_PAGE_SIZE))
  }
  if (book.format === 'epub') {
    const doc = await getEpubDoc(absPath)
    return doc.spine.length || 1
  }
  return 1
}

/**
 * 提取指定页内容为内容块序列
 * - PDF ：优先文字层；文字提取不出时渲染整页图片（纯图页不再附加提示文字）
 * - EPUB：章节内文字块与图片块按原文顺序交错
 * - TXT ：整段文字一个 text 块
 * @param {Object} book shelf.json 中的书籍记录
 * @param {number} pageNum 1-based 页码（EPUB 为章节序号）
 * @returns {Promise<{ blocks: Array<{type:'text',text}|{type:'image',src}>, totalPages: number }>}
 */
export async function extractPage(book, pageNum) {
  const absPath = path.join(ROOT, book.file)

  /* ---------- PDF：能提取文字就出文字，提取不出转整页图片 ---------- */
  if (book.format === 'pdf') {
    const pdf = await getPdfDoc(absPath)
    const totalPages = pdf.numPages
    const target = Math.max(1, Math.min(pageNum, totalPages))
    const page = await pdf.getPage(target)
    const textContent = await page.getTextContent()
    const content = textContent.items
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    // 文字层可读：只输出文字，不再渲染图片（也省去整页渲染开销）
    if (content.length >= PDF_MIN_TEXT_LEN) {
      return { blocks: [{ type: 'text', text: content }], totalPages }
    }

    // 无文字层（扫描版）：直接渲染整页图片，不附加提示文字
    const images = await renderPdfPageToImages(absPath, target)
    if (images.length > 0) {
      return { blocks: [{ type: 'image', src: images[0] }], totalPages }
    }
    // 图片渲染也失败（异常兜底）：给出可读的错误说明
    return { blocks: [{ type: 'text', text: `（第 ${target} 页内容加载失败，请重试）` }], totalPages }
  }

  /* ---------- TXT：固定字符数分页 ---------- */
  if (book.format === 'txt') {
    const text = fs.readFileSync(absPath, 'utf-8')
    const totalPages = Math.max(1, Math.ceil(text.length / TXT_PAGE_SIZE))
    const target = Math.max(1, Math.min(pageNum, totalPages))
    const start = (target - 1) * TXT_PAGE_SIZE
    const content = text.slice(start, start + TXT_PAGE_SIZE).trim()
    return { blocks: [{ type: 'text', text: content }], totalPages }
  }

  /* ---------- EPUB：文字块 + 图片块按原文顺序混合 ---------- */
  if (book.format === 'epub') {
    try {
      const doc = await getEpubDoc(absPath)
      const totalPages = doc.spine.length || 1
      const target = Math.max(1, Math.min(pageNum, totalPages))
      const item = doc.manifest.get(doc.spine[target - 1])
      if (!item?.href) {
        return { blocks: [{ type: 'text', text: '（本章在书刊清单中缺失）' }], totalPages }
      }
      // 章节 href 相对 OPF 目录解析为 zip 内路径
      const chapterPath = path.posix.normalize(path.posix.join(doc.opfDir, item.href))
      const chapterFile = doc.zip.file(chapterPath)
      if (!chapterFile) {
        return { blocks: [{ type: 'text', text: '（章节文件缺失）' }], totalPages }
      }
      const xhtml = await chapterFile.async('string')
      const xhtmlDoc = new DOMParser().parseFromString(xhtml, 'application/xhtml+xml')
      const blocks = await extractEpubBlocks(doc, chapterPath, xhtmlDoc)
      // 全章既无文字也无图片（如空白占位章节）时的明确提示
      if (blocks.length === 0) {
        return { blocks: [{ type: 'text', text: '（本章无内容）' }], totalPages }
      }
      return { blocks, totalPages }
    } catch (err) {
      return { blocks: [{ type: 'text', text: `EPUB 解析失败：${err.message}` }], totalPages: 1 }
    }
  }

  return { blocks: [{ type: 'text', text: `不支持的格式：${book.format}` }], totalPages: 1 }
}
