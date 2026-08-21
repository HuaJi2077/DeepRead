/**
 * 静态资源服务注册
 *
 * 两部分职责：
 * 1. /data —— 数据目录静态服务：前端通过 /data/books/xx.epub、
 *    /data/covers/xx.jpg 访问本地书籍与封面文件
 * 2. dist/ 托管（生产模式）—— 若存在 Vite 构建产物则同时托管前端页面，
 *    未命中 /api、/data 的路径统一回退到 index.html（SPA hash 路由），
 *    实现单进程离线部署（node server 前先 npm run build）
 */

import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, DIST_DIR, ROOT } from './config.js'

/** 注册全部静态服务（按依赖顺序挂到 app 上） */
export function registerStatic(app) {
  // 彩蛋图片：资源本体在 src/assets/image/（前端源码目录），
  // 通过固定 URL /data/easter-egg.png 暴露——消息 blocks 直接引用该 URL，
  // 无需 base64 入库（1MB 图片入库会快速膨胀 SQLite）
  app.get('/data/easter-egg.png', (_req, res) => {
    res.sendFile(path.join(ROOT, 'src', 'assets', 'image', 'easter-egg.png'))
  })

  app.use('/data', express.static(DATA_DIR))

  if (fs.existsSync(DIST_DIR)) {
    // 带哈希的静态资源可长缓存；index.html 必须禁缓存，
    // 否则重新构建后旧 HTML 引用旧哈希资源 → 动态模块 404 白屏
    app.use(
      express.static(DIST_DIR, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store')
        },
      }),
    )
    // SPA 回退：非 /api、/data 的任意路径都返回 index.html（hash 路由实际不依赖它，
    // 但保留可兼容直链/刷新场景）
    app.get(/^(?!\/api|\/data).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      res.sendFile(path.join(DIST_DIR, 'index.html'))
    })
  }
}
