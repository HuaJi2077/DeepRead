/**
 * 书架状态管理（Pinia）
 *
 * 数据持久化在本地磁盘 data/shelf.json（由 server/index.js 读写），
 * 浏览器端不存储任何书架数据 —— 刷新/重开浏览器后调用 load()
 * 即可自动重新链接到本地书籍文件并渲染封面。
 *
 * 失效语义：后端每次 GET /api/shelf 会检查书籍文件是否仍存在，
 * 文件被移动/删除的书籍返回 invalid: true，前端封面覆盖「已丢失」标记。
 */

import { defineStore } from 'pinia'
import { extractBookInfo } from '@/utils/bookCover'
import { normalizeProgress } from '@/utils/reading'

export const useShelfStore = defineStore('shelf', {
  state: () => ({
    books: [],        // 书架列表（shelf.json 内容，新导入在前）
    loading: false,   // 正在从后端加载
    importing: false, // 正在导入（解析封面 + 上传）
    importProgress: 0,
    importError: '',  // 最近一次导入的错误信息（界面提示后清除）
    readerBook: null, // 当前在阅读器中打开的书籍（null 关闭）
  }),

  getters: {
    /** 有效书籍数（不含已失效） */
    validCount: (s) => s.books.filter((b) => !b.invalid).length,
    /** 无效（文件已丢失）书籍数 */
    invalidCount: (s) => s.books.filter((b) => b.invalid).length,
  },

  actions: {
    /** 从本地后端加载书架（进入书架页时调用）；no-store 避免命中浏览器缓存拿不到失效标记 */
    async load() {
      this.loading = true
      try {
        const resp = await fetch('/api/shelf', { cache: 'no-store' })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const data = await resp.json()
        this.books = data.books || []
      } catch (err) {
        console.error('[书架] 加载失败：', err)
        this.books = []
      } finally {
        this.loading = false
      }
    },

    /**
     * 导入本地电子书（EPUB/PDF/TXT）
     * 流程：前端解析书名/作者/封面 → 连同书籍文件上传 → 后端落盘并写入 shelf.json
     */
    async importBook(file) {
      if (this.importing) return false
      this.importing = true
      this.importError = ''
      this.importProgress = 0
      try {
        const info = await extractBookInfo(file, (p) => (this.importProgress = p))

        const coverFile = new File([info.coverBlob], 'cover.jpg', { type: info.coverBlob.type || 'image/jpeg' })
        const meta = {
          id: `bk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          title: info.title,
          author: info.author,
          format: info.format,
          size: file.size,
          addedAt: new Date().toISOString(),
        }

        const form = new FormData()
        form.append('book', file)
        form.append('cover', coverFile)
        form.append('meta', JSON.stringify(meta))

        const resp = await fetch('/api/shelf/upload', { method: 'POST', body: form })
        const data = await resp.json()
        if (!resp.ok) throw new Error(data.error || `上传失败（HTTP ${resp.status}）`)

        // 新书插到最前（导入按钮始终第一位，按钮在模板中固定）
        this.books.unshift(data.book)
        return true
      } catch (err) {
        console.error('[书架] 导入失败：', err)
        this.importError = err.message || '导入失败'
        return false
      } finally {
        this.importing = false
      }
    },

    /** 打开 / 关闭阅读器 */
    openReader(book) {
      if (book?.invalid) return // 已失效书籍不可打开
      this.readerBook = book
    },
    closeReader() {
      this.readerBook = null
    },

    /** 重命名书籍（PATCH 同步 shelf.json） */
    async renameBook(id, title) {
      const b = this.books.find((x) => x.id === id)
      if (!b) return
      const t = title.trim().slice(0, 200)
      if (!t || t === b.title) return
      b.title = t
      try {
        const resp = await fetch(`/api/shelf/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: t }),
        })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      } catch (err) {
        console.error('[书架] 重命名失败：', err)
      }
    },

    /**
     * 保存阅读进度（0-100 百分比）
     * 阅读器内部防抖后高频调用：值未变化时直接跳过，落盘很轻量
     */
    async saveProgress(id, progress) {
      const b = this.books.find((x) => x.id === id)
      if (!b) return
      // 进度规范化统一走共享工具（src/utils/reading.js）
      const p = normalizeProgress(progress)
      if (p === normalizeProgress(b.progress)) return
      b.progress = p
      try {
        await fetch(`/api/shelf/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ progress: p }),
        })
      } catch (err) {
        console.warn('[书架] 进度保存失败：', err)
      }
    },

    /** 移除书籍（后端同时删除书籍与封面文件） */
    async removeBook(id) {
      try {
        const resp = await fetch(`/api/shelf/${id}`, { method: 'DELETE' })
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        this.books = this.books.filter((b) => b.id !== id)
        if (this.readerBook?.id === id) this.closeReader()
      } catch (err) {
        console.error('[书架] 移除失败：', err)
      }
    },
  },
})
