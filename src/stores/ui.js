/**
 * UI 界面状态管理（Pinia）
 *
 * 只管界面状态与导航动作（对话数据本身见 stores/chat.js）：
 * - sidebarCollapsed 侧边栏是否折叠
 * - mode             当前模式：default | expert | vision
 * - think / search   AI 功能 / 搜索功能开关（两者互斥）
 * - input            输入框内容
 *
 * 导航动作（集中管理，保证各入口行为一致）：
 * - goHome()       → /        （logo 点击）
 * - goSearch()     → /search  （侧边栏搜索按钮）
 * - goUser()       → /user    （侧边栏用户卡块）
 * - openModePage() → 按页面导航（模式选择器当前行为：只导航，不改选中态）
 * - setMode()      → 按模式导航并切换选中态（受限未启用，保留待后用）
 * - send()         → 发送消息：清空输入并委托 chat store 调用后端指令执行
 * - newChat()      → /        （重置状态回主页）
 */

import { defineStore } from 'pinia'
import router from '@/router'
import { useChatStore } from './chat'

// 模式 → 路由路径 映射（与 router/index.js 中的路由表保持一致）
const MODE_ROUTES = {
  default: '/',
  expert: '/reading',
  vision: '/shelf',
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarCollapsed: false, // 侧边栏是否折叠
    mode: 'default',         // 当前模式：default | expert | vision
    think: false,            // AI 功能开关
    search: false,           // 搜索功能开关
    input: '',               // 输入框内容
  }),

  actions: {
    /** 切换侧边栏展开/折叠 */
    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed
    },

    /**
     * 切换 AI 功能开关（输入框左下角）
     * 与「搜索功能」互斥：开启本开关时自动关闭另一个；
     * 点击已选中的开关则取消自身（允许两个都不选）
     */
    toggleThink() {
      this.think = !this.think
      if (this.think) this.search = false
    },

    /**
     * 切换搜索功能开关（输入框左下角）
     * 与「AI 功能」互斥：开启本开关时自动关闭另一个；
     * 点击已选中的开关则取消自身（允许两个都不选）
     */
    toggleSearch() {
      this.search = !this.search
      if (this.search) this.think = false
    },

    /** 进入主页（点击 Logo 等场景，不重置模式） */
    goHome() {
      router.push('/')
    },

    /** 进入搜索页 */
    goSearch() {
      router.push('/search')
    },

    /** 进入用户设置页 */
    goUser() {
      router.push('/user')
    },

    /**
     * 打开模式对应的页面（当前模式选择器的受限行为）
     * 仅做路由导航，不改变 ui.mode——选中态恒为「对话模式 default」，
     * 滑块不移动、不播放切换动画（样式与动画均保留，见 ChatHome.vue 注释）。
     */
    openModePage(mode) {
      router.push(MODE_ROUTES[mode] || '/')
    },

    /**
     * 【当前未被调用，保留待后用】
     * 设置当前模式并导航到对应页面（会移动选中态滑块）：
     * 对话模式 → 主页；阅读模式 → 阅读页；我的书架 → 书架页
     * 后续若恢复「可切换模式」，将 ChatHome.vue 点击处理改回本方法即可。
     */
    setMode(mode) {
      this.mode = mode
      router.push(MODE_ROUTES[mode] || '/')
    },

    /**
     * 发送消息
     * 将输入框内容交给 chat store，由后端解析指令、执行动作并持久化对话。
     * 未定义指令按当前开关分发给对应工具：AI 功能（think）→ 'ai'，
     * 搜索功能（search）→ 'search'，两者互斥、可都不选（后端回复「指令错误」）。
     * 正在输出（等待响应/流式渲染）时直接忽略——ChatInput 的按钮与
     * Enter 已按 busy 锁定，这里是最后一道保险，防止其他入口绕过锁定。
     * 清空输入框的操作在确认可发送后执行，避免锁定时误清用户输入。
     */
    async send() {
      const chat = useChatStore()
      if (!this.input.trim() || chat.loading || chat.streaming) return
      const text = this.input.trim()
      const tool = this.think ? 'ai' : this.search ? 'search' : null
      this.input = ''
      await chat.sendMessage(text, tool)
    },

    /**
     * 开启新对话
     * 重置所有与对话相关的本地状态，回到主页初始界面
     * （对话高亮的清空委托 chat store，路由跳回主页后
     *   App.vue 的 watch 也会兜底把 activeChatId 置空）
     */
    newChat() {
      this.mode = 'default'
      this.think = false
      this.search = false
      this.input = ''
      useChatStore().resetActive()
      router.push('/')
    },
  },
})
