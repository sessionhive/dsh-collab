/**
 * auto-index.js —— 自动索引（dh031）：替代「重建索引」按钮。
 *   启动跑一次 sync-registry + gen-index；fs.watch 外壳\scenarios\*.json 防抖 ~1s 重跑；
 *   失败不打断（写 events\auto-index.log + events.jsonl 的 index 事件）；并发合并串行。
 * 外部环境（无 外壳/scenarios 或无 工具\gen）自动跳过，不报错。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { SCENARIOS, TOOLS, ROOT, EVENTS_DIR, REGISTRY, META } from './paths.js'
import { ensureDir, exists } from './store.js'
import { logEvent } from './events.js'
import { recomputeSceneIndexFromRegistry } from './registry-index.js'
import { injectAgents } from './agents-inject.js'

const LOG_FILE = path.join(EVENTS_DIR, 'auto-index.log')
const DEBOUNCE_MS = 1000

// 跨 HMR 重载共享状态（避免重复 watcher）
const G = globalThis.__wbAutoIndexState || (globalThis.__wbAutoIndexState = { started: false, watcher: null, timer: null, running: false, pending: false, stopped: false, mode: null })

function log(line) {
  try { ensureDir(EVENTS_DIR); fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line + '\n', 'utf8') } catch (e) { /* ignore */ }
}

function runStep(file) {
  return new Promise((resolve) => {
    const script = path.join(TOOLS, 'gen', file)
    if (!exists(script)) return resolve({ ok: true, skipped: true, file, out: '无工具\\gen，跳过' })
    let out = ''
    let child
    try {
      child = spawn(process.execPath, [script], { cwd: ROOT, windowsHide: true })
    } catch (e) {
      return resolve({ ok: false, file, error: String((e && e.message) || e) })
    }
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { out += String(d) })
    child.on('error', (e) => resolve({ ok: false, file, error: String((e && e.message) || e) }))
    child.on('close', (code) => resolve({ ok: code === 0, code, file, out: out.slice(0, 1000) }))
  })
}

/**
 * 跑一次（串行；并发时合并为一次待跑）
 * @param {string} reason
 */
export async function runAutoIndex(reason = 'manual') {
  if (G.running) { G.pending = true; return { ok: true, merged: true, reason } }
  if (G.stopped) return { ok: false, stopped: true, reason }
  G.running = true
  let steps = []
  let ok = true
  if (G.mode === 'registry') {
    // 无壳模式：没有 工具\gen，直接用 registry 重算 scene-index
    const r = recomputeSceneIndexFromRegistry()
    steps = [{ file: 'scene-index.md（registry 直算）', ok: !!r.ok, code: r.ok ? 0 : 1, scenes: r.scenes, bytes: r.bytes, error: r.error || '' }]
    ok = !!r.ok
  } else {
    for (const f of ['sync-registry.mjs', 'gen-index.mjs']) {
      const r = await runStep(f)
      steps.push(r)
      if (!r.ok) { ok = false; break }
    }
  }
  G.running = false
  log((ok ? 'OK' : 'FAIL') + ' ' + reason + ' ' + JSON.stringify(steps.map((s) => ({ file: s.file, ok: s.ok, code: s.code, skipped: !!s.skipped, scenes: s.scenes }))))
  if (!ok) {
    try { await logEvent({ type: 'index', status: 'error', reason, mode: G.mode || 'gui', steps: steps.map((s) => ({ file: s.file, ok: s.ok, code: s.code, error: s.error || '' })) }) } catch (e) { /* 事件失败也不能打断 */ }
  }
  if (G.pending) { G.pending = false; setTimeout(() => { runAutoIndex('pending') }, 0) }
  // dh044：registry 变化后重新生成 AGENTS.md 托管段（壳模式/off 时 injectAgents 自己会跳过）
  try { injectAgents('registry:' + reason) } catch (e) { log('INJECT-FAIL ' + String((e && e.message) || e)) }
  return { ok, steps, reason, mode: G.mode || 'gui' }
}

/** 防抖调度（~1s 合并窗口） */
export function scheduleAutoIndex(reason = 'watch') {
  if (G.stopped) return
  clearTimeout(G.timer)
  G.timer = setTimeout(() => { G.timer = null; runAutoIndex(reason) }, DEBOUNCE_MS)
}

function isWatched(filename) {
  const base = String(filename || '').split(/[\\/]/).pop()
  if (!base) return false
  if (!/\.json$/i.test(base)) return false
  if (base[0] === '_') return false
  if (/(^|[._-])(tmp|temp|swp|bak|orig|rej)([._-]|$)|~$|_trash/i.test(base)) return false
  return true
}

/** 启动：有壳监听 scenarios；无壳监听 _meta\registry.json（防抖 1s 重算 scene-index）。可重复调用（幂等）。 */
export function startAutoIndex() {
  if (G.started) return { ok: true, already: true }
  G.started = true
  G.stopped = false
  if (exists(SCENARIOS)) {
    G.mode = 'gui'
    // 启动先跑一次（异步，不阻断插件加载）
    setTimeout(() => { runAutoIndex('startup') }, 800)
    try {
      G.watcher = fs.watch(SCENARIOS, { persistent: false }, (event, filename) => {
        if (!filename) { scheduleAutoIndex('watch:null'); return }
        if (!isWatched(filename)) return
        scheduleAutoIndex('watch:' + event + ':' + path.basename(String(filename)))
      })
      G.watcher.on('error', (e) => log('WATCH-ERR ' + String((e && e.message) || e)))
      log('WATCH 已监听 ' + SCENARIOS)
    } catch (e) {
      log('WATCH-FAIL ' + String((e && e.message) || e))
    }
    return { ok: true, watching: !!G.watcher, mode: 'gui', dir: SCENARIOS }
  }
  if (exists(REGISTRY)) {
    // 无壳模式：监听 registry.json，重算 scene-index
    G.mode = 'registry'
    setTimeout(() => { runAutoIndex('startup-registry') }, 500)
    try {
      G.watcher = fs.watch(META, { persistent: false }, (event, filename) => {
        if (filename && path.basename(String(filename)) !== 'registry.json') return
        scheduleAutoIndex('watch-registry:' + event)
      })
      G.watcher.on('error', (e) => log('WATCH-ERR ' + String((e && e.message) || e)))
      log('WATCH(无壳) 已监听 ' + REGISTRY)
    } catch (e) {
      log('WATCH-FAIL ' + String((e && e.message) || e))
    }
    return { ok: true, watching: !!G.watcher, mode: 'registry', dir: META }
  }
  log('SKIP 无 外壳\\scenarios 且无 _meta\\registry.json（外部环境），不启动自动索引')
  return { ok: true, skipped: true, reason: 'no-scenarios-no-registry' }
}

export function stopAutoIndex() {
  G.stopped = true
  clearTimeout(G.timer); G.timer = null
  try { if (G.watcher) G.watcher.close() } catch (e) { /* ignore */ }
  G.watcher = null
  G.started = false
  return { ok: true }
}

export function autoIndexStatus() {
  return { started: G.started, watching: !!G.watcher, running: G.running, pending: G.pending, mode: G.mode, log: LOG_FILE, debounceMs: DEBOUNCE_MS }
}
