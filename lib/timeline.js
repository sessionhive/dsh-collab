/**
 * timeline.js —— sessions.jsonl 会话时间线（v0.3.0 第二批）
 *   agents/<scene>/sessions.jsonl，一行一 JSON，只由插件写；ISO 本地时间 +08:00。
 */
import fs from 'node:fs'
import path from 'node:path'
import { AGENTS } from './paths.js'
import { ensureDir } from './store.js'

export function localIso(d = new Date()) {
  const p2 = (n) => (n < 10 ? '0' : '') + n
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + sign + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60)
}

export function appendSessionEvent(sceneId, event, data = {}) {
  const id = String(sceneId || '').trim()
  if (!id) return { ok: false, hint: 'sceneId 不能为空' }
  const dir = ensureDir(path.join(AGENTS, id))
  const file = path.join(dir, 'sessions.jsonl')
  const row = {
    ts: localIso(),
    event: String(event || 'entry'),
    scene: id,
    from: String(data.from || ''),
    to: String(data.to || ''),
    reason: String(data.reason || ''),
    note: String(data.note || '').slice(0, 500),
    refs: Array.isArray(data.refs) ? data.refs : [],
  }
  try { fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8'); return { ok: true, file, row } } catch (e) { return { ok: false, hint: String((e && e.message) || e) } }
}

export function readSessionTimeline(sceneId) {
  const file = path.join(AGENTS, String(sceneId || ''), 'sessions.jsonl')
  let lines = []
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) } catch (e) { return [] }
  const out = []
  for (const l of lines) { try { out.push(JSON.parse(l)) } catch (e) { /* skip */ } }
  return out
}
