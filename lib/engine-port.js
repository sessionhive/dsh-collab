/**
 * engine-port.js —— 引擎端口（dh049）：config.enginePort → DSH_PORT → 外壳\server.log → 3083。
 * board / HTTP 打开 / 文件版看板注入 统一用它；可自动探测并写回 config.enginePort。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, CONFIG, DSH_HOME } from './paths.js'
import { readJson } from './store.js'
import { hashFile, writeJsonGuardedSync } from './concurrency.js'
import { hostGet } from './host.js'

const DEFAULT_PORT = 3083

function fromConfig() {
  try {
    const c = readJson(CONFIG, {}) || {}
    const n = Number(c.enginePort)
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 0
  } catch (e) { return 0 }
}

function fromEnv() {
  const n = Number(process.env.DSH_PORT || '')
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 0
}

function fromServerLog() {
  try {
    const t = fs.readFileSync(path.join(ROOT, '外壳', 'server.log'), 'utf8')
    const m = [...t.matchAll(/dsh web:\s*http:\/\/127\.0\.0\.1:(\d{2,5})\//g)]
    if (!m.length) return 0
    const n = Number(m[m.length - 1][1])
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 0
  } catch (e) { return 0 }
}

/** 实时 host 端口（真相）：ctx.get('webServer') / httpServer 的 port 或 address().port */
export function hostLivePort() {
  const names = ['webServer', 'httpServer', 'webServerService']
  for (const n of names) {
    const s = hostGet(n)
    if (!s) continue
    try {
      const direct = Number(s.port)
      if (Number.isInteger(direct) && direct >= 1 && direct <= 65535) return direct
      if (s.server && typeof s.server.address === 'function') {
        const a = s.server.address()
        if (a && Number.isInteger(Number(a.port))) return Number(a.port)
      }
      if (typeof s.address === 'function') {
        const a = s.address()
        if (a && Number.isInteger(Number(a.port))) return Number(a.port)
      }
      if (s.server && Number.isInteger(Number(s.server.port))) return Number(s.server.port)
    } catch (e) { /* next */ }
  }
  return 0
}

/** 当前生效端口：host live → config.enginePort（手动覆盖）→ DSH_PORT → server.log → 3083 */
export function enginePort() {
  return hostLivePort() || fromConfig() || fromEnv() || fromServerLog() || DEFAULT_PORT
}

export function boardUrl(port) {
  return 'http://127.0.0.1:' + (port || enginePort()) + '/plugins/workbench-core/board'
}

export function boardDataUrl(port) {
  return 'http://127.0.0.1:' + (port || enginePort()) + '/plugins/workbench-core/board-data'
}

function probe(port) {
  return new Promise((resolve) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => { try { ctrl.abort() } catch (e) { /* ignore */ } }, 800)
    fetch('http://127.0.0.1:' + port + '/plugins/workbench-core/board-data', { signal: ctrl.signal })
      .then(async (r) => {
        clearTimeout(timer)
        if (!r.ok) return resolve({ ok: false })
        let j = null
        try { j = await r.json() } catch (e) { j = null }
        const root = j && j.root ? String(j.root) : ''
        const norm = (s) => String(s || '').replace(/[\\/]+$/, '').toLowerCase()
        const match = !!root && norm(root) === norm(DSH_HOME)
        resolve({ ok: match, root, match })
      })
      .catch(() => { clearTimeout(timer); resolve({ ok: false }) })
  })
}

/** 自动探测：候选 = host live / config / env / server.log / 3083，probe 必须 root 与本地 dataRoot 一致才采信 */
export async function detectEnginePort() {
  const cands = [...new Set([hostLivePort(), fromConfig(), fromEnv(), fromServerLog(), DEFAULT_PORT].filter((n) => n > 0))]
  for (const p of cands) {
    const r = await probe(p)
    if (r.ok) return { ok: true, port: p, candidates: cands, root: r.root, matchedBy: 'board-data.root' }
  }
  return { ok: false, port: enginePort(), candidates: cands, hint: '端口探测失败（候选：' + cands.join(', ') + '）；需 /board-data 的 root 与本地 dataRoot 一致才采信，可手填后保存' }
}

/** 保存端口到 config.enginePort；expectedHash 可选（并发保护） */
export function saveEnginePort(port, { expectedHash } = {}) {
  const n = Number(port)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return { ok: false, hint: '端口必须是 1~65535 的整数' }
  const h = expectedHash != null ? String(expectedHash) : hashFile(CONFIG)
  const cur = readJson(CONFIG, {}) || {}
  cur.enginePort = n
  const w = writeJsonGuardedSync(CONFIG, cur, { expectedHash: h, reason: 'config-engine-port' })
  if (!w.ok) return { ok: false, concurrent: true, hint: w.reason }
  return { ok: true, enginePort: n, path: CONFIG }
}

export function enginePortInfo() {
  const hp = hostLivePort()
  return { ok: true, enginePort: enginePort(), source: hp ? 'host' : (fromConfig() ? 'config' : (fromEnv() ? 'env' : (fromServerLog() ? 'server.log' : 'default'))), hostPort: hp || 0, defaultPort: DEFAULT_PORT }
}
