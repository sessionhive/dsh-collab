/**
 * session-state.js —— 会话归档状态 + 上下文压力（dh049）。
 *   - host 有归档标记（workspaceRegistry.archivedSessionIds）优先；
 *   - 无 host 字段时支持插件手动标记（_meta\archived-sessions.json）；
 *   - 上下文 token：host sessionController.list() 有则给，无则 null（空）。
 */
import { META } from './paths.js'
import { readJson, writeJson } from './store.js'
import { hostGet } from './host.js'
import { logEvent } from './events.js'

const FILE = () => META + '\\archived-sessions.json'

export function manualArchivedIds() {
  try { const j = readJson(FILE(), null); return Array.isArray(j && j.ids) ? j.ids.map(String) : [] } catch (e) { return [] }
}

export function hostArchivedIds() {
  try {
    const wr = hostGet('workspaceRegistry')
    const arr = wr && Array.isArray(wr.archivedSessionIds) ? wr.archivedSessionIds : []
    return arr.map(String)
  } catch (e) { return [] }
}

export function allArchivedSet() {
  return new Set([...hostArchivedIds(), ...manualArchivedIds()])
}

export function isArchived(sessionId) { return allArchivedSet().has(String(sessionId || '')) }

export async function setManualArchived(sessionId, archived) {
  const id = String(sessionId || '').trim()
  if (!id) return { ok: false, hint: 'sessionId 不能为空' }
  const ids = manualArchivedIds()
  const on = !!archived
  const next = on ? (ids.includes(id) ? ids : ids.concat(id)) : ids.filter((x) => x !== id)
  writeJson(FILE(), { ids: next, at: new Date().toISOString() })
  try { await logEvent({ type: 'archive-mark', sessionId: id, archived: on, source: 'manual' }) } catch (e) { /* ignore */ }
  return { ok: true, sessionId: id, archived: on, ids: next }
}

/** 上下文压力：host 有 contextTokens 才给；无则 null */
export async function contextTokenMap() {
  const out = {}
  try {
    const c = hostGet('sessionController')
    if (!c || typeof c.list !== 'function') return out
    const v = await c.list({})
    const items = Array.isArray(v && v.items) ? v.items : []
    for (const it of items) {
      const id = String((it && it.sessionId) || '')
      if (!id) continue
      const vals = (it && it.projections && it.projections.values) || {}
      const n = it.contextTokens != null ? Number(it.contextTokens) : (vals.contextTokens != null ? Number(vals.contextTokens) : null)
      if (Number.isFinite(n)) out[id] = n
    }
  } catch (e) { /* host 无 → 空 */ }
  return out
}
