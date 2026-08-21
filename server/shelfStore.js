/**
 * 书架数据存取层（shelf.json 读写）
 *
 * 职责单一：只负责书架 JSON 的读、写与记录查询/追加/删除，
 * 不关心 HTTP（路由层在 routes/shelf.js）。
 *
 * shelf.json 结构：BookRecord[]（新导入在前），字段说明：
 * - id        书籍唯一标识（前端生成，落盘文件名也用它）
 * - title     书名（≤200 字符）
 * - author    作者（≤120 字符）
 * - format    epub | pdf | txt
 * - file      书籍文件相对路径（data/books/xx.epub）
 * - cover     封面相对路径（data/covers/xx.jpg，可为 null）
 * - size      文件字节数
 * - addedAt   导入时间（ISO 字符串）
 * - progress  阅读进度百分比 0-100
 * - invalid   失效标记：书籍文件不存在时为 true（封面丢失不算失效）
 */

import fs from 'node:fs'
import { SHELF_FILE } from './config.js'

/** 读取书架（空文件 / 损坏 JSON 容错为空数组，保证服务不被单文件异常拖垮） */
export function readShelf() {
  try {
    const raw = fs.readFileSync(SHELF_FILE, 'utf-8').trim()
    if (!raw) return []
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/** 写回书架（2 空格缩进便于人工检查；末尾补换行） */
export function writeShelf(list) {
  fs.writeFileSync(SHELF_FILE, JSON.stringify(list, null, 2) + '\n', 'utf-8')
}

/** 按 id 查找书籍记录 */
export function findBook(list, id) {
  return list.find((b) => b.id === id)
}

/**
 * 追加或覆盖一条记录（同 id 重复导入则移除旧记录后置顶）
 * @returns 写回后的完整列表
 */
export function upsertBook(record) {
  const list = readShelf().filter((b) => b.id !== record.id)
  list.unshift(record)
  writeShelf(list)
  return list
}

/** 删除记录（仅移除 JSON 条目，不删文件；文件清理由路由层负责） */
export function removeBookRecord(id) {
  const list = readShelf()
  const target = list.find((b) => b.id === id)
  if (!target) return { target: null, list }
  writeShelf(list.filter((b) => b.id !== id))
  return { target, list }
}
