/**
 * 用户设置状态管理（Pinia）
 *
 * 数据持久化在 data/user.json（后端 /api/settings 读写），前端不落浏览器存储：
 * - load()  应用启动时拉取一次（App.vue），失败保持默认值不打断界面
 * - save()  用户设置页实时保存（各控件变更即调用，无需保存按钮）：
 *           先乐观应用到本地状态并立即切换暗黑主题，失败时重新 load() 回滚
 * - applyTheme() 暗黑模式开关 → body[data-ds-dark-theme]（19-dark-theme.css 挂钩）
 *
 * 字段说明见 server/tools/userConfig.js；
 * rememberProgress 由阅读器（BookReader.vue）打开书时消费。
 */

import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    loaded: false,          // 是否已从后端加载（避免页面抢先显示默认值再跳变）
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    proxy: '',
    displayName: '用户',
    bossKey: 'F3',         // 老板键（App.vue 全局监听，按下跳转官方网站）
    darkMode: false,
    rememberProgress: true,
    searchCount: 3,
  }),

  actions: {
    /** 暗黑主题开/关：变量覆盖全部定义在 body[data-ds-dark-theme] 上 */
    applyTheme() {
      if (this.darkMode) document.body.setAttribute('data-ds-dark-theme', '')
      else document.body.removeAttribute('data-ds-dark-theme')
    },

    /** 应用一份完整配置（GET/PUT/reset 的响应体） */
    applyConfig(cfg) {
      this.apiKey = typeof cfg.apiKey === 'string' ? cfg.apiKey : ''
      this.baseUrl = typeof cfg.baseUrl === 'string' && cfg.baseUrl ? cfg.baseUrl : 'https://api.openai.com/v1'
      this.model = typeof cfg.model === 'string' ? cfg.model : ''
      this.proxy = typeof cfg.proxy === 'string' ? cfg.proxy : ''
      this.displayName = typeof cfg.displayName === 'string' && cfg.displayName.trim() ? cfg.displayName : '用户'
      this.bossKey = typeof cfg.bossKey === 'string' && cfg.bossKey.trim() ? cfg.bossKey.trim() : 'F3'
      this.darkMode = cfg.darkMode === true
      this.rememberProgress = cfg.rememberProgress !== false
      this.searchCount = Math.max(1, Math.min(5, Number.parseInt(cfg.searchCount, 10) || 3))
    },

    /** 从后端加载设置（幂等，App 启动与设置页进入均可调用） */
    async load() {
      try {
        const res = await fetch('/api/settings', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        this.applyConfig(await res.json())
      } catch (err) {
        console.warn('[设置] 加载失败：', err)
      } finally {
        this.loaded = true
        this.applyTheme()
      }
    },

    /**
     * 实时保存变更字段
     * @param {Object} patch 变更字段子集
     * @returns {Promise<string|null>} 成功返回 null，失败返回中文错误信息（调用方弹红 toast）
     */
    async save(patch) {
      Object.assign(this, patch)
      this.applyTheme()
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        this.applyConfig(await res.json())
        return null
      } catch (err) {
        console.error('[设置] 保存失败：', err)
        await this.load() // 回滚到磁盘真实状态（含主题开关）
        return `设置保存失败：${err.message}`
      }
    },
  },
})
