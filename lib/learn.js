/**
 * learn.js —— 学习闭环（v0.3.17 dh079 定版优化）
 *   异常信号 / 按单失败模式 / 观察期 / 限权注入 / 效果对照 / 命中率
 */
import fs from 'node:fs'
import path from 'node:path'
import { META } from './paths.js'
import { ensureDir, readJson, readJsonl, appendLine, writeJson } from './store.js'
import { readEvents } from './events.js'
import { allOrders } from './collab.js'
import { computeTiming } from './timing.js'
import { config } from './budget.js'

const DIR = path.join(META, 'learn')
const SIGNALS = path.join(DIR, 'signals.jsonl')
const WEEKLY = path.join(DIR, 'weekly.md')
const ADJ = path.join(DIR, 'adjustments.json')
const OBS = path.join(DIR, 'observations.json')
const HITS = path.join(DIR, 'hits.jsonl')
const CURRENT_SCHEMA = 2
const DAY = 86400000
const MIN_SIGNAL_VERSION = '0.1.0'

export function versionAtLeast(v, min = MIN_SIGNAL_VERSION) {
  const a = String(v || '').replace(/^v/, '').split('.').map((x) => Number(x) || 0)
  const b = String(min || '').replace(/^v/, '').split('.').map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) > (b[i] || 0)) return true; if ((a[i] || 0) < (b[i] || 0)) return false }
  return true
}

function currentSignal(s) { return String((s && s.version) || '') === pkgVersion() }

// D：成功 close/verify 不入信号；只收异常 + 显式 feedback
const TYPE_SET = new Set(['reject', 'stale', 'violation', 'interrupted', 'feedback'])

function pkgVersion() {
  try { return String((JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) || {}).version || '') } catch (e) { return '' }
}

/** D：rule_id 优先，关键词兜底 */
export function classify(sig) {
  const s = sig || {}
  const rule = String(s.rule_id || '').toUpperCase()
  if (rule === 'PRT-001') return '缺证据'
  if (rule === 'BND-002' || rule === 'INV-005') return '越权写'
  if (rule === 'PRT-012') return '身份错'
  if (rule === 'PRT-002') return '交接'
  if (rule === 'PRT-014' || rule === 'PRT-015') return '超时'
  const type = String(s.type || '').toLowerCase()
  if (type === 'stale' || type === 'interrupted') return '超时'
  if (type === 'feedback') return String(s.verdict || '') === 'issue' ? '环境坑' : '其他'
  const text = [s.type, s.detail, s.note, s.hint, s.verdict].filter(Boolean).join(' ').toLowerCase()
  if (/缺证据|证据不可达|refs|无证据/.test(text)) return '缺证据'
  if (/漏派单|未派单|没有单|no.?order|直接改/.test(text)) return '漏派单'
  if (/多跳|hop|handoff_count|转交过多/.test(text)) return '多跳'
  if (/环境|端口|network|依赖|安装|权限/.test(text)) return '环境坑'
  if (/身份|角色|scene|场景|不认/.test(text)) return '身份错'
  return '其他'
}

export async function recordSignal(ev) {
  try {
    const type = String(ev.type || '')
    if (!TYPE_SET.has(type)) return null
    const sig = {
      ts: ev.ts || new Date().toISOString(), type, order_id: String(ev.order_id || ev.id || ''),
      from: String(ev.from || ''), to: String(ev.to || ''), detail: String(ev.note || ev.detail || ev.hint || ev.task || '').slice(0, 500),
      refs: Array.isArray(ev.refs) ? ev.refs.slice(0, 5) : [], duration_ms: Number(ev.duration_ms) || null,
      stale_minutes: Number(ev.minutes) || null, verdict: String(ev.verdict || ''), rule_id: String(ev.rule_id || ''),
      schemaVersion: CURRENT_SCHEMA, version: pkgVersion(),
    }
    sig.mode = classify(sig)
    ensureDir(DIR)
    await appendLine(SIGNALS, JSON.stringify(sig))
    return sig
  } catch (e) { return null }
}

export async function recordViolation(row) {
  return recordSignal({ type: 'violation', ts: row.ts, rule_id: row.rule_id, path: row.path, detail: row.detail })
}

export function readSignals() {
  try {
    // A：不信任落盘 mode，按当前 classify 回算；旧版本标 legacy 仅参考
    return readJsonl(SIGNALS).map((s) => ({ ...s, mode: classify(s), legacy: !currentSignal(s) }))
  } catch (e) { return [] }
}
export function readHits() { try { return readJsonl(HITS) } catch (e) { return [] } }

function tOf(v) { const x = Date.parse(String(v || '')); return Number.isFinite(x) ? x : 0 }
function inWindow(v, start, end) { const t = tOf(v); return t >= start && t < end }

/** 按单多跳：handoff 数 − max(0, flow.length−1) 的超出量 */
export function multiHopStats(events, orders) {
  const by = {}
  for (const e of events) if (e && e.type === 'handoff' && e.order_id) by[e.order_id] = (by[e.order_id] || 0) + 1
  const rows = []
  for (const o of orders || []) {
    const fm = o.frontmatter || {}
    const flow = String(fm.flow || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
    const normal = Math.max(0, flow.length - 1)
    const hops = by[o.id] || 0
    const excess = hops - normal
    if (excess > 0) rows.push({ id: o.id, hops, flow: flow.length, normal, excess })
  }
  return rows
}

function closedAt(o) {
  const fm = o.frontmatter || {}
  return tOf(fm.close_at) || tOf((readEvents().filter((e) => e.type === 'close' && e.order_id === o.id).slice(-1)[0] || {}).ts) || 0
}

/** 指定窗口指标（E：分母用单数；avg 限窗口） */
export function metricsWindow(start, end, opts = {}) {
  const ev = readEvents().filter((e) => inWindow(e.ts, start, end))
  const orders = allOrders()
  const done = orders.filter((o) => o.done && inWindow(new Date(closedAt(o)).toISOString(), start, end))
  const rejectEvents = ev.filter((e) => e.type === 'reject')
  const rejectOrders = new Set(rejectEvents.map((e) => e.order_id).filter(Boolean))
  const staleEvents = ev.filter((e) => e.type === 'stale' || e.type === 'interrupted')
  const staleOrders = new Set(staleEvents.map((e) => e.order_id).filter(Boolean))
  const handoffs = ev.filter((e) => e.type === 'handoff')
  const mh = multiHopStats(handoffs, orders)
  const durations = done.map((o) => computeTiming(o, readEvents()).durations.total_ms).filter((x) => x != null)
  const allSig = (opts.signals || readSignals()).filter((s) => inWindow(s.ts, start, end))
  const sig = allSig.filter((s) => !s.legacy)
  const legacySig = allSig.filter((s) => s.legacy)
  const hits = readHits().filter((h) => inWindow(h.ts, start, end))
  const orderDen = Math.max(1, done.length + staleOrders.size)
  const modes = {}
  for (const s of sig) modes[s.mode] = (modes[s.mode] || 0) + 1
  const legacyModes = {}
  for (const s of legacySig) legacyModes[s.mode] = (legacyModes[s.mode] || 0) + 1
  return {
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    orders: done.length, reworkRate: done.length ? Math.min(1, rejectOrders.size / Math.max(1, done.length)) : 0,
    staleRate: staleOrders.size / orderDen, avgDurationMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    handoffs: handoffs.length, multiHopOrders: mh.length, multiHopRate: done.length ? mh.length / Math.max(1, done.length) : 0,
    signals: sig.length, legacySignals: legacySig.length, topModes: Object.entries(modes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([mode, count]) => ({ mode, count })), legacyModes: Object.entries(legacyModes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([mode, count]) => ({ mode, count })),
    injectionHits: hits.length, injectionHitRate: (done.length + hits.length) ? hits.length / Math.max(1, done.length + hits.length) : 0,
    events: ev.length,
  }
}

export function metrics(days = 7) {
  const end = Date.now()
  return metricsWindow(end - days * DAY, end)
}

export function readAdjustments() {
  const j = readJson(ADJ, { schemaVersion: CURRENT_SCHEMA, items: [] }) || {}
  // B：version < 0.3.17 的旧调整自动过期（reverted），并按新门槛重新评估
  let expired = false
  for (const x of (Array.isArray(j.items) ? j.items : [])) {
    if (!x.reverted && x.version && String(x.version) !== pkgVersion()) {
      x.reverted = true; x.reverted_at = new Date().toISOString(); x.revert_reason = 'expired-version'; expired = true
    }
  }
  if (expired) { try { writeJson(ADJ, j) } catch (e) { /* ignore */ } }
  const cur = pkgVersion()
  const majorMinor = cur.split('.').slice(0, 2).join('.')
  const active = (Array.isArray(j.items) ? j.items : []).filter((x) => {
    if (x.reverted) return false
    const mm = String(x.version || '').split('.').slice(0, 2).join('.')
    return mm === majorMinor
  })
  return { ...j, items: Array.isArray(j.items) ? j.items : [], active }
}

export function readObservations() {
  const j = readJson(OBS, { schemaVersion: CURRENT_SCHEMA, items: [] }) || {}
  return { ...j, items: Array.isArray(j.items) ? j.items : [] }
}

export function revertAdjustment(id) {
  const j = readAdjustments()
  const it = j.items.find((x) => String(x.id) === String(id))
  if (!it) return { ok: false, hint: '找不到调整项：' + id }
  it.reverted = true
  it.reverted_at = new Date().toISOString()
  writeJson(ADJ, j)
  return { ok: true, id: String(id) }
}

export function activeSeedNotes() {
  try { if ((config().learn || {}).autoApply === false) return [] } catch (e) { /* 默认开启 */ }
  return readAdjustments().active.filter((x) => x.type === 'seed-pitfall').map((x) => String(x.value || '')).filter(Boolean).slice(0, 3)
}

/** B：每类样本≥3 且占比≥30% → 观察期 7 天 → 仍达标才注入 */
export function autoApply(now = Date.now()) {
  let autoEnabled = true
  try { autoEnabled = (config().learn || {}).autoApply !== false } catch (e) { autoEnabled = true }
  const ev = readEvents().filter((e) => inWindow(e.ts, now - 7 * DAY, now + 1))
  const orders = allOrders()
  const sig = readSignals().filter((s) => !s.legacy && inWindow(s.ts, now - 7 * DAY, now + 1))
  const obs = readObservations()
  const j = readAdjustments()
  const mh = multiHopStats(ev, orders).length
  const done = orders.filter((o) => o.done && inWindow(new Date(closedAt(o)).toISOString(), now - 7 * DAY, now + 1))
  const candidates = []
  const totalSig = Math.max(1, sig.length)
  const modes = {}
  for (const s of sig) modes[s.mode] = (modes[s.mode] || 0) + 1
  for (const [mode, count] of Object.entries(modes)) {
    const share = count / totalSig
    if (count >= 3 && share >= 0.3) candidates.push({ mode, samples: count, share, source: 'signal' })
  }
  const mhShare = done.length ? mh / done.length : 0
  if (mh >= 3 && mhShare >= 0.3) candidates.push({ mode: '多跳', samples: mh, share: mhShare, source: 'orders' })
  const applied = []
  const thisWeek = j.items.filter((x) => tOf(x.at) >= now - 7 * DAY)
  const ensure = (c) => {
    let o = obs.items.find((x) => x.mode === c.mode && x.status !== 'reverted')
    if (!o) {
      const type = c.mode === '超时' ? 'template-hint' : 'seed-pitfall'
      o = { mode: c.mode, type, first_seen: new Date(now).toISOString(), last_seen: new Date(now).toISOString(), samples: c.samples, share: c.share, status: 'observing', version: pkgVersion(), uiNote: type === 'template-hint' ? '未应用（模板提示未接入）' : '观察中' }
      obs.items.push(o)
    } else {
      o.last_seen = new Date(now).toISOString(); o.samples = c.samples; o.share = c.share
    }
    return o
  }
  for (const c of candidates) {
    const o = ensure(c)
    if (o.type === 'template-hint') { o.status = 'not-applied'; o.uiNote = '未应用（模板提示未接入）'; continue }
    if (!autoEnabled) { o.uiNote = '观察中（自动应用已关闭）'; continue }
    const age = now - tOf(o.first_seen)
    if (age < 7 * DAY) { o.uiNote = '观察中（满 7 天且仍达标才注入）'; continue }
    if (thisWeek.length >= 3) { o.uiNote = '观察中（本周调整已达上限）'; continue }
    if (j.items.some((x) => !x.reverted && x.observation_mode === c.mode && String(x.version || '').split('.').slice(0, 2).join('.') === pkgVersion().split('.').slice(0, 2).join('.'))) { o.status = 'applied'; continue }
    const value = c.mode === '缺证据' ? '已知坑：close/submit 前先落证据 refs（路径存在且 UTF-8）。'
      : c.mode === '多跳' ? '已知坑：一单 flow 接力，handoff 数超出 flow.length−1 会被判多跳。'
      : c.mode === '越权写' ? '已知坑：只写自己的 agents/<id>/，跨场景走协作单/黑板。'
      : '已知坑：' + c.mode + ' 反复出现，先核对身份/工作区与证据路径。'
    const item = { id: 'adj-' + now + '-' + Math.random().toString(16).slice(2, 6), type: 'seed-pitfall', value, pointer: '', reason: c.mode + ' 样本 ' + c.samples + ' 占比 ' + Math.round(c.share * 100) + '%', observation_mode: c.mode, version: pkgVersion(), at: new Date(now).toISOString(), reverted: false }
    j.items.push(item); thisWeek.push(item); applied.push(item)
    o.status = 'applied'; o.applied_at = item.at; o.adjustment_id = item.id; o.uiNote = '已注入 seed 已知坑'
  }
  writeJson(OBS, obs); writeJson(ADJ, j)
  return { ok: true, added: applied, observations: obs.items, active: readAdjustments().active.length, candidates }
}

export function detectInjectionHit(text, refs) {
  const hay = [String(text || '')].concat(Array.isArray(refs) ? refs.map(String) : []).join(' ')
  const items = readAdjustments().active.filter((x) => x.type === 'seed-pitfall')
  for (const a of items) {
    if (a.pointer && hay.indexOf(String(a.pointer)) >= 0) return a
    const parts = String(a.value || '').match(/[A-Za-z]:[\\/][^\s（(]+|(?:agents|collab|工作区)[\\/][^\s（(]+/g) || []
    for (const p of parts) if (hay.indexOf(p) >= 0) return a
  }
  return null
}

export async function recordInjectionHit(orderId, source, text, refs) {
  const a = detectInjectionHit(text, refs)
  if (!a) return null
  ensureDir(DIR)
  const row = { ts: new Date().toISOString(), order_id: String(orderId || ''), source: String(source || ''), adjustment_id: a.id, pointer: a.pointer || '', version: pkgVersion() }
  await appendLine(HITS, JSON.stringify(row))
  return row
}

function modesOf(sig) {
  const modes = {}
  for (const s of sig) modes[s.mode] = (modes[s.mode] || 0) + 1
  return modes
}

export function weeklyReport(now = Date.now()) {
  const start = now - 14 * DAY
  const appliedAll = readAdjustments().items.filter((x) => !x.reverted).sort((a, b) => tOf(a.at) - tOf(b.at))
  const pivot = appliedAll.length ? Math.min(tOf(appliedAll[0].at), now) : start
  const before = metricsWindow(pivot - 14 * DAY, pivot)
  const after = metricsWindow(pivot, now)
  const m = metrics(7)
  const sig = readSignals().filter((s) => !s.legacy && inWindow(s.ts, now - 7 * DAY, now + 1))
  const modes = modesOf(sig)
  const obs = readObservations()
  const fmt = (x) => (x == null ? '—' : Math.round(x * 100) + '%')
  const lines = [
    '# 学习周报（自动生成）', '', '- 生成时间：' + new Date(now).toISOString(), '- 窗口：近 7 天',
    '- 返工率：' + fmt(m.reworkRate), '- stale 率：' + fmt(m.staleRate),
    '- 单均时长：' + (m.avgDurationMs == null ? '—' : Math.round(m.avgDurationMs / 1000) + 's'),
    '- 多跳单：' + m.multiHopOrders + ' / ' + m.orders + '（' + fmt(m.multiHopRate) + '）',
    '- 信号数：' + m.signals + ' · 单数：' + m.orders,
    '', '## 效果对照（调整前 2 周 vs 调整后 2 周）', '',
    '| 指标 | 调整前 | 调整后 |', '|---|---|---|',
    '| 返工率 | ' + fmt(before.reworkRate) + ' | ' + fmt(after.reworkRate) + ' |',
    '| stale 率 | ' + fmt(before.staleRate) + ' | ' + fmt(after.staleRate) + ' |',
    '| 单均时长 | ' + (before.avgDurationMs == null ? '—' : Math.round(before.avgDurationMs / 1000) + 's') + ' | ' + (after.avgDurationMs == null ? '—' : Math.round(after.avgDurationMs / 1000) + 's') + ' |',
    '| 多跳率 | ' + fmt(before.multiHopRate) + ' | ' + fmt(after.multiHopRate) + ' |',
    '', '## 失败模式（近 7 天）', '',
    ...(Object.keys(modes).length ? Object.entries(modes).sort((a, b) => b[1] - a[1]).map(([k, v]) => '- ' + k + '：' + v + ' 次') : ['- （无）']),
    '', '## 观察期候选', '',
    ...(obs.items.length ? obs.items.map((x) => '- ' + x.mode + ' · ' + x.samples + ' 样本 · ' + x.status + ' · ' + (x.uiNote || '')) : ['- （无）']),
    '', '## 自动调整（可回退）', '',
    ...(readAdjustments().active.length ? readAdjustments().active.map((x) => '- [' + x.id + '] ' + x.type + ' · ' + x.value + '（v' + x.version + '）') : ['- （无）']),
    '', '## 注入命中率', '', '- ' + fmt(m.injectionHitRate) + '（命中 ' + m.injectionHits + ' 单）', '',
  ]
  ensureDir(DIR)
  fs.writeFileSync(WEEKLY, lines.join('\n'), 'utf8')
  return { ok: true, file: WEEKLY, metrics: m, modes, comparison: { before, after } }
}

export function learnSummary() {
  const m = metrics()
  const adj = readAdjustments()
  const obs = readObservations()
  return {
    ok: true, file: WEEKLY, signals: SIGNALS, metrics: m,
    currentSignals: m.signals, legacySignals: m.legacySignals, currentModes: m.topModes, legacyModes: m.legacyModes || [],
    adjustments: adj.active.map((x) => ({ id: x.id, type: x.type, value: x.value, version: x.version, at: x.at })),
    observations: obs.items.map((x) => ({ mode: x.mode, type: x.type, samples: x.samples, share: x.share, status: x.status, uiNote: x.uiNote, first_seen: x.first_seen })),
    activeCount: adj.active.length,
  }
}

export default { recordSignal, recordViolation, classify, metrics, metricsWindow, weeklyReport, learnSummary, autoApply, revertAdjustment, activeSeedNotes, readSignals, readAdjustments, readObservations, detectInjectionHit, recordInjectionHit }
