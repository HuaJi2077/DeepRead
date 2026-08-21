/**
 * 书架 API 路由（挂载于 /api/shelf）
 *
 * 接口一览：
 * - GET    /api/shelf          获取书架列表（附带失效检测与旧记录字段补全）
 * - POST   /api/shelf/upload   导入书籍（multipart：book/cover/meta）
 * - PATCH  /api/shelf/:id      更新书籍信息（重命名 / 阅读进度）
 * - DELETE /api/shelf/:id      移除书籍（同时删除书籍与封面文件）
 * - DELETE /api/shelf/books    清空书架（用户设置页，删除全部书籍与封面）
 */

import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROOT,
  BOOKS_DIR,
  COVERS_DIR,
  UPLOAD_SIZE_LIMIT,
  ALLOWED_EXT,
  ALLOWED_EXT_NAMES,
  ALLOWED_COVER_EXT,
  ID_PATTERN,
} from '../config.js'
import { readShelf, writeShelf, findBook, upsertBook, removeBookRecord } from '../shelfStore.js'
import { getToc } from '../bookReader.js'

const router = express.Router()

// 导入走内存缓冲再一次性落盘（本地离线应用，文件均为几 MB 级）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_SIZE_LIMIT },
})

/**
 * 获取书架列表
 * 同时做失效检测：书籍文件不存在 → 标记 invalid: true 并落盘。
 * 注意：仅检查书籍本体文件；封面丢失不算失效（仍可用占位封面展示）
 */
router.get('/', (req, res) => {
  // 禁用缓存：否则浏览器可能复用旧响应，后端拿不到请求、失效检测与最新列表都无法送达前端
  res.set('Cache-Control', 'no-store')
  const books = readShelf()
  let dirty = false
  for (const b of books) {
    const exists = fs.existsSync(path.join(ROOT, b.file))
    const invalid = !exists
    if (b.invalid !== invalid) {
      b.invalid = invalid
      dirty = true
    }
    // 兼容旧记录：缺进度字段的补 0
    if (typeof b.progress !== 'number') {
      b.progress = 0
      dirty = true
    }
  }
  if (dirty) writeShelf(books)
  res.json({ books })
})

/**
 * 获取书籍目录（阅读模式目录按钮）
 * - EPUB：nav/ncx 目录（回退逐章标题）
 * - PDF ：书签大纲
 * - TXT ：无目录（空数组 → 前端按钮禁用）
 */
router.get('/toc', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const bookId = String(req.query.bookId || '')
    const book = readShelf().find((b) => b.id === bookId && !b.invalid)
    if (!book) return res.status(404).json({ error: '书籍不存在或已失效' })
    const toc = await getToc(book)
    res.json({ toc })
  } catch (err) {
    res.status(500).json({ error: `目录解析失败：${err.message}` })
  }
})

/**
 * 导入书籍（multipart/form-data）
 * - book：书籍文件（epub/pdf/txt，白名单校验）
 * - cover：封面图片（可选，前端提取/生成）
 * - meta：JSON 字符串 { id, title, author, format, size, addedAt }
 * 文件以 id 重命名存储，避免中文文件名与路径问题
 */
router.post(
  '/upload',
  upload.fields([
    { name: 'book', maxCount: 1 },
    { name: 'cover', maxCount: 1 },
  ]),
  (req, res) => {
    try {
      const bookFile = req.files?.book?.[0]
      const coverFile = req.files?.cover?.[0]
      if (!bookFile) return res.status(400).json({ error: '缺少书籍文件' })

      let meta = {}
      try {
        meta = JSON.parse(String(req.body.meta || '{}'))
      } catch {
        meta = {}
      }

      // id 白名单校验：id 会拼进落盘路径，必须杜绝「../」等路径穿越片段；
      // 非法或缺失时服务端自行生成
      let id = typeof meta.id === 'string' ? meta.id : ''
      if (!ID_PATTERN.test(id)) {
        id = `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      }

      // 扩展名双重校验：mimetype 白名单 + 文件名后缀兜底
      let ext = ALLOWED_EXT[bookFile.mimetype]
      const nameExt = path.extname(bookFile.originalname || '').toLowerCase()
      if (!ext && ALLOWED_EXT_NAMES.includes(nameExt)) ext = nameExt
      if (!ext) {
        return res.status(400).json({ error: `不支持的格式：${bookFile.mimetype || nameExt || '未知'}` })
      }

      const relBook = `data/books/${id}${ext}`
      fs.writeFileSync(path.join(ROOT, relBook), bookFile.buffer)

      // 封面可选：没有封面时前端会生成占位图，一般都会传。
      // 扩展名按图片白名单校验，非法扩展名一律回退 .jpg
      let relCover = null
      if (coverFile) {
        const rawExt = (path.extname(coverFile.originalname || '') || '.jpg').toLowerCase()
        const coverExt = ALLOWED_COVER_EXT.includes(rawExt) ? rawExt : '.jpg'
        relCover = `data/covers/${id}${coverExt}`
        fs.writeFileSync(path.join(ROOT, relCover), coverFile.buffer)
      }

      const record = {
        id,
        title: (meta.title || path.basename(bookFile.originalname || '未命名', nameExt) || '未命名').slice(0, 200),
        author: (meta.author || '未知作者').slice(0, 120),
        format: ext.slice(1), // epub | pdf | txt
        file: relBook,
        cover: relCover,
        size: meta.size ?? bookFile.size,
        addedAt: meta.addedAt || new Date().toISOString(),
        progress: 0,
        invalid: false,
      }

      // 追加并落盘；同 id 重复导入则覆盖旧记录
      upsertBook(record)
      res.json({ book: record })
    } catch (err) {
      res.status(500).json({ error: `导入失败：${err.message}` })
    }
  },
)

/**
 * 更新书籍信息（重命名 / 阅读进度）
 * body: { title?: string, progress?: 0-100 数字（阅读进度百分比） }
 * 写入 shelf.json，与前端列表即时同步
 */
router.patch('/:id', (req, res) => {
  const books = readShelf()
  const b = findBook(books, req.params.id)
  if (!b) return res.status(404).json({ error: '书籍不存在' })
  const { title, progress } = req.body || {}
  if (typeof title === 'string' && title.trim()) {
    b.title = title.trim().slice(0, 200)
  }
  if (progress !== undefined && progress !== null) {
    b.progress = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)))
  }
  writeShelf(books)
  res.json({ book: b })
})

/** 清空书架（用户设置页「清空书架」）：删除全部书籍/封面文件并清空 shelf.json。须注册在 DELETE /:id 之前 */
router.delete('/books', (req, res) => {
  try {
    const books = readShelf()
    let removed = 0
    for (const b of books) {
      for (const rel of [b.file, b.cover]) {
        if (!rel) continue
        const abs = path.join(ROOT, rel)
        if (!fs.existsSync(abs)) continue
        try {
          fs.rmSync(abs)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[shelf:clear] 文件删除失败，已跳过：${abs} - ${err.message}`)
        }
      }
      removed++
    }
    writeShelf([])
    // 目录保障：清空后 books/covers 目录必须仍然存在（空目录）
    fs.mkdirSync(BOOKS_DIR, { recursive: true })
    fs.mkdirSync(COVERS_DIR, { recursive: true })
    res.json({ ok: true, count: removed })
  } catch (err) {
    res.status(500).json({ error: `清空书架失败：${err.message}` })
  }
})

/**
 * 移除书籍（同时删除书籍文件与封面文件）
 * 入口：书架页卡片菜单「删除」
 */
router.delete('/:id', (req, res) => {
  const { target } = removeBookRecord(req.params.id)
  if (!target) return res.status(404).json({ error: '书籍不存在' })
  // 记录中的文件路径均来自服务端写入的相对路径，仍逐个做存在性检查后再删除。
  // 文件删除异常单独捕获：避免某文件被外部删除/权限问题导致整个请求失败。
  for (const rel of [target.file, target.cover]) {
    if (!rel) continue
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) continue
    try {
      fs.rmSync(abs)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[shelf:delete] 文件删除失败，已跳过：${abs} - ${err.message}`)
    }
  }
  // 目录保障：删除最后一本书后 books/covers 目录必须仍然存在（空目录），
  // 目录结构不随书籍数量变化而消失
  fs.mkdirSync(BOOKS_DIR, { recursive: true })
  fs.mkdirSync(COVERS_DIR, { recursive: true })
  res.json({ ok: true })
})

export default router
