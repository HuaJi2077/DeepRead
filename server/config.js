/**
 * DeepRead 后端全局配置
 *
 * 集中管理端口、目录路径、上传限制与格式白名单，
 * 便于部署或目录结构调整时统一修改（各模块从这里读取，不做硬编码）。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 项目根目录（server/ 的上一级） */
export const ROOT = path.resolve(__dirname, '..')

/**
 * 数据目录：书架 JSON、书籍文件与封面均存放于此（前端经 /data 访问）
 *
 * 支持环境变量 DEEPREAD_DATA_DIR 覆盖（Electron 桌面版使用）：
 * 打包后的应用资源目录只读，可写数据须落到系统用户目录，
 * 由 electron/main.js 启动后端时注入该变量。
 */
export const DATA_DIR = process.env.DEEPREAD_DATA_DIR
  ? path.resolve(process.env.DEEPREAD_DATA_DIR)
  : path.join(ROOT, 'data')
export const BOOKS_DIR = path.join(DATA_DIR, 'books')   // 导入的 EPUB/PDF/TXT
export const COVERS_DIR = path.join(DATA_DIR, 'covers') // 前端提取/生成的封面图
export const SHELF_FILE = path.join(DATA_DIR, 'shelf.json') // 书架数据落盘文件（全小写命名）

/** 前端构建产物目录（存在时由后端托管，单进程离线部署） */
export const DIST_DIR = path.join(ROOT, 'dist')

/** 监听端口（冷门端口，避免与 Vite dev 5173 等常用端口冲突） */
export const PORT = 38617

/** 单个上传文件大小上限（书籍/封面，200MB） */
export const UPLOAD_SIZE_LIMIT = 200 * 1024 * 1024

/**
 * 允许导入的书籍格式：
 * key   = 客户端声明的 mimetype（multer 依据浏览器判断）
 * value = 落盘使用的扩展名
 */
export const ALLOWED_EXT = {
  'application/epub+zip': '.epub',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
}

/** 兜底扩展名白名单：mimetype 缺失/陌生时按文件名后缀二次校验 */
export const ALLOWED_EXT_NAMES = ['.epub', '.pdf', '.txt']

/** 允许的封面图片扩展名（其余一律回退为 .jpg，防止伪造扩展名写出异常文件） */
export const ALLOWED_COVER_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.gif']

/**
 * 书籍 id 白名单字符（字母/数字/下划线/连字符）
 * id 会拼进落盘路径（data/books/{id}{ext}），做白名单校验可杜绝
 * 「../」之类路径穿越片段混入文件名
 */
export const ID_PATTERN = /^[\w-]{1,64}$/
