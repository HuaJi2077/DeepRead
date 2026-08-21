/**
 * 对话数据持久化（SQLite）
 *
 * 使用 Node.js 22 内置的 node:sqlite（实验性），无需额外安装原生依赖。
 * 本地离线应用，数据库文件位于 data/database/ChatHistory.db（随 git 提交）。
 * 启动时自动迁移旧版数据文件（若存在），保证历史对话不丢失：
 * - data/database/chat.db → data/database/ChatHistory.db（改名迁移）
 * - data/deepread.db      → data/database/ChatHistory.db（最早版本位置）
 *
 * 表结构：
 * - conversations：对话元数据（id / 标题 / 当前阅读书籍 / 当前页码 / 创建时间）
 * - messages：消息记录（user / assistant，按 conversation_id 分组、时间排序）
 */

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'

/** 数据库目录（data/database）与文件（ChatHistory.db） */
const DB_DIR = path.join(DATA_DIR, 'database')
const DB_FILE = path.join(DB_DIR, 'ChatHistory.db')

// 首次运行时创建数据库目录（保持 data 目录结构完整，即使尚无数据文件）
fs.mkdirSync(DB_DIR, { recursive: true })

// 旧版数据库一次性迁移（迁移后旧文件被移走）
const LEGACY_DB_FILES = [path.join(DB_DIR, 'chat.db'), path.join(DATA_DIR, 'deepread.db')]
for (const legacy of LEGACY_DB_FILES) {
  if (fs.existsSync(legacy) && !fs.existsSync(DB_FILE)) {
    fs.renameSync(legacy, DB_FILE)
  }
}

// 抑制 Node.js 实验性 SQLite 警告（生产环境可改用 better-sqlite3）
const originalEmitWarning = process.emitWarning
process.emitWarning = (warning, ...args) => {
  const msg = typeof warning === 'string' ? warning : warning.message
  if (msg.includes('SQLite is an experimental feature')) return
  originalEmitWarning.call(process, warning, ...args)
}

const db = new DatabaseSync(DB_FILE)

// 启用外键约束
db.exec('PRAGMA foreign_keys = ON')

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    book_id TEXT,
    page_number INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    page_number INTEGER,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
`)

// blocks 列迁移：存放特殊消息的展示块 JSON（如目录指令的「可点击目录」）。
// 普通翻页消息不落库（图片是 base64 体积大，历史重建走 /page 按页提取），
// 仅目录这类「非页面内容」消息持久化，保证重进会话时目录链接不丢
{
  const cols = db.prepare('PRAGMA table_info(messages)').all()
  if (!cols.some((c) => c.name === 'blocks')) {
    db.exec('ALTER TABLE messages ADD COLUMN blocks TEXT')
  }
}

/**
 * 生成唯一对话 id
 * 前缀 conv_ + 时间戳 + 随机后缀，便于人工识别
 */
function generateId() {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 创建新对话
 * @param {string} title 对话标题（通常为书名）
 * @param {string|null} bookId 当前阅读的书籍 id
 * @returns {Object} 新创建对话
 */
export function createConversation(title, bookId = null) {
  const id = generateId()
  const now = new Date().toISOString()
  const stmt = db.prepare(
    'INSERT INTO conversations (id, title, book_id, page_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  stmt.run(id, title, bookId, 1, now, now)
  return { id, title, bookId, pageNumber: 1, createdAt: now, updatedAt: now }
}

/**
 * 更新对话的阅读进度
 * @param {string} id 对话 id
 * @param {Object} updates { title?, bookId?, pageNumber? }
 */
export function updateConversation(id, updates) {
  const fields = []
  const values = []
  if (updates.title !== undefined) {
    fields.push('title = ?')
    values.push(updates.title)
  }
  if (updates.bookId !== undefined) {
    fields.push('book_id = ?')
    values.push(updates.bookId)
  }
  if (updates.pageNumber !== undefined) {
    fields.push('page_number = ?')
    values.push(updates.pageNumber)
  }
  if (fields.length === 0) return
  fields.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)
  db.prepare(`UPDATE conversations SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}

/**
 * 按 id 查找对话
 */
export function getConversation(id) {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    bookId: row.book_id,
    pageNumber: row.page_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 列出全部对话（按更新时间倒序）
 */
export function listConversations() {
  const rows = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all()
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    bookId: row.book_id,
    pageNumber: row.page_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * 删除对话（级联删除消息）
 */
export function deleteConversation(id) {
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
}

/**
 * 清空全部对话（用户设置页「清空对话」）
 * 外键级联一并删除所有消息；返回删除前的对话数
 */
export function clearAllConversations() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n
  db.exec('DELETE FROM conversations')
  return count
}

/**
 * 添加一条消息
 * @param {string} conversationId 对话 id
 * @param {'user'|'assistant'} role 发送者角色
 * @param {string} content 消息内容
 * @param {number|null} pageNumber 阅读页码（可选）
 * @param {Array|null} blocks 展示块（可选，仅非页面内容消息如目录需要持久化；
 *        翻页消息传 null，历史重建由前端按 pageNumber 重新提取）
 */
export function addMessage(conversationId, role, content, pageNumber = null, blocks = null) {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO messages (conversation_id, role, content, page_number, blocks, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(conversationId, role, content, pageNumber, blocks ? JSON.stringify(blocks) : null, now)
  // 同步更新对话的 updated_at
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
}

/**
 * 搜索历史消息（基础文本匹配，LIKE 不区分 ASCII 大小写）
 * @param {string} keyword 搜索关键词
 * @param {number} limit 最多返回条数
 * @returns {Array<{id:number, conversation_id:string, role:string, content:string, created_at:string, conversation_title:string}>}
 */
export function searchMessages(keyword, limit = 100) {
  // LIKE 通配符转义：用户输入中的 % _ \ 都按字面量匹配
  const escaped = keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return db
    .prepare(
      `
      SELECT m.id, m.conversation_id, m.role, m.content, m.created_at,
             c.title AS conversation_title
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.content LIKE ? ESCAPE '\\'
      ORDER BY m.created_at DESC
      LIMIT ?
    `,
    )
    .all(`%${escaped}%`, limit)
}

/**
 * 获取对话的全部消息（按时间正序）
 * blocks 列为 JSON 字符串，解析失败按无 blocks 处理（前端降级为纯文本）
 */
export function getMessages(conversationId) {
  const rows = db
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId)
  return rows.map((row) => {
    let blocks = null
    if (row.blocks) {
      try {
        blocks = JSON.parse(row.blocks)
      } catch {
        blocks = null
      }
    }
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role,
      content: row.content,
      pageNumber: row.page_number,
      blocks,
      createdAt: row.created_at,
    }
  })
}
