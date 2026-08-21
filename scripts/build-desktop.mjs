/**
 * 一键打包桌面版（绿色便携 zip，免安装）
 *
 * 流程：vite build（前端 → dist/）→ electron-builder --win zip
 * 产物（release/）：
 *   - DeepRead-Desktop-x.x.x.zip  ——分发用，解压即用，双击 DeepRead.exe 启动
 *   - win-unpacked/               ——同内容的未压缩目录，本地直接运行
 *
 * 绿色模式：data/（默认配置）已随包打入 resources/app/data，
 * 运行期全部数据（书架/对话库/缓存）都写在该目录内，程序目录之外零写入。
 *
 * 用法：npm run build:desktop
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'release')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'))

/** 顺序执行命令，失败即中止并透传退出码 */
function run(title, cmd, args) {
  console.log(`\n[build-desktop] ${title}`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error(`[build-desktop] 失败于「${title}」，流程中止`)
    process.exit(r.status ?? 1)
  }
}

// 只清理桌面版自己的旧产物（release/ 还放着 Web 版的包，不能整目录删）
// 偶发 EPERM：杀毒/资源管理器短暂占用句柄——重试几次，仍失败仅告警不强退
function removeJunk(rel) {
  const target = path.join(outDir, rel)
  for (let i = 0; i < 3; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true })
      return
    } catch (err) {
      if (i === 2) console.warn(`[build-desktop] 警告：清理 ${rel} 失败（${err.code}），继续构建`)
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
    }
  }
}

for (const junk of [
  'win-unpacked',
  `DeepRead-${version}-win.zip`,
  `DeepRead-Desktop-${version}.zip`,
  '.icon-ico',
  'builder-debug.yml',
  'builder-effective-config.yaml',
]) {
  removeJunk(junk)
}

// 前端构建（桌面版加载的就是后端托管的 dist 页面，与 Web 版同一产物）
run('构建前端（vite build）', 'npm', ['run', 'build'])

// 打包绿色版 zip（electron-builder 配置见 package.json build 字段）
run('打包桌面版（electron-builder）', 'npx', ['electron-builder', '--win'])

// 规范产物名：DeepRead-{version}-win.zip → DeepRead-Desktop-{version}.zip（与分发命名一致）
const rawZip = path.join(outDir, `DeepRead-${version}-win.zip`)
const finalZip = path.join(outDir, `DeepRead-Desktop-${version}.zip`)
if (fs.existsSync(rawZip)) fs.renameSync(rawZip, finalZip)

// 清理构建临时文件（图标转换缓存 / 调试清单，每次构建都会重新生成）
for (const junk of ['.icon-ico', 'builder-debug.yml', 'builder-effective-config.yaml']) {
  fs.rmSync(path.join(outDir, junk), { recursive: true, force: true })
}

// 结果提示
const files = fs.existsSync(outDir) ? fs.readdirSync(outDir) : []
console.log('\n[build-desktop] 完成，release/ 产物：')
for (const f of files) console.log(`  ${f}`)
