import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // epubjs 内部引用 Node 的 global 标识，浏览器环境映射到 globalThis
  define: {
    global: 'globalThis',
  },
  server: {
    proxy: {
      // 书架本地后端（server/index.js，冷门端口）：书架 JSON / 文件上传 / 书籍与封面静态文件
      '/api': 'http://127.0.0.1:38617',
      '/data': 'http://127.0.0.1:38617',
    },
  },
})
