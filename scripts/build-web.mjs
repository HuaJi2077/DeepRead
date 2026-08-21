/**
 * 一键打包 Web 版（便携 zip 分发）
 *
 * 两种形态（同一脚本，--lite 切换）：
 *   完整版 npm run build:web       ——自带 Node 运行时（runtime/node.exe，81MB），
 *                                    终端用户零安装、零网络
 *   精简版 npm run build:web-lite  ——不带运行时，用户需自备 Node.js ≥ 22，包体小
 *
 * 流程：
 *   1. vite build（前端 → dist/）
 *   2. 组装便携目录 release/web/DeepRead/：
 *      dist + server + 共享模块(src/utils) + 静态资源(src/assets/image)
 *      + data 默认数据 + package.json/lock + start-prod.bat + 使用说明.txt
 *      + runtime/node.exe（仅完整版）
 *   3. npm ci --omit=dev 装入运行期 node_modules（离线依赖随包分发）
 *   4. 压缩为 release/DeepRead-Web-Full-x.x.x.zip / DeepRead-Web-Lite-x.x.x.zip
 *
 * Node 运行时下载：从 nodejs.org 取与本机相同的版本（win-x64），解出单个
 * node.exe 放入包内 runtime/；缓存于 node_modules/.node-cache/，重复打包不重复下载。
 *
 * 用法：npm run build:web / npm run build:web-lite
 *      （或双击 scripts/build-web.bat / build-web-lite.bat）
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProxyAgent } from 'undici'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgDir = path.join(root, 'release', 'web', 'DeepRead')
const nodeCacheDir = path.join(root, 'node_modules', '.node-cache')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))

/** 精简版：不带 Node 运行时，启动脚本改为强依赖系统 Node */
const lite = process.argv.includes('--lite')
const zipName = lite ? `DeepRead-Web-Lite-${version}.zip` : `DeepRead-Web-Full-${version}.zip`

/** 顺序执行命令，失败即中止并透传退出码 */
function run(title, cmd, args, cwd = root) {
  console.log(`\n[build-web] ${title}`)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error(`[build-web] 失败于「${title}」，流程中止`)
    process.exit(r.status ?? 1)
  }
}

/** 递归复制目录（保持结构） */
function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true })
}

/**
 * bat 必须存为 GBK + CRLF：
 * - 编码：cmd 按系统 ANSI 码页逐字节解析批处理，UTF-8 中文会被误读成乱码，
 *   乱码字节还会破坏 if/括号块结构；「chcp 65001 + UTF-8」方案在换码页后
 *   cmd 会按字节偏移错位重读文件，同样会炸——故先写 UTF-8 再转码 GBK
 * - 行尾：cmd 官方要求 CRLF，LF-only 遇括号块/goto 会按块错位解析
 */
function writeBatGbk(filePath, content) {
  const crlf = content.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')
  fs.writeFileSync(filePath, crlf, 'utf-8')
  run(`bat 转码为 GBK（${path.basename(filePath)}）`, 'powershell', [
    '-NoProfile', '-Command',
    `$p='${filePath.replaceAll("'", "''")}';$t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8);` +
      `[IO.File]::WriteAllText($p,$t,[Text.Encoding]::GetEncoding(936))`,
  ])
}

/** 下载文件（走 HTTPS_PROXY 环境代理；Node 内建 fetch 不读代理变量，须显式挂 dispatcher） */
async function download(url, destFile) {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined
  const res = await fetch(url, dispatcher ? { dispatcher } : {})
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(destFile, buf)
  return buf
}

/**
 * 获取随包分发的 node.exe：与本机 Node 完全同版本（开发即验证）。
 * 先查缓存，未命中则从 nodejs.org 下载 win-x64 zip 并解出 node.exe。
 */
async function fetchNodeExe(destExe) {
  const nodeVer = process.version // 如 v22.16.0
  const zipName = `node-${nodeVer}-win-x64.zip`
  const cachedZip = path.join(nodeCacheDir, zipName)

  if (!fs.existsSync(cachedZip)) {
    const url = `https://nodejs.org/dist/${nodeVer}/${zipName}`
    console.log(`\n[build-web] 下载 Node 运行时 ${url}（约 30MB，仅首次）`)
    fs.mkdirSync(nodeCacheDir, { recursive: true })
    await download(url, cachedZip)
    console.log('[build-web] 下载完成（已缓存到 node_modules/.node-cache/）')
  } else {
    console.log(`\n[build-web] 使用缓存的 Node 运行时 ${zipName}`)
  }

  // jszip 解出包内唯一的 node.exe（官方 zip 结构：node-vX-win-x64/node.exe）
  const jszip = (await import('jszip')).default
  const zip = await jszip.loadAsync(fs.readFileSync(cachedZip))
  const name = Object.keys(zip.files).find((n) => n.endsWith('node.exe'))
  if (!name) throw new Error('Node zip 中未找到 node.exe')
  fs.mkdirSync(path.dirname(destExe), { recursive: true })
  fs.writeFileSync(destExe, await zip.file(name).async('nodebuffer'))
  console.log(`[build-web] node.exe (${nodeVer}) 已放入包内 runtime/`)
}

/* ================================================================
 * 随包文件模板（完整版 / 精简版各一套）
 * ================================================================ */

/** 完整版：优先包内运行时，丢失才回退系统 node */
const START_BAT = `@echo off
rem ============================================================
rem  DeepRead（Web 版）一键启动
rem  双击运行：启动本地服务 → 自动打开浏览器
rem  地址：http://127.0.0.1:38617   关闭窗口即停止服务
rem  自带 Node 运行时（runtime\\node.exe），无需安装 Node.js
rem ============================================================
cd /d "%~dp0"

if not exist "server\\index.js" (
    echo [DeepRead] 文件不完整：缺少 server\\index.js，请重新解压
    pause
    exit /b 1
)
if not exist "dist\\index.html" (
    echo [DeepRead] 文件不完整：缺少 dist\\，请重新解压
    pause
    exit /b 1
)

rem 优先使用包内运行时（免安装）；仅当 runtime 丢失时回退系统 node
if exist "runtime\\node.exe" (
    set "NODE_EXE=runtime\\node.exe"
    goto :run
)

echo [DeepRead] 包内运行时 runtime\\node.exe 缺失，尝试使用系统 Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo [DeepRead] 未检测到 Node.js：请重新解压完整包，或安装 22 及以上版本 https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:~1%"
if %NODE_MAJOR% LSS 22 (
    echo [DeepRead] 需要 Node.js 22 及以上版本（当前主版本 %NODE_MAJOR%），请升级：https://nodejs.org/
    pause
    exit /b 1
)
set "NODE_EXE=node"

:run
echo [DeepRead] 启动本地服务，浏览器将自动打开 http://127.0.0.1:38617
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:38617"
%NODE_EXE% server\\index.js

echo.
echo [DeepRead] 服务已停止
pause
`

/** 精简版：不带运行时，强制要求系统 Node ≥ 22 */
const START_BAT_LITE = `@echo off
rem ============================================================
rem  DeepRead（Web 精简版）一键启动
rem  双击运行：校验 Node.js → 启动本地服务 → 自动打开浏览器
rem  地址：http://127.0.0.1:38617   关闭窗口即停止服务
rem  本版本不带 Node 运行时，需系统已安装 Node.js 22 及以上
rem ============================================================
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [DeepRead] 未检测到 Node.js，请安装 22 及以上版本：https://nodejs.org/
    echo [DeepRead] 或改用自带运行时的完整版 DeepRead-Web
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:~1%"
if %NODE_MAJOR% LSS 22 (
    echo [DeepRead] 需要 Node.js 22 及以上版本（当前主版本 %NODE_MAJOR%），请升级：https://nodejs.org/
    pause
    exit /b 1
)

if not exist "server\\index.js" (
    echo [DeepRead] 文件不完整：缺少 server\\index.js，请重新解压
    pause
    exit /b 1
)
if not exist "dist\\index.html" (
    echo [DeepRead] 文件不完整：缺少 dist\\，请重新解压
    pause
    exit /b 1
)

echo [DeepRead] 启动本地服务，浏览器将自动打开 http://127.0.0.1:38617
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:38617"
node server\\index.js

echo.
echo [DeepRead] 服务已停止
pause
`

const README_TXT = `DeepRead（Web 版）使用说明
==========================

环境要求
  无需安装任何依赖（包内自带 Node.js 运行时 runtime\\node.exe）

启动方式
  双击 start-prod.bat，浏览器会自动打开 http://127.0.0.1:38617
  关闭命令行窗口即停止服务

数据说明
  所有数据（书籍、封面、对话记录、设置）都在本目录 data\\ 文件夹内，
  不上传任何服务器；整个文件夹拷走即迁移、删除即卸载。
  data\\user.json 含 AI 接口密钥，请勿分享该文件。

AI 问答与百科搜索需要联网，其余功能完全离线。

安全提示
  浏览器若提示"命令行窗口请求打开网页"属正常现象（start-prod.bat
  自动打开浏览器所致），请允许。
`

const README_TXT_LITE = `DeepRead（Web 精简版）使用说明
==============================

环境要求
  Node.js 22 及以上版本（https://nodejs.org/）
  （零安装需求请改用自带运行时的完整版 DeepRead-Web）

启动方式
  双击 start-prod.bat，浏览器会自动打开 http://127.0.0.1:38617
  关闭命令行窗口即停止服务

数据说明
  所有数据（书籍、封面、对话记录、设置）都在本目录 data\\ 文件夹内，
  不上传任何服务器；整个文件夹拷走即迁移、删除即卸载。
  data\\user.json 含 AI 接口密钥，请勿分享该文件。

AI 问答与百科搜索需要联网，其余功能完全离线。

安全提示
  浏览器若提示"命令行窗口请求打开网页"属正常现象（start-prod.bat
  自动打开浏览器所致），请允许。
`

/* ---------- 1. 前端构建 ---------- */
run('构建前端（vite build）', 'npm', ['run', 'build'])

/* ---------- 2. 组装便携目录 ---------- */
console.log('\n[build-web] 组装便携目录 release/web/DeepRead/')
fs.rmSync(path.join(root, 'release', 'web'), { recursive: true, force: true })
fs.mkdirSync(pkgDir, { recursive: true })

copyDir(path.join(root, 'dist'), path.join(pkgDir, 'dist'))
copyDir(path.join(root, 'server'), path.join(pkgDir, 'server'))
copyDir(path.join(root, 'src', 'utils'), path.join(pkgDir, 'src', 'utils'))
copyDir(path.join(root, 'src', 'assets', 'image'), path.join(pkgDir, 'src', 'assets', 'image'))
copyDir(path.join(root, 'data'), path.join(pkgDir, 'data'))

// package.json + 锁文件（npm ci 按锁精确安装运行期依赖）
fs.copyFileSync(path.join(root, 'package.json'), path.join(pkgDir, 'package.json'))
fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(pkgDir, 'package-lock.json'))

// 启动脚本（位于包根，双击即用；按版本选用对应模板，GBK 编码）
writeBatGbk(path.join(pkgDir, 'start-prod.bat'), lite ? START_BAT_LITE : START_BAT)

// 简要使用说明
fs.writeFileSync(path.join(pkgDir, '使用说明.txt'), lite ? README_TXT_LITE : README_TXT, 'utf-8')

/* ---------- 3. 自带 Node 运行时（仅完整版） ---------- */
if (lite) {
  console.log('\n[build-web] 精简版：跳过 Node 运行时（用户自备 Node ≥ 22）')
} else {
  await fetchNodeExe(path.join(pkgDir, 'runtime', 'node.exe'))
}

/* ---------- 4. 运行期依赖 ---------- */
run('安装运行期依赖（npm ci --omit=dev）', 'npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], pkgDir)

/* ---------- 5. 压缩分发包 ---------- */
console.log(`\n[build-web] 压缩为 ${zipName}（可能需要一两分钟）`)
run('压缩 zip', 'powershell', [
  '-NoProfile', '-Command',
  `Compress-Archive -Path "${path.join(pkgDir, '*')}" -DestinationPath "${path.join(root, 'release', zipName)}" -Force`,
])

console.log(`\n[build-web] 完成：release/${zipName}`)
console.log(
  lite
    ? '[build-web] 精简版：用户解压后双击 start-prod.bat 运行（需自备 Node.js ≥ 22）'
    : '[build-web] 完整版：用户解压后双击 start-prod.bat 即可运行（自带运行时，无需安装 Node.js）',
)
