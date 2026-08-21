/**
 * DeepRead 桌面版主进程（绿色便携版）
 *
 * 职责只有三件事：
 * 1. 以子进程拉起本地后端（server/index.js，与 Web 版完全同一份代码），
 *    数据目录固定为程序自带的 data/（打包后位于 resources/app/data）——
 *    整个程序文件夹自包含：拷走即迁移、删除即卸载，不写系统任何位置
 * 2. 窗口加载 http://127.0.0.1:38617（后端同时托管 dist/ 前端产物）
 * 3. 拦截一切外部链接（window.open / <a target=_blank> / location.href 跳转），
 *    统一交给系统默认浏览器打开，应用内不弹子窗口
 *
 * 子进程以 ELECTRON_RUN_AS_NODE=1 复用自身可执行文件运行 Node 代码，
 * 最终用户机器无需安装 Node.js。
 */

import { app, BrowserWindow, dialog, shell } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createConnection } from 'node:net'

const PORT = 38617
const APP_ORIGIN = `http://127.0.0.1:${PORT}`
const isPackaged = app.isPackaged

// 应用根：打包后 = resources/app；开发运行（npm run electron:dev）= 项目根
const appRoot = app.getAppPath()
const serverEntry = path.join(appRoot, 'server', 'index.js')
const logoPath = path.join(appRoot, 'electron', 'logo.ico')

/** 数据目录：书架 / 书籍 / 封面 / 对话库 / 设置全部在此（绿色版随程序目录走） */
const dataDir = path.join(appRoot, 'data')

// Chromium 自身缓存（会话/GPU 等）也重定向到应用内，保证程序目录之外零写入；
// 必须在 app ready 之前设置。开发模式保持系统默认，避免开发缓存写进项目目录。
if (isPackaged) app.setPath('userData', path.join(dataDir, 'electron'))

let serverProc = null
let quitting = false

/** 拉起后端子进程（stdio 继承，日志直接打到主进程控制台） */
function startServer() {
  serverProc = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DEEPREAD_DATA_DIR: dataDir },
    stdio: 'inherit',
  })
  serverProc.on('exit', (code) => {
    serverProc = null
    // 正常退出（应用关闭时主动 kill）不做处理；意外退出则报错并关闭应用
    if (!quitting && code !== 0) {
      dialog.showErrorBox('DeepRead', `本地后端异常退出（代码 ${code}），应用即将关闭。`)
      app.quit()
    }
  })
}

/** 轮询等待后端端口就绪（启动约需几百毫秒） */
function waitServer(timeoutMs = 15000) {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const tryOnce = () => {
      const conn = createConnection({ port: PORT, host: '127.0.0.1' })
      conn.once('connect', () => {
        conn.destroy()
        resolve(true)
      })
      conn.once('error', () => {
        conn.destroy()
        if (Date.now() - startedAt > timeoutMs) resolve(false)
        else setTimeout(tryOnce, 250)
      })
    }
    tryOnce()
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    autoHideMenuBar: true,
    title: 'DeepRead',
    icon: logoPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 外部链接统一交给系统默认浏览器；应用内不允许弹出新窗口
  // 覆盖三类来源：window.open / <a target="_blank"> / location.href 外部跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_ORIGIN)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  win.loadURL(APP_ORIGIN)
  if (!isPackaged) win.webContents.openDevTools({ mode: 'detach' })
}

// 单实例：重复启动时聚焦已有窗口（同时避免抢占后端端口）
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    startServer()
    const ok = await waitServer()
    if (!ok) {
      dialog.showErrorBox('DeepRead', `本地后端启动超时（端口 ${PORT}），请检查端口占用后重试。`)
      app.quit()
      return
    }
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  quitting = true
  if (serverProc) serverProc.kill()
})

app.on('window-all-closed', () => {
  app.quit()
})
