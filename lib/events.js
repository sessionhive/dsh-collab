/**
 * events.js —— 统一事件流（append-only）。
 *   events.jsonl   全类型：dispatch / receipt / message / notice / route / wake / violation
 *   dispatch.jsonl 只放 dispatch / receipt / wake（与 工具\_共用-协作.mjs 同格式）
 *   violations.jsonl 规则违规（rule_id / path / detail）
 */
import path from 'node:path'
import fs from 'node:fs'
import { EVENTS_FILE, DISPATCH_FILE, VIOLATIONS_FILE, META } from './paths.js'
import { appendLine, readJsonl, nowIso, today } from './store.js'
import { pluginLog } from './logger.js'

export async function logEvent(ev) {
  const row = { ts: ev.ts || nowIso(), ...ev }
  if (['handoff', 'ack', 'receipt'].includes(String(row.type || '')) && row.order_id) {
    try {
      const dup = readEvents().find((e) => e && String(e.type) === String(row.type) && String(e.order_id) === String(row.order_id) && String(e.from || '') === String(row.from || '') && String(e.to || '') === String(row.to || '') && String(e.kind || '') === String(row.kind || '') && String(e.note || '') === String(row.note || ''))
      if (dup) return { ...dup, deduped: true }
    } catch (e) { /* ignore */ }
  }
  await appendLine(EVENTS_FILE, JSON.stringify(row))
  // D：成功 close/verify 不入信号；只收异常 + 显式 feedback
  const learnTypes = ['reject', 'stale', 'interrupted', 'feedback']
  if (learnTypes.includes(String(row.type || ''))) {
    try { const L = await import('./learn.js'); await L.recordSignal(row) } catch (e) { /* 学习信号失败不阻断事件 */ }
  }
  try { pluginLog('info', 'event', { type: row.type, order_id: row.order_id || '', from: row.from || '', to: row.to || '' }) } catch (e) { /* ignore */ }
  if (row.type === 'dispatch' || row.type === 'receipt' || row.type === 'wake') {
    await appendLine(DISPATCH_FILE, JSON.stringify({ ts: row.ts, event: row.type, order_id: row.order_id, from: row.from, to: row.to, status: row.status }))
  }
  return row
}

export function readEvents() { return readJsonl(EVENTS_FILE) }

/** H：只读事件流尾部（最多 512KB / n 行） */
export function readEventsTail(n = 300) {
  try {
    const st = fs.statSync(EVENTS_FILE)
    const max = Math.min(st.size, 512 * 1024)
    const buf = Buffer.alloc(max)
    const fd = fs.openSync(EVENTS_FILE, 'r')
    try { fs.readSync(fd, buf, 0, max, Math.max(0, st.size - max)) } finally { fs.closeSync(fd) }
    return buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-n).map((l) => { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean)
  } catch (e) { return [] }
}

/** 当天（本地日期）某场景的有效唤醒次数 —— 与 CLI 的 wakesToday 同口径（按 UTC 日期前缀，ts 是 ISO） */
export function wakesToday(sceneId, events = readEvents()) {
  const isoDay = new Date().toISOString().slice(0, 10)
  return events.filter((e) => e && e.type === 'wake' && String(e.ts || '').startsWith(isoDay) && e.to === sceneId).length
}

export async function logWake(sceneId, ok, extra = {}) {
  return logEvent({ type: 'wake', to: sceneId, status: ok ? 'ok' : 'failed', ...extra })
}

/** 写一条违规（同步追加，工具失败路径用） */
export async function logViolation({ rule, path: p = '', detail = '', tool = 'wb_write' }) {
  const row = { ts: nowIso(), rule_id: rule, path: p, detail: String(detail).slice(0, 500), tool }
  await appendLine(VIOLATIONS_FILE, JSON.stringify(row))
  try {
    const learnDir = path.join(META, 'learn')
    fs.mkdirSync(learnDir, { recursive: true })
    const text = [row.rule_id, row.detail, row.path].filter(Boolean).join(' ')
    const rule = String(row.rule_id || '').toUpperCase()
    const mode = rule === 'PRT-001' ? '缺证据' : ((rule === 'BND-002' || rule === 'INV-005') ? '越权写' : (rule === 'PRT-012' ? '身份错' : (rule === 'PRT-002' ? '交接' : (/超时|stale|timeout/i.test(text) ? '超时' : (/环境|端口|network|依赖|权限/i.test(text) ? '环境坑' : '越权写')))))
    await appendLine(path.join(learnDir, 'signals.jsonl'), JSON.stringify({ ts: row.ts, type: 'violation', order_id: '', detail: String(row.detail || '').slice(0, 500), rule_id: row.rule_id, path: row.path, mode }) + '\n')
  } catch (e) { /* 信号失败不阻断违规记录 */ }
  return row
}

export function todayMessages(day = today()) {
  return readEvents().filter((e) => e && e.type === 'message' && String(e.ts || '').startsWith(day))
}
