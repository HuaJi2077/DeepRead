/**
 * 对话 API 路由（挂载于 /api/chat）
 *
 * 接口一览：
 * - GET    /api/chat/commands       获取指令配置列表（data/commands.json）
 * - GET    /api/chat/conversations  获取对话列表
 * - POST   /api/chat/conversations  预创建空对话（前端发送后立即进入对话页）
 * - GET    /api/chat/page           按书籍+页码重建内容块（历史会话图片恢复）
 * - GET    /api/chat/:id            获取单条对话及其消息
 * - POST   /api/chat/execute        执行用户输入的指令
 * - PATCH  /api/chat/:id            重命名对话（body { title }）
 * - DELETE /api/chat/:id            删除对话
 * - DELETE /api/chat/conversations  清空全部对话（用户设置页）
 */

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import {
  clearAllConversations,
  createConversation,
  deleteConversation,
  getConversation,
  getMessages,
  listConversations,
  searchMessages,
  updateConversation,
} from '../chatStore.js'
import { executeCommand } from '../commandExecutor.js'
import { extractPage } from '../bookReader.js'
import { readShelf } from '../shelfStore.js'
import { formatPageHeader } from '../../src/utils/reading.js'
import { DATA_DIR } from '../config.js'

const router = express.Router()

/** 获取指令配置列表（前端加载后用于本地解析/提示） */
router.get('/commands', (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const commands = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'commands.json'), 'utf-8'))
    res.json({ commands })
  } catch (err) {
    res.status(500).json({ error: `读取指令配置失败：${err.message}` })
  }
})

/** 获取对话列表 */
router.get('/conversations', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ conversations: listConversations() })
})

/**
 * 预创建空对话
 * 用途：前端发送指令前先拿到对话 id，立即跳转对话页展示加载状态，
 * 而不是停留在主页等待。后续 /execute 传入该 id 即复用此对话。
 */
router.post('/conversations', (req, res) => {
  try {
    const conv = createConversation('新对话', null)
    res.status(201).json({ conversationId: conv.id, title: conv.title })
  } catch (err) {
    res.status(500).json({ error: `创建对话失败：${err.message}` })
  }
})

/**
 * 按书籍 + 页码重建内容块（含图片）
 * 用途：图片不入库（SQLite 只存文字），重新打开历史会话时由前端调用本接口，
 * 从原电子书文件重新提取该页的完整 blocks（文字 + 图片）。
 * 书籍不存在/已失效时返回 404，前端回退为仅显示库内文字。
 */
router.get('/page', async (req, res) => {
  res.set('Cache-Control', 'no-store')
  try {
    const bookId = String(req.query.bookId || '')
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1)
    const book = readShelf().find((b) => b.id === bookId && !b.invalid)
    if (!book) return res.status(404).json({ error: '书籍不存在或已失效' })

    const { blocks, totalPages } = await extractPage(book, pageNum)
    const unit = book.format === 'epub' ? '章' : '页'
    const header = formatPageHeader(book.title, pageNum, totalPages, unit)
    res.json({
      blocks: [{ type: 'header', text: header }, ...blocks],
      totalPages,
      unit,
    })
  } catch (err) {
    res.status(500).json({ error: `内容重建失败：${err.message}` })
  }
})

/**
 * 搜索历史对话消息（搜索页）
 * - 关键词为空返回空结果；否则 LIKE 匹配消息正文，时间倒序，最多 100 条
 * - 每条结果附摘要片段：关键词前 30 字 / 后 80 字，越界补省略号
 * - 前端据此渲染关键词高亮，点击跳转对应对话页
 */
router.get('/search', (req, res) => {
  res.set('Cache-Control', 'no-store')
  const q = String(req.query.q || '').trim()
  if (!q) return res.json({ results: [] })
  try {
    const rows = searchMessages(q, 100)
    const results = rows.map((row) => ({
      conversationId: row.conversation_id,
      title: row.conversation_title,
      role: row.role,
      snippet: buildSnippet(row.content, q),
      createdAt: row.created_at,
    }))
    res.json({ results })
  } catch (err) {
    res.status(500).json({ error: `搜索失败：${err.message}` })
  }
})

/** 摘要：压缩空白后按关键词位置截取片段（单行展示），越界补省略号 */
function buildSnippet(content, keyword) {
  const flat = String(content).replace(/\s+/g, ' ').trim()
  const idx = flat.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx === -1) {
    return flat.length > 110 ? `${flat.slice(0, 110)}…` : flat
  }
  const kwEnd = idx + keyword.length
  const start = Math.max(0, idx - 30)
  const end = Math.min(flat.length, kwEnd + 80)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

/** 获取单条对话及消息 */
router.get('/:id', (req, res) => {
  res.set('Cache-Control', 'no-store')
  const conv = getConversation(req.params.id)
  if (!conv) return res.status(404).json({ error: '对话不存在' })
  res.json({ conversation: conv, messages: getMessages(conv.id) })
})

/**
 * 执行指令：body { input, conversationId?, tool? }
 * tool 为未定义指令的处理工具（'ai' | 'search' | 缺省），由前端
 * 输入框左下角的「AI 功能 / 搜索功能」开关决定（两者互斥）
 */
router.post('/execute', async (req, res) => {
  try {
    const { input, conversationId, tool } = req.body || {}
    if (typeof input !== 'string' || !input.trim()) {
      return res.status(400).json({ error: '缺少输入内容' })
    }
    const validTool = tool === 'ai' || tool === 'search' ? tool : null
    const result = await executeCommand(input.trim(), conversationId || null, validTool)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: `执行失败：${err.message}` })
  }
})

/** 重命名对话：body { title } */
router.patch('/:id', (req, res) => {
  const conv = getConversation(req.params.id)
  if (!conv) return res.status(404).json({ error: '对话不存在' })
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  if (!title) return res.status(400).json({ error: '标题不能为空' })
  updateConversation(conv.id, { title })
  res.json({ ok: true, title })
})

/** 清空全部对话（用户设置页「清空对话」）。须注册在 DELETE /:id 之前 */
router.delete('/conversations', (req, res) => {
  try {
    const count = clearAllConversations()
    res.json({ ok: true, count })
  } catch (err) {
    res.status(500).json({ error: `清空对话失败：${err.message}` })
  }
})

/** 删除对话 */
router.delete('/:id', (req, res) => {
  deleteConversation(req.params.id)
  res.json({ ok: true })
})

export default router
