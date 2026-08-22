<script setup>
// 根组件：固定「侧边栏 + 内容区」布局
// - SideBar 为常驻导航栏（可折叠），不属于任何路由
// - RouterView 为内容区，路由表中的每个页面都在此渲染

import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import SideBar from './components/SideBar.vue'

const ui = useUiStore()         // 界面状态（侧边栏折叠等）
const chat = useChatStore()     // 对话数据（高亮跟随路由）
const settings = useSettingsStore() // 用户设置（暗黑模式/进度记忆等）
const route = useRoute()

/* ---------- 全局快捷键（老板键）：跳转官方网站 ---------- */
// 官方网站地址来自 data/user.json 的 officialSiteUrl（后端 /api/settings 下发，
// GitHub 仓库按钮用同文件里的 repoUrl），启动时拉取缓存，未就绪时按下则现场拉取一次。
// 键位可改（用户设置页「老板键」绑定，存 user.json，默认 F3）；
// F3 原生行为是「查找下一个」，preventDefault 后整页任意位置按下均直达。
// 绑定为单字符键（字母/数字）时在输入控件内不触发，避免正常打字误跳转。
// web 端 window.open 新开标签页；桌面版由主进程拦截改用系统默认浏览器。
let officialSiteUrl = ''

async function loadOfficialSiteUrl() {
  if (officialSiteUrl) return officialSiteUrl
  try {
    const res = await fetch('/api/settings', { cache: 'no-store' })
    if (res.ok) officialSiteUrl = (await res.json()).officialSiteUrl || ''
  } catch {
    /* 网络异常时保持空，跳转动作直接忽略 */
  }
  return officialSiteUrl
}

function onGlobalKeydown(e) {
  const key = settings.bossKey || 'F3'
  if (e.key !== key) return
  if (key.length === 1) {
    const el = e.target
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  }
  e.preventDefault()
  loadOfficialSiteUrl().then((url) => {
    if (url) window.open(url, '_blank', 'noopener')
  })
}

// 应用启动时加载历史对话列表（SideBar 挂载时也会加载，两处幂等。
// dev 模式下 Vite 页面可能先于后端就绪，首次失败后延迟重试一次，
// 保证「进入主页即可看到历史对话」。）
onMounted(async () => {
  window.addEventListener('keydown', onGlobalKeydown)
  loadOfficialSiteUrl()
  // 用户设置启动即加载：暗黑主题要在首屏渲染前套上（load 内部容错，失败保持默认）
  settings.load()
  const ok = await chat.loadConversations()
  if (!ok) {
    setTimeout(() => chat.loadConversations(), 1500)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})

// 对话高亮状态的唯一事实来源：activeChatId 严格跟随路由。
// - 进入 /chat/:id → 高亮侧边栏对应历史条目
// - 离开对话页（主页/搜索/用户设置等）→ 自动清空高亮
// （此前高亮同步写在 ChatView 内，路由异步切换尚未完成时会把
//   已清空的 activeChatId 写回旧值，导致「开启新对话」需点两次才取消高亮）
watch(
  () => (route.name === 'chat' ? route.params.id : null),
  (id) => {
    chat.activeChatId = id
  },
  { immediate: true },
)
</script>

<template>
  <!-- 应用最外层布局 -->
  <div class="cb86951c">
    <!-- 背景/遮罩层占位 -->
    <div class="cddfb2ed"></div>

    <!-- 主布局：侧边栏 + 内容区 -->
    <div class="c3ecdb44">
      <!-- 常驻导航侧边栏（路由切换时不销毁，保持折叠状态与动画） -->
      <SideBar />

      <!-- 侧边栏与内容区的分隔/占位元素 -->
      <div class="_4cbcd96" :class="{ _7d10bb1: ui.sidebarCollapsed }"></div>

      <!-- 内容区：当前路由对应的页面在此渲染 -->
      <RouterView />
    </div>
  </div>
</template>
