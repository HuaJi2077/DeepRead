/**
 * 阅读进度相关共享工具（纯函数，无浏览器/Node 依赖，前后端均可引用）
 *
 * 统一出口，避免以下逻辑在多处分叉：
 * - 阅读器（BookReader.vue / ReadingView.vue）
 * - 书架网格与详情（BookGrid.vue / ShelfView.vue）
 * - 对话式阅读页码提示（server/commandExecutor.js）
 */

/**
 * 将任意输入规范化为 0-100 的整数进度百分比
 * @param {unknown} value 原始进度值（可能为 null / undefined / NaN / 超界数）
 * @returns {number} 0-100 的整数
 */
export function normalizeProgress(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * 由页码计算阅读进度百分比
 * @param {number} pageNum 当前页码（1-based）
 * @param {number} totalPages 总页数
 * @returns {number} 0-100 的整数
 */
export function calcProgressByPage(pageNum, totalPages) {
  if (!Number.isFinite(totalPages) || totalPages <= 0) return 0
  return normalizeProgress((pageNum / totalPages) * 100)
}

/**
 * 生成对话式阅读的页码提示头
 * 示例：「《局外人》第 1 / 98 页  已读：1%」
 * @param {string} bookTitle 书名
 * @param {number} pageNum 当前页码（1-based）
 * @param {number} totalPages 总页数
 * @param {string} [unit] 计数单位（默认「页」；EPUB 按 spine 章节计数时传「章」）
 * @returns {string}
 */
export function formatPageHeader(bookTitle, pageNum, totalPages, unit = '页') {
  return `《${bookTitle}》第 ${pageNum} / ${totalPages} ${unit}  已读：${calcProgressByPage(pageNum, totalPages)}%`
}
