/**
 * AI 工具：OpenAI 通用接口（server/tools）
 *
 * 三个职责，全部走 OpenAI 兼容接口：
 * - askAI            对话提问（chat/completions，对话模式的 AI 功能）
 * - listModels       获取模型列表（GET /models，用户设置页「获取模型」按钮）
 * - testAIConnection 连接测试（发一条极短消息，用户设置页「测试AI」按钮）
 *
 * 连接信息（apiKey / baseUrl / model）来自 data/user.json；
 * listModels / testAIConnection 支持传入页面未保存的临时值（override），
 * 便于用户填完密钥先测试、通过后再保存。
 *
 * 失败时抛出带中文信息的 Error，由调用方捕获后提示用户（不中断服务）。
 * 网络请求经 netFetch（自动走系统/配置代理）。
 */

import { readUserConfig } from './userConfig.js'
import { netFetch } from './netFetch.js'

/** 对话提问超时（AI 生成较慢，给足 60s） */
const TIMEOUT_ASK = 60_000
/** 模型列表 / 连接测试超时 */
const TIMEOUT_PROBE = 30_000

/** 解析配置：显式传入的非空字符串优先，其余回落到 user.json */
function resolveConfig(override = {}) {
  const cfg = readUserConfig()
  return {
    apiKey: typeof override.apiKey === 'string' && override.apiKey.trim() ? override.apiKey.trim() : cfg.apiKey,
    baseUrl:
      typeof override.baseUrl === 'string' && /^https?:\/\//i.test(override.baseUrl.trim())
        ? override.baseUrl.trim().replace(/\/+$/, '')
        : cfg.baseUrl,
    model: typeof override.model === 'string' && override.model.trim() ? override.model.trim() : cfg.model,
  }
}

/** 公共前置校验：密钥与模型（模型为选择项，未选时不允许发起请求） */
function requireKeyAndModel(cfg) {
  if (!cfg.apiKey) {
    throw new Error('未配置 API 秘钥，请在「用户设置」页面填写')
  }
  if (!cfg.model) {
    throw new Error('未选择模型，请在「用户设置」页面获取并选择')
  }
}

/** 发起 chat/completions 请求（askAI 与 testAIConnection 共用） */
async function requestChat(cfg, content, timeoutMs) {
  let res
  try {
    res = await netFetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new Error('无法连接 AI 接口，请检查网络或在「用户设置」页面确认 API 地址')
  }

  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`AI 接口返回 ${res.status}${detail ? `：${detail}` : ''}`)
  }

  const data = await res.json().catch(() => null)
  const text = data?.choices?.[0]?.message?.content?.trim()
  if (!text) throw new Error('AI 返回内容为空')
  return text
}

/**
 * 向 AI 提问（对话模式的 AI 功能）
 * @param {string} question 用户输入的完整问题文本
 * @returns {Promise<string>} AI 回答文本
 */
export async function askAI(question) {
  const cfg = readUserConfig()
  requireKeyAndModel(cfg)
  return requestChat(cfg, question, TIMEOUT_ASK)
}

/**
 * 获取模型列表（OpenAI 兼容 GET /models）
 * @param {{apiKey?:string, baseUrl?:string}} override 页面临时值（可省略）
 * @returns {Promise<string[]>} 模型 id 列表（按字母排序）
 */
export async function listModels(override = {}) {
  const cfg = resolveConfig(override)
  if (!cfg.apiKey) {
    throw new Error('未配置 API 秘钥，请先填写后再获取模型')
  }

  let res
  try {
    res = await netFetch(`${cfg.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_PROBE),
    })
  } catch {
    throw new Error('无法连接接口，请检查网络或 API 地址')
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res)
    throw new Error(`接口返回 ${res.status}${detail ? `：${detail}` : ''}`)
  }

  const data = await res.json().catch(() => null)
  const models = Array.isArray(data?.data)
    ? data.data.map((m) => String(m?.id || '').trim()).filter(Boolean)
    : []
  if (!models.length) throw new Error('接口未返回任何模型')
  return [...new Set(models)].sort()
}

/**
 * 测试 AI 连接（发一条极短消息验证 密钥/地址/模型 全链路可用）
 * @param {{apiKey?:string, baseUrl?:string, model?:string}} override 页面临时值
 * @returns {Promise<string>} AI 回答文本（成功即连通）
 */
export async function testAIConnection(override = {}) {
  const cfg = resolveConfig(override)
  requireKeyAndModel(cfg)
  return requestChat(cfg, '连接测试，请回复「连接成功」', TIMEOUT_PROBE)
}

/** 从错误响应体尽力提取人类可读信息（OpenAI 兼容接口的 error.message） */
async function extractErrorDetail(res) {
  try {
    const data = await res.json()
    return data?.error?.message || ''
  } catch {
    return ''
  }
}
