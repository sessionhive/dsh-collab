/**
 * interrupt-watch.js —— 中断/归档捕捉（dh035）。
 *
 * spike 结论（见 说明\插件-中断与取消.md）：
 *   - host 插件可用 `ctx.on('session/event', (session,event)=>…)` 监听会话事件
 *     （引擎 dsh-agent-loop 等就是这么用的；turn/end 的 reason.kind 有 aborted/interrupted，
 *      assistant/message 有 interrupted:true 标记）；
 *   - `ctx.on('session/disposed')` 可监听会话销毁；
 *   - 归档没有事件，只能轮询 `ctx.get('workspaceRegistry').archivedSessionIds`。
 *
 * 行为：会话被中断/归档 → 把该会话对应场景作为 assignee 的 open 单标 interrupted
 *       （写协作记录 + events.jsonl type=interrupted，不自动取消）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { EVENTS_DIR } from './paths.js'
import { ensureDir } from './store.js'
import { logEvent } from './events.js'
import { markInterruptedBySession } from './collab.js'

const LOG_FILE = path.join(EVENTS_DIR, 'interrupt.log')
const G = globalThis.__wbInterruptWatch || (globalThis.__wbInterruptWatch = { started: false, timer: null, stats: { sessionEvents: 0, interrupted: 0, archiveChecks: 0, last: [] } })

function log(line) {
  try { ensureDir(EVENTS_DIR); fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line + '\n', 'utf8') } catch (e) { /* ignore */ }
}

function sessionIdOf(session) {
  try { return String((session && (session.id || (session.header && session.header.id))) || '') } catch (e) { return '' }
}

async function onInterrupted(sessionId, reason) {
  try {
    const r = await markInterruptedBySession(sessionId, reason)
    if (r && r.marked && r.marked.length) {
      G.stats.interrupted += r.marked.length
      G.stats.last.push({ at: new Date().toISOString(), sessionId, reason, orders: r.marked })
      if (G.stats.last.length > 20) G.stats.last = G.stats.last.slice(-20)
      log('INTERRUPT ' + reason + ' session=' + sessionId + ' orders=' + r.marked.join(',') + ' scene=' + (r.scene || ''))
      await logEvent({ type: 'interrupted', session_id: sessionId, reason, orders: r.marked, scene: r.scene || '' })
    }
  } catch (e) {
    log('INTERRUPT-ERR ' + String((e && e.message) || e))
  }
}

function handleSessionEvent(session, event) {
  G.stats.sessionEvents++
  if (!event || !event.type) return
  const data = event.data || {}
  const sid = sessionIdOf(session)
  if (!sid) return
  if (event.type === 'turn/end') {
    const reason = data.reason || {}
    const kind = String(reason.kind || reason.reason || '')
    if (kind === 'aborted' || kind === 'interrupted') onInterrupted(sid, '中断（turn/end ' + kind + '）')
  } else if (event.type === 'assistant/message' && data.interrupted === true) {
    onInterrupted(sid, '中断（assistant/message interrupted）')
  }
}

export function startInterruptWatch(ctx) {
  if (G.started) return { ok: true, already: true }
  G.started = true
  let listening = false
  try {
    if (ctx && typeof ctx.on === 'function') {
      ctx.on('session/event', (session, event) => handleSessionEvent(session, event))
      ctx.on('session/disposed', (session) => {
        const sid = sessionIdOf(session)
        if (sid) onInterrupted(sid, '会话结束/归档（session/disposed）')
      })
      listening = true
    }
  } catch (e) { log('CTX-ON-FAIL ' + String((e && e.message) || e)) }
  // 归档没有事件：轮询 workspaceRegistry.archivedSessionIds（30s；哨兵式兜底）
  const checkArchive = () => {
    G.stats.archiveChecks++
    try {
      const wr = ctx && typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : null
      const ids = wr && wr.archivedSessionIds ? Array.from(wr.archivedSessionIds) : []
      for (const sid of ids) onInterrupted(String(sid), '归档（archivedSessionIds）')
    } catch (e) { /* ignore */ }
  }
  checkArchive()
  G.timer = setInterval(checkArchive, 30000)
  if (G.timer && typeof G.timer.unref === 'function') G.timer.unref()
  log('START listening=' + listening + ' archivePoll=30s')
  return { ok: true, listening, stats: G.stats }
}

export function stopInterruptWatch() {
  try { if (G.timer) clearInterval(G.timer) } catch (e) { /* ignore */ }
  G.timer = null
  G.started = false
  return { ok: true }
}

export function interruptStatus() { return { ok: true, started: G.started, listening: G.started, stats: G.stats, log: LOG_FILE } }
