/**
 * sessions.js —— 会话列表/新建/提醒（v0.2.4）。
 *
 * 列表：优先 host `ctx.get('sessionController').list()`；不可用返回明确原因（UI 手填 sessionId）。
 * 新建：cwd 由工作区选择决定（resolveCreateCwd：显式 cwd → workspace → config.defaultCwd → 未选择时明确报错）；
 *       创建后默认发一条最短开场消息保证「非空/左侧可见」（config.seedOnCreate 默认 true）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, DSH_HOME, CONFIG, META } from './paths.js'
import { readJson, ensureDir, appendLine } from './store.js'
import { hostGet, configureHost } from './host.js'
import { resolveCreateCwd } from './workspaces.js'

function controller() { return hostGet('sessionController') }

/** 由 runtime.install(ctx, config) 注入 host ctx（兼容旧调用名） */
export function configureSessions(ctx, config) { configureHost(ctx, config) }

function mapItem(it) {
  const vals = (it && it.projections && it.projections.values) || {}
  return {
    sessionId: String((it && it.sessionId) || ''),
    title: String(vals.title || ''),
    cwd: String((it && it.cwd) || ''),
    updatedAt: Number((it && it.updatedAt) || 0),
    running: !!(it && it.running),
    blank: !!(it && it.blank),
    agentAvailable: !!(it && it.agentAvailable),
  }
}

/** 给会话改名（交接用）；不可用时降级返回 ok:false 不抛。 */
export async function renameSession(sessionId, title) {
  const sid = String(sessionId || '').trim()
  const t = String(title || '').trim()
  if (!sid || !t) return { ok: false, reason: '会话 id/标题为空' }
  const c = controller()
  if (c && typeof c.rename === 'function') {
    try { await c.rename({ sessionId: sid, title: t }); return { ok: true } } catch (e1) {
      try { await c.rename({ request: { sessionId: sid, title: t } }); return { ok: true } } catch (e2) { return { ok: false, reason: String((e2 && e2.message) || e2) } }
    }
  }
  try {
    const r = await rpc('session/rename', { request: { sessionId: sid, title: t } })
    return r ? { ok: true } : { ok: false, reason: 'rpc 无结果' }
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) } }
}

/** 列会话（host API 优先）。 */
export async function listSessions() {
  const c = controller()
  if (c && typeof c.list === 'function') {
    try {
      const v = await c.list({})
      const items = Array.isArray(v && v.items) ? v.items : []
      return { ok: true, source: 'host', items: items.map(mapItem).filter((x) => x.sessionId) }
    } catch (e) {
      return { ok: false, source: 'host', reason: 'host sessionController.list 失败：' + String((e && e.message) || e).slice(0, 200), items: [] }
    }
  }
  return {
    ok: false,
    source: 'none',
    reason: '当前 host 没有 sessionController（外部/精简环境）——无法自动列会话；请在设置页区域②用「手填 sessionId」粘贴会话 id',
    items: [],
  }
}

/** 唤醒一个会话：host prompt 失败退避重试 2 次；仍失败降级写 _meta/outbox.jsonl（发消息兜底）。 */
export async function promptSession(sessionId, text) {
  const sid = String(sessionId || '').trim()
  if (!sid) return { ok: false, degraded: true, reason: '会话 id 为空，无法提醒' }
  const c = controller()
  const body = String(text || '')
  const outbox = async (reason) => {
    try {
      ensureDir(META)
      await appendLine(path.join(META, 'outbox.jsonl'), JSON.stringify({ ts: new Date().toISOString(), to: sid, text: body.slice(0, 4000), reason: String(reason || '').slice(0, 300) }) + '\n')
      return true
    } catch (e) { return false }
  }
  if (!c || typeof c.prompt !== 'function') {
    await outbox('host 无 sessionController.prompt')
    return { ok: false, degraded: true, retries: 0, outbox: true, reason: 'host 无 sessionController.prompt：已降级写入 outbox（请手动提醒）' }
  }
  let last = ''
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const requestId = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') ? globalThis.crypto.randomUUID() : String(Date.now()) + '-' + Math.random().toString(16).slice(2)
      const signal = new AbortController().signal
      const r = await c.prompt({ requestId, sessionId: sid, content: [{ type: 'text', text: body }], mode: 'queue' }, signal)
      return { ok: true, result: r, retries: attempt }
    } catch (e) {
      last = String((e && e.message) || e).slice(0, 200)
      if (attempt < 2) await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
    }
  }
  const okOutbox = await outbox('prompt 重试失败：' + last)
  return { ok: false, degraded: true, retries: 2, outbox: okOutbox, reason: 'host prompt 失败（已重试 2 次）：' + last + (okOutbox ? '；已降级写 outbox' : '') }
}

function seedEnabled(explicit) {
  if (typeof explicit === 'boolean') return explicit
  try { const c = readJson(CONFIG, {}) || {}; return c.seedOnCreate !== false } catch (e) { return true }
}

function workspaceIdFor(cwd) {
  try {
    const wf = path.join(DSH_HOME, 'storages', 'workspace.json')
    const j = JSON.parse(fs.readFileSync(wf, 'utf8'))
    const norm = (s) => String(s || '').replace(/[\\/]+$/, '').toLowerCase()
    const tbl = (j && j.tables) || {}
    for (const [id, v] of Object.entries(tbl.workspaces || {})) {
      if (v && norm(v.path) === norm(cwd)) return { id, title: String(v.title || '') }
    }
  } catch (e) { /* ignore */ }
  return null
}

/**
 * 自动新建会话（host API 优先 + 工作区 cwd + seed）。
 * @param {{title?:string, cwd?:string, workspaceId?:string, seed?:boolean}} opts
 * @returns {{ok:boolean, sessionId?:string, title?:string, cwd?:string, workspaceId?:string, source?:string, cwdSource?:string, seeded?:boolean, seedMethod?:string, seedError?:string, error?:string}}
 */
export async function createSession(opts = {}) {
  const title = String(opts.title || '').trim()
  const resolved = resolveCreateCwd({ cwd: opts.cwd, workspaceId: opts.workspaceId })
  const dir = resolved.cwd
  if (!dir) return { ok: false, error: '未选择工作区（或未配置 config.defaultCwd）；请在新建表单选一个工作区', source: 'none', cwd: '', cwdSource: resolved.source }
  const ws = (opts.workspaceId && opts.workspaceId.trim()) ? { id: String(opts.workspaceId).trim() } : workspaceIdFor(dir)
  const shouldSeed = seedEnabled(opts.seed)
  const c = controller()
  let created = null
  if (c && typeof c.create === 'function') {
    try {
      const req = ws && ws.id ? { workspaceId: ws.id } : { cwd: dir }
      let v = await c.create(req)
      let sessionId = String((v && (v.sessionId || (v.value && v.value.sessionId))) || '')
      if (!sessionId) { v = await c.create({ request: req }); sessionId = String((v && (v.sessionId || (v.value && v.value.sessionId))) || '') }
      if (!sessionId) return { ok: false, error: 'host sessionController.create 未返回 sessionId', source: 'host', cwd: dir, cwdSource: resolved.source }
      if (title) {
        try {
          if (typeof c.rename === 'function') {
            try { await c.rename({ sessionId, title }) } catch (e1) { await c.rename({ request: { sessionId, title } }) }
          }
        } catch (e) { /* 改名失败不致命 */ }
      }
      created = { ok: true, sessionId, title, cwd: dir, workspaceId: ws ? ws.id : '', source: 'host', cwdSource: resolved.source }
    } catch (e) {
      return { ok: false, error: 'host sessionController.create 失败：' + String((e && e.message) || e).slice(0, 200), source: 'host', cwd: dir, cwdSource: resolved.source }
    }
  } else {
    created = await legacyRpcCreate(title, dir, ws)
    if (created && !created.ok) { created.cwdSource = resolved.source; return created }
    if (created) { created.cwdSource = resolved.source; created.workspaceId = ws ? ws.id : created.workspaceId }
  }
  // 非空保护：默认发最短开场消息（host prompt），失败不影响创建
  if (shouldSeed) {
    const s = await promptSession(created.sessionId, '已读')
    if (s.ok) { created.seeded = true; created.seedMethod = 'host-prompt' }
    else { created.seeded = false; created.seedMethod = s.degraded ? 'unavailable' : 'failed'; created.seedError = s.reason || '' }
  } else {
    created.seeded = false; created.seedMethod = 'disabled(config.seedOnCreate=false)'
  }
  return created
}

async function legacyRpcCreate(title, dir, ws) {
  try {
    const PORT = process.env.DSH_PORT || '3083'
    const BASE = 'http://127.0.0.1:' + PORT
    const LOG = path.join(ROOT, '外壳', 'server.log')
    if (!fs.existsSync(LOG)) return { ok: false, error: 'host 无 sessionController，且找不到 外壳\\server.log（外部环境正常），请改用「手填 sessionId」', source: 'none' }
    const toks = [...fs.readFileSync(LOG, 'utf8').matchAll(new RegExp('dsh web:\\s*http://127\\.0\\.0\\.1:' + PORT + '/\\?token=([A-Za-z0-9_\\-]{16,})', 'g'))].map((m) => m[1]).reverse()
    let cookie = ''
    for (const tk of toks.slice(0, 3)) {
      try {
        const r = await fetch(BASE + '/?token=' + tk, { redirect: 'manual' })
        const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : []
        if (sc.length) { cookie = sc.map((c) => c.split(';')[0]).join('; '); break }
      } catch (e) { /* next */ }
    }
    if (!cookie) return { ok: false, error: 'host 无 sessionController 且拿不到 token/cookie，请改用「手填 sessionId」', source: 'rpc' }
    const rpc = async (method, args) => {
      const r = await fetch(BASE + '/api/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: 'wb' + Date.now(), method, payload: { args } }),
      })
      const j = await r.json()
      return j && j.result && j.result.value
    }
    const v = await rpc('session/create', { request: ws ? { workspaceId: ws.id } : { cwd: dir } })
    const sessionId = String((v && v.sessionId) || '')
    if (!sessionId) return { ok: false, error: 'RPC session/create 未返回 sessionId', source: 'rpc' }
    if (title) { try { await rpc('session/rename', { request: { sessionId, title } }) } catch (e) { /* 改名失败不致命 */ } }
    return { ok: true, sessionId, title, cwd: dir, workspaceId: ws ? ws.id : '', source: 'rpc' }
  } catch (e) {
    return { ok: false, error: '列/建会话失败：' + String((e && e.message) || e).slice(0, 200), source: 'none' }
  }
}
