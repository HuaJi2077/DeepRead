/**
 * DeepRead 本地后端入口（离线运行，无外部网络依赖）
 *
 * 职责：
 * 1. 书架数据落盘：所有书籍信息记录在 data/shelf.json（不用浏览器存储），
 *    前端每次进入书架页通过 GET /api/shelf 读取，实现「下次打开自动链接」
 * 2. 书籍文件管理：导入的 EPUB/PDF/TXT 保存到 data/books/，
 *    前端提取的封面图保存到 data/covers/
 * 3. 失效检测：GET /api/shelf 时逐本检查书籍文件是否仍存在，
 *    文件丢失 → 在 shelf.json 中标记 invalid: true（封面渲染为「已失效」）
 * 4. 静态服务：/data 提供书籍/封面文件访问；
 *    若存在 dist/（生产构建）则同时托管前端页面，单进程离线部署
 *
 * 模块划分（便于扩展，新增 API 时在 routes/ 下建文件并在下方挂载即可）：
 * - config.js      全局配置（端口/目录/上传限制/格式白名单）
 * - shelfStore.js  shelf.json 存取层（与 HTTP 无关）
 * - chatStore.js   SQLite 对话存取层（与 HTTP 无关）
 * - routes/shelf.js 书架 API 路由（/api/shelf）
 * - routes/chat.js  对话/指令 API 路由（/api/chat）
 * - staticServe.js 静态资源服务（/data 与 dist 托管）
 *
 * 端口：38617（冷门端口，避免与 Vite dev 5173 等常用端口冲突）
 * 启动：npm run server（开发时由 Vite 代理 /api 与 /data 到本服务）
 */

// node:sqlite 需要 Node.js 22+；如果版本不足，尽早给出清晰提示。
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  console.error(
    `[DeepRead] 当前 Node.js 版本为 ${process.versions.node}，本项目需要 Node.js 22 或更高版本。\n` +
      `原因：对话数据库使用内置的 node:sqlite 模块，该模块从 Node.js 22 开始提供。\n\n` +
      `请升级到 Node.js 22+ 后再运行，例如：\n` +
      `  - 使用 nvm-windows / fnm 安装并切换到 Node 22\n` +
      `  - 或从 https://nodejs.org 下载 LTS 版本安装包\n\n` +
      `如果你暂时无法升级 Node，可以回复“兼容 Node 20”，我会把数据库改为 sql.js（纯 WASM，无需升级）。`,
  )
  process.exit(1)
}

import express from 'express'
import fs from 'node:fs'
import { BOOKS_DIR, COVERS_DIR, PORT, SHELF_FILE } from './config.js'
import shelfRouter from './routes/shelf.js'
import chatRouter from './routes/chat.js'
import settingsRouter from './routes/settings.js'
import { registerStatic } from './staticServe.js'

// 启动时确保数据目录存在（首次运行自动创建，避免导入时写文件报错）
fs.mkdirSync(BOOKS_DIR, { recursive: true })
fs.mkdirSync(COVERS_DIR, { recursive: true })

const app = express()

// JSON body 解析（PATCH 重命名/进度同步用；调大限制以兼容大 meta 载荷）
app.use(express.json({ limit: '10mb' }))

// 书架 API：/api/shelf 及其子路径
app.use('/api/shelf', shelfRouter)

// 对话/指令 API：/api/chat 及其子路径
app.use('/api/chat', chatRouter)

// 用户设置 API：/api/settings 及其子路径
app.use('/api/settings', settingsRouter)

// 静态资源：/data 数据目录 + dist 生产托管
registerStatic(app)

app.listen(PORT, () => {
  console.log(`[DeepRead] 本地服务已启动：http://127.0.0.1:${PORT}`)
  console.log(`[DeepRead] 书架数据：${SHELF_FILE}`)
})
