/**
 * 用户设置 API 路由（挂载于 /api/settings）
 *
 * 接口一览：
 * - GET  /api/settings        读取用户设置（data/user.json，缺字段按默认兜底）
 * - PUT  /api/settings        保存设置（body 为变更字段的子集，实时生效）
 * - POST /api/settings/reset  重置全部设置为默认值（不影响对话与书架数据）
 * - POST /api/settings/models 获取模型列表（body { apiKey?, baseUrl? } 可传页面临时值）
 * - POST /api/settings/test   测试 AI 连接（body { apiKey?, baseUrl?, model? }）
 *
 * models / test 支持传入未保存的临时值：用户在设置页填完密钥/地址后
 * 可以先测试连通再保存，无需「先保存才能测」的两步往返。
 */

import express from 'express'
import { readUserConfig, writeUserConfig, resetUserConfig } from '../tools/userConfig.js'
import { listModels, testAIConnection } from '../tools/aiClient.js'

const router = express.Router()

/** 允许实时保存的字段白名单（与 userConfig 字段一一对应） */
const WRITABLE_KEYS = ['apiKey', 'baseUrl', 'model', 'proxy', 'displayName', 'bossKey', 'darkMode', 'rememberProgress', 'searchCount']

/** 读取设置 */
router.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json(readUserConfig())
})

/** 保存设置：只取白名单字段合并写入（userConfig 内部做类型/边界规范化） */
router.put('/', (req, res) => {
  try {
    const patch = {}
    const body = req.body || {}
    for (const key of WRITABLE_KEYS) {
      if (body[key] !== undefined) patch[key] = body[key]
    }
    res.json(writeUserConfig(patch))
  } catch (err) {
    res.status(500).json({ error: `设置保存失败：${err.message}` })
  }
})

/** 重置全部设置 */
router.post('/reset', (req, res) => {
  try {
    res.json(resetUserConfig())
  } catch (err) {
    res.status(500).json({ error: `设置重置失败：${err.message}` })
  }
})

/** 获取模型列表（502 = 上游接口/网络异常，错误信息带中文说明） */
router.post('/models', async (req, res) => {
  try {
    const { apiKey, baseUrl } = req.body || {}
    const models = await listModels({ apiKey, baseUrl })
    res.json({ models })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

/** 测试 AI 连接（成功返回 AI 回答原文，失败 502 带中文错误信息） */
router.post('/test', async (req, res) => {
  try {
    const { apiKey, baseUrl, model } = req.body || {}
    const reply = await testAIConnection({ apiKey, baseUrl, model })
    res.json({ ok: true, reply })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})

export default router
