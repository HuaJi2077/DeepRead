/**
 * 网络请求公共层（server/tools）
 *
 * 为什么需要它：Node 的 fetch 不走系统代理，而 AI 接口与 Wiki 在
 * 多数网络环境下须经代理访问（本机系统代理常见于 127.0.0.1:xxxx）。
 * 本模块统一处理代理选择，供 aiClient / wikiSearch 共用：
 *
 * 代理优先级（取第一个非空值）：
 * 1. data/user.json 的 proxy 字段（显式指定，支持任何 http 代理）
 * 2. 环境变量 HTTPS_PROXY / HTTP_PROXY（大小写均认）
 * 3. Windows 系统代理（注册表 Internet Settings，需 ProxyEnable=1）
 * 4. 都没有 → 直连
 *
 * 代理经 undici 的 ProxyAgent 实现（undici 已作为本地依赖安装）。
 */

import { execSync } from 'node:child_process'
import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { readUserConfig } from './userConfig.js'

/** 已创建的 ProxyAgent 缓存（同一代理地址复用，避免每次请求新建连接池） */
let cachedAgent = null
let cachedAgentUrl = ''

/** 读取 Windows 系统代理（注册表）；读取失败/未启用返回空串 */
function detectWindowsProxy() {
  try {
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"',
      { encoding: 'utf8', timeout: 3000 },
    )
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(out)
    if (!enabled) return ''
    const m = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/)
    if (!m) return ''
    let addr = m[1]
    // 可能形如 "127.0.0.1:7897"，也可能形如 "http=x;https=y"（取 https 项）
    if (addr.includes(';')) {
      const https = addr.split(';').find((s) => s.trim().startsWith('https='))
      addr = (https || addr.split(';')[0]).split('=')[1]
    }
    if (!addr) return ''
    return addr.includes('://') ? addr : `http://${addr}`
  } catch {
    return ''
  }
}

/** 解析当前应使用的代理地址（空串 = 直连），见文件头优先级说明 */
function resolveProxy() {
  const cfg = readUserConfig()
  if (cfg.proxy) return cfg.proxy
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
  if (env) return env
  if (process.platform === 'win32') return detectWindowsProxy()
  return ''
}

/**
 * 带代理支持的 fetch（接口与全局 fetch 一致）
 * @param {string} url 请求地址
 * @param {object} options fetch 选项（method/headers/body/signal 等）
 */
export function netFetch(url, options = {}) {
  const proxyUrl = resolveProxy()
  if (!proxyUrl) return fetch(url, options)
  if (!cachedAgent || cachedAgentUrl !== proxyUrl) {
    cachedAgent = new ProxyAgent(proxyUrl)
    cachedAgentUrl = proxyUrl
  }
  return undiciFetch(url, { ...options, dispatcher: cachedAgent })
}
