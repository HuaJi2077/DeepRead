import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * 应用路由（vue-router 4）
 *
 * 项目定位：AI 对话类应用。核心数据单元是「对话（chat）」，
 * 每个对话有唯一 id，对话记录既展示在侧边栏历史列表，也通过
 * /chat/:id 动态路由在内容区打开。对话列表仅存于内存（Pinia），
 * 刷新页面即清空，后续接入持久化时只需替换数据层。
 *
 * 布局约定：
 * - App.vue = 侧边栏（SideBar，常驻导航 + 对话历史列表）+ 内容区（RouterView）
 * - 所有路由页面均渲染在内容区，互不嵌套（扁平结构）
 *
 * 历史模式说明：
 * - 采用 hash 模式（URL 形如 /#/chat/test），dist 静态目录可直接打开，
 *   无需服务器配置 history 回退。
 *
 * 路由与主页模式选择器的对应关系（由 stores/ui.js 的 setMode 维护）：
 * - 对话模式 default → /        （主页 ChatHome）
 * - 阅读模式 expert   → /reading（阅读页 ReadingView）
 * - 我的书架 vision   → /shelf  （书架页 ShelfView）
 */

// 路由表：path 与页面一一对应，name 供 push({ name }) 使用
const routes = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/ChatHome.vue'),   // 主页：问候 + 模式选择 + 输入框
    meta: { title: 'DeepRead - 深度阅读' },
  },
  {
    // 动态对话页：:id 为对话唯一标识（当前测试对话固定为 test）
    path: '/chat/:id',
    name: 'chat',
    component: () => import('@/views/ChatView.vue'),
    meta: { title: 'DeepRead - 对话模式' },
  },
  {
    path: '/reading',
    name: 'reading',
    component: () => import('@/views/ReadingView.vue'), // 阅读模式页：书籍网格 → 打开阅读器
    meta: { title: 'DeepRead - 阅读模式' },
  },
  {
    path: '/shelf',
    name: 'shelf',
    component: () => import('@/views/ShelfView.vue'),   // 我的书架页：导入 / 重命名 / 删除书籍
    meta: { title: 'DeepRead - 我的书架' },
  },
  {
    path: '/search',
    name: 'search',
    component: () => import('@/views/SearchView.vue'), // 搜索页（占位）
    meta: { title: 'DeepRead - 对话搜索' },
  },
  {
    path: '/user',
    name: 'user',
    component: () => import('@/views/UserView.vue'),   // 用户设置页（占位）
    meta: { title: 'DeepRead - 用户设置' },
  },
  // 兜底：未匹配的路径重定向回主页
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

// 切换路由时同步浏览器标签页标题
router.afterEach((to) => {
  if (to.meta.title) document.title = to.meta.title
})

export default router
