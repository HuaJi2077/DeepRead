/**
 * 一键启动开发环境（无额外依赖，node 内置 child_process / net）
 * 同时拉起本地后端（server/index.js）与 Vite dev server，
 * 并等待后端健康检查通过后再启动前端，避免 Vite 代理到未就绪的后端。
 * 任意一个子进程异常退出时，自动清理另一个子进程。
 */

import { spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND_PORT = 38617

// node:sqlite 是 Node.js 22+ 的实验性内置模块，低版本直接启动会报
// ERR_UNKNOWN_BUILTIN_MODULE。在启动任何服务前先检查版本，给出清晰提示。
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  console.error(
    `[dev:all] 当前 Node.js 版本为 ${process.versions.node}，本项目需要 Node.js 22 或更高版本。\n` +
      `原因：对话数据库使用内置的 node:sqlite 模块，该模块从 Node.js 22 开始提供。\n\n` +
      `请升级到 Node.js 22+ 后再运行，例如：\n` +
      `  - 使用 nvm-windows / fnm 安装并切换到 Node 22\n` +
      `  - 或从 https://nodejs.org 下载 LTS 版本安装包\n\n` +
      `如果你暂时无法升级 Node，可以回复“兼容 Node 20”，我会把数据库改为 sql.js（纯 WASM，无需升级）。`,
  )
  process.exit(1)
}

const BACKEND_HEALTH_TIMEOUT_MS = 10000
const HEALTH_CHECK_INTERVAL_MS = 250

/**
 * 检测指定端口是否已有服务在监听。
 * 用于：1) 等待后端就绪；2) 发现端口被占用时给出明确提示。
 */
function isPortListening(port) {
  return new Promise((resolve) => {
    const conn = createConnection({ port, host: '127.0.0.1' })
      .once('connect', () => {
        conn.destroy()
        resolve(true)
      })
      .once('error', () => resolve(false))
  })
}

/**
 * 等待后端端口就绪，超时则抛出错误。
 */
async function waitForBackend(port, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isPortListening(port)) return
    await new Promise((r) => setTimeout(r, HEALTH_CHECK_INTERVAL_MS))
  }
  throw new Error(`后端服务在 ${timeoutMs}ms 内未能监听 127.0.0.1:${port}，请检查 server/index.js 启动日志。`)
}

/**
 * 创建并注册一个子进程；当其异常退出时触发清理。
 */
function createChildProcess(command, args, label, onExit) {
  const proc = spawn(command, args, {
    stdio: 'inherit',
    cwd: root,
    // Windows 下默认不 detached，子进程与父进程共享控制台，
    // 这样 Ctrl+C 可以一并结束前后端。
  })

  proc.on('error', (err) => {
    console.error(`[dev:all] ${label} 启动失败：${err.message}`)
    onExit(1)
  })

  proc.on('exit', (code) => {
    const level = code === 0 ? 'log' : 'error'
    console[level](`[dev:all] ${label} 已退出，exit code = ${code ?? 'unknown'}`)
    onExit(code ?? 1)
  })

  return proc
}

async function main() {
  // 如果 38617 已被占用，提前报错而不是启动两个服务后才发现后端连不上。
  if (await isPortListening(BACKEND_PORT)) {
    console.error(
      `[dev:all] 端口 ${BACKEND_PORT} 已被占用，请先结束占用该端口的进程后再启动。\n` +
        `提示：可运行 "taskkill /F /IM node.exe" 清理所有 Node 进程。`,
    )
    process.exit(1)
  }

  let viteProc = null
  let backendProc = null
  let shuttingDown = false

  function shutdown(exitCode = 1) {
    if (shuttingDown) return
    shuttingDown = true

    console.log('[dev:all] 正在清理子进程...')
    for (const proc of [backendProc, viteProc]) {
      if (proc && !proc.killed) {
        try {
          proc.kill()
        } catch {
          /* 忽略 */
        }
      }
    }

    // 给子进程一点时间来退出，然后强制退出父进程
    setTimeout(() => process.exit(exitCode), 500)
  }

  // 1) 启动后端
  backendProc = createChildProcess(
    process.execPath,
    [path.join(root, 'server', 'index.js')],
    '后端服务',
    () => shutdown(1),
  )

  // 2) 等待后端真正就绪
  try {
    await waitForBackend(BACKEND_PORT, BACKEND_HEALTH_TIMEOUT_MS)
    console.log(`[dev:all] 后端已就绪：http://127.0.0.1:${BACKEND_PORT}`)
  } catch (err) {
    console.error(`[dev:all] ${err.message}`)
    shutdown(1)
    return
  }

  // 3) 启动前端 dev server
  viteProc = createChildProcess(
    process.execPath,
    [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1'],
    'Vite dev server',
    () => shutdown(1),
  )

  // 4) 注册信号处理：Ctrl+C / 关闭终端时一并结束子进程
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\n[dev:all] 收到 ${signal}，正在停止开发环境...`)
      shutdown(0)
    })
  }

  // Windows 下关闭控制台时通常发送 SIGBREAK，也做处理
  process.on('SIGBREAK', () => shutdown(0))
}

main().catch((err) => {
  console.error('[dev:all] 启动异常：', err)
  process.exit(1)
})
