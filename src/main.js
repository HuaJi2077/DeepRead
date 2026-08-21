// Vue 3 应用入口
// 负责创建应用实例、挂载 Pinia 状态管理，并按顺序引入全局样式。
// 样式引入顺序有讲究：令牌 → 字体 → 核心 UI → 局部覆盖（后者依赖前面的变量）。

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

// 全局样式（顺序不可调换）
import './styles/tokens.css'           // 设计令牌：颜色/字体/阴影等 CSS 变量
import './styles/fonts.css'            // 本地字体（Inter 子集，woff2）
import './styles/ui.css'               // 核心 UI 样式（组件与页面布局）
import './styles/local-overrides.css'  // 局部补充：输入框/消息字体等覆盖

const app = createApp(App)

// 注册 Pinia 状态管理（先于路由，路由守卫内可使用 store）
app.use(createPinia())

// 注册路由（内容区 RouterView 的路由表见 src/router/index.js）
app.use(router)

// 挂载到 index.html 中的 #app
app.mount('#app')
