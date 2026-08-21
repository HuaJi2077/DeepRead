/**
 * 搜索工具：Wikipedia 开放接口（server/tools）
 *
 * 职责单一：把用户输入当关键词到中文维基百科搜索，
 * 取前 N 条结果的标题 + 简介 + 链接，拼成一段可读文本返回。
 *
 * 使用 MediaWiki API（无需密钥）：
 * 1. list=search   按关键词搜条目标题
 * 2. prop=extracts 取命中条目的导语纯文本（一次请求取回全部）
 *
 * 本功能依赖网络（请求经 netFetch 自动走系统/配置代理）；
 * 失败时抛出带中文信息的 Error，由 commandExecutor 捕获后
 * 以「搜索失败：xxx」的形式回复用户。
 */

import { netFetch } from './netFetch.js'
import { readUserConfig } from './userConfig.js'

const API_ROOT = 'https://zh.wikipedia.org/w/api.php'
const TIMEOUT_MS = 15_000
const HEADERS = {
  // MediaWiki 规范：要求客户端携带可识别的 User-Agent
  'User-Agent': 'DeepRead/1.0 (local reading app)',
}

/** 结果末尾的版权提示（维基百科内容遵循 CC BY-SA 4.0，展示时须附署名说明） */
const ATTRIBUTION = '—— 以上内容来自维基百科（Wikipedia），遵循 CC BY-SA 4.0 协议授权'

/** 展示条目数：读用户设置（1-5，默认 3），配置异常时由 userConfig 兜底 */
function resultLimit() {
  return readUserConfig().searchCount
}

/**
 * 搜索 Wiki
 * @param {string} keyword 关键词（用户原样输入）
 * @returns {Promise<string>} 拼好的多行搜索结果文本
 * @throws 网络失败 / 接口异常时抛出中文错误信息
 */
export async function searchWiki(keyword) {
  const limit = resultLimit()
  // 第一步：关键词 → 条目标题列表
  const searchUrl =
    `${API_ROOT}?action=query&format=json&utf8=1&list=search` +
    `&srsearch=${encodeURIComponent(keyword)}&srlimit=${limit}`
  let titles
  try {
    const data = await getJSON(searchUrl)
    titles = (data?.query?.search || []).map((s) => s.title)
  } catch (err) {
    throw new Error(`${err.message}（Wiki 搜索需要保持网络通畅）`)
  }

  if (!titles.length) {
    return `Wiki 中没有找到与「${keyword}」相关的条目`
  }

  // 第二步：条目标题 → 导语摘要（titles 一次请求全部取回）
  let extracts = {}
  try {
    const extractUrl =
      `${API_ROOT}?action=query&format=json&utf8=1&prop=extracts` +
      `&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(titles.join('|'))}`
    const data = await getJSON(extractUrl)
    extracts = data?.query?.pages || {}
  } catch {
    // 摘要失败不致命：仍展示标题与链接
  }

  // 拼装结果：按搜索顺序编号，摘要过长截断
  const lines = [`「${keyword}」的 Wiki 搜索结果（前 ${titles.length} 条）：`, '']
  titles.forEach((title, i) => {
    const page = Object.values(extracts).find((p) => p.title === title)
    const extract = String(page?.extract || '').replace(/\s+/g, ' ').trim()
    const brief = extract.length > 200 ? `${extract.slice(0, 200)}…` : extract
    lines.push(`${i + 1}. ${title}`)
    if (brief) lines.push(brief)
    lines.push(`链接：https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`)
    if (i < titles.length - 1) lines.push('')
  })
  lines.push('', ATTRIBUTION)
  return lines.join('\n')
}

/** 请求 JSON 接口（带超时），非 200 或解析失败抛中文错误 */
async function getJSON(url) {
  let res
  try {
    res = await netFetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch {
    throw new Error('无法连接 Wiki 接口')
  }
  if (!res.ok) throw new Error(`Wiki 接口返回 ${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new Error('Wiki 接口返回了无法解析的内容')
  }
}
