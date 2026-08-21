/**
 * 用户配置读写（data/user.json）
 *
 * 集中存放全局设置与 AI 功能所需的连接信息（OpenAI 通用接口格式）：
 * - apiKey          API 密钥（敏感信息，注意不要把已填密钥的文件提交到公开仓库）
 * - baseUrl         接口根地址（可换成任何 OpenAI 兼容服务）
 * - model           模型名（默认为空，需在「用户设置」页获取并选择）
 * - proxy           HTTP 代理地址（空串 = 自动检测环境变量与 Windows 系统代理）
 * - displayName     显示名称（侧边栏用户卡块文案，≤10 字符，空 = 默认「用户」）
 * - bossKey         老板键（KeyboardEvent.key，默认 F3；按下即跳转官方网站）
 * - darkMode        暗黑模式开关（前端 body[data-ds-dark-theme]）
 * - rememberProgress 记忆阅读进度（阅读模式打开书自动跳到上次位置）
 * - searchCount     Wiki 搜索展示条目数（1-5，默认 3）
 *
 * 读侧容错：文件缺失 / 损坏 JSON / 字段缺失或类型不符时按默认值兜底；
 * 写侧（用户设置页实时保存）先合并当前值再做同样的规范化，保证落盘结构完整。
 */

import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from '../config.js'

const CONFIG_FILE = path.join(DATA_DIR, 'user.json')

const DEFAULTS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  proxy: '',
  displayName: '用户',
  bossKey: 'F3',
  darkMode: false,
  rememberProgress: true,
  searchCount: 3,
}

/** 整数收敛：非数字回默认值，超出范围取边界 */
function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * 规范化配置对象：类型修正 + 边界约束，任何非法输入都收敛为合法值
 * @param {Object} raw 任意来源的配置（文件内容 / 请求体）
 */
function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const baseUrl =
    typeof src.baseUrl === 'string' && /^https?:\/\//i.test(src.baseUrl.trim())
      ? src.baseUrl.trim().replace(/\/+$/, '')
      : DEFAULTS.baseUrl
  return {
    apiKey: typeof src.apiKey === 'string' ? src.apiKey.trim() : DEFAULTS.apiKey,
    baseUrl,
    model: typeof src.model === 'string' ? src.model.trim() : DEFAULTS.model,
    proxy: typeof src.proxy === 'string' ? src.proxy.trim() : DEFAULTS.proxy,
    displayName:
      typeof src.displayName === 'string' && src.displayName.trim()
        ? Array.from(src.displayName.trim()).slice(0, 10).join('')
        : DEFAULTS.displayName,
    bossKey:
      typeof src.bossKey === 'string' && src.bossKey.trim()
        ? src.bossKey.trim().slice(0, 20)
        : DEFAULTS.bossKey,
    darkMode: src.darkMode === true,
    rememberProgress: src.rememberProgress !== false,
    searchCount: clampInt(src.searchCount, 1, 5, DEFAULTS.searchCount),
  }
}

/** 读取用户配置（缺文件 / 损坏 JSON / 缺字段时按默认值兜底） */
export function readUserConfig() {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')))
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * 合并写入用户配置（用户设置页实时保存）
 * @param {Object} patch 本次变更的字段（只合并传入项）
 * @returns {Object} 落盘后的完整配置
 */
export function writeUserConfig(patch) {
  const merged = normalizeConfig({ ...readUserConfig(), ...(patch || {}) })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
  return merged
}

/** 重置为默认设置（不动对话与书架数据，仅配置本身） */
export function resetUserConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf-8')
  return { ...DEFAULTS }
}
