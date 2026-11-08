/**
 * collab.js —— 协作单落盘（与 工具\_共用-协作.mjs 同格式，可双跑）。
 *   collab\<YYYY-MM-DD>\dhNNN-<assignee>.md（完成 .done.md；取消 .cancelled.md）
 *   events\counter.json 单号 / events.jsonl + dispatch.jsonl 事件
 *   dh035：blocked=暂停记录不关单；cancelled 需原因/权限；reopen；interrupted 标记。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { COLLAB, COUNTER } from './paths.js'
import { readText, readJson, writeAtomic, writeJson, ensureDir, today, nowIso, hm, slugify, exists } from './store.js'
import { logEvent, readEvents } from './events.js'
import { REGISTRY } from './paths.js'
import { renderTemplate } from './templates.js'

/** v2：任务哈希（规范化任务文本 + write_scopes） */
export function taskHash(task, writeScopes) {
  const scopes = (Array.isArray(writeScopes) ? writeScopes : String(writeScopes || '').replace(/[\[\]]/g, '').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean).sort()
  const norm = String(task || '').replace(/\s+/g, ' ').trim().toLowerCase()
  return crypto.createHash('sha256').update(norm + '\n' + scopes.join('\n')).digest('hex').slice(0, 16)
}

export function parseList(v) {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  return String(v || '').replace(/[\[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
}


function parse(frontmatter) {
  const fm = {}
  String(frontmatter || '').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (m) fm[m[1]] = m[2].trim()
  })
  return fm
}

export function parseOrder(text) {
  const m = String(text || '').match(/^---\n([\s\S]*?)\n---\n/)
  return { frontmatter: m ? parse(m[1]) : {}, body: String(text || '') }
}

/** 扫描所有协作单（新的在前） */
export function allOrders() {
  const out = []
  let days = []
  try { days = fs.readdirSync(COLLAB).sort().reverse() } catch (e) { return out }
  for (const day of days) {
    const dir = path.join(COLLAB, day)
    let files = []
    try { files = fs.readdirSync(dir) } catch (e) { continue }
    for (const f of files) {
      const m = f.match(/^(dh\d+)(?:-[a-z0-9-]+)?\.(done\.|cancelled\.)?md$/)
      if (!m) continue
      const file = path.join(dir, f)
      const text = readText(file)
      const info = parseOrder(text)
      // 无 legacy 兼容：只解析 protocol:v2；旧单原样留档、不统计
      if (String(info.frontmatter.protocol || '') !== 'v2') continue
      const state = m[2] ? m[2].replace(/\.$/, '') : 'open'   // open | done | cancelled
      out.push({ id: m[1], dir, day, file, state, done: state !== 'open', text, frontmatter: info.frontmatter, body: info.body })
    }
  }
  return out
}

export function findOrder(id) { return allOrders().find((o) => o.id === String(id || '').trim()) || null }

/** F：单号 dhNNN 每日重置（扫当日目录最大号；跨日引用写 YYYY-MM-DD/dhNNN） */
export function nextId() {
  const day = today()
  let max = 0
  try {
    for (const f of fs.readdirSync(path.join(COLLAB, day))) {
      const m = f.match(/^dh(\d+)(?:-[a-z0-9-]+)?\.(done\.|cancelled\.)?md$/)
      if (m) max = Math.max(max, Number(m[1]))
    }
  } catch (e) { /* 当日无单 */ }
  const seq = max + 1
  try { writeJson(COUNTER, { last_order_seq: seq, last_order_day: day }) } catch (e) { /* ignore */ }
  return 'dh' + String(seq).padStart(3, '0')
}

export function localIso() {
  const d = new Date()
  const p2 = (n) => (n < 10 ? '0' : '') + n
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = p2(Math.floor(Math.abs(off) / 60)), om = p2(Math.abs(off) % 60)
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + sign + oh + ':' + om
}

/** 建协作单（五件套：任务/发起/落点/禁区/验收；可选**分组**标注） */
export function createOrder({ from = 'host', to, task, loc = '', forbid = '', accept = '', slug = '', group = '', collaborators = [], depends_on = [], write_scopes = [], task_hash = '', flow = [], evidence = '' }) {
  const oid = nextId()
  const day = today()
  const dir = ensureDir(path.join(COLLAB, day))
  const who = slugify(to || 'host') || 'host'
  const sl = slugify(slug).slice(0, 24)
  const suffix = sl && sl !== who ? '-' + sl : ''
  const name = oid + '-' + who + suffix
  const file = path.join(dir, name + '.md')
  if (exists(file)) throw new Error('协作单已存在：' + file)
  const scopes = parseList(write_scopes)
  const collabs = parseList(collaborators)
  const deps = parseList(depends_on)
  const flowList = parseList(flow)
  if (!flowList.length) flowList.push(String(to || 'host'))
  const created = localIso()
  const hash = String(task_hash || taskHash(task, scopes))
  const flowText = flowList.join(' → ') + ' → 回 ' + (from || '派单方')
  const dispatchBody = renderTemplate('dispatch.md', {
    id: oid, goal: String(task || '').trim(),
    delivery: String(loc || '').trim(), accept: String(accept || '').trim(),
    constraints: String(forbid || '').trim(), evidence: String(evidence || '').trim(),
    flow: flowText,
  })
  const missing = []
  if (!String(loc || '').trim()) missing.push('交付物')
  if (!String(accept || '').trim()) missing.push('验收')
  if (!String(forbid || '').trim()) missing.push('约束')
  if (!String(evidence || '').trim()) missing.push('证据')
  const body = (dispatchBody
    ? '## 派单\n\n' + dispatchBody.replace(/\s*$/, '\n')
    : '## 派单\n\n**任务**：' + String(task || '').trim() + '\n**落点**：' + (loc || '（待补）') + '\n**禁区**：' + (forbid || '（待补）') + '\n**验收**：' + (accept || '（待补）') + '\n') + (group ? '\n**分组**：' + group + '\n' : '')
  const md = [
    '---',
    'protocol: v2',
    'schemaVersion: 1',
    'order_id: ' + oid,
    'task_type: dispatch',
    'dispatched_at: ' + created,
    'created_at: ' + created,
    'dispatcher: ' + (from || 'host'),
    'owner: ' + (from || 'host'),
    'assignee: ' + (to || 'host'),
    'collaborators: [' + collabs.join(', ') + ']',
    'depends_on: [' + deps.join(', ') + ']',
    'write_scopes: [' + scopes.join(', ') + ']',
    'task_hash: ' + hash,
    'flow: [' + flowList.join(', ') + ']',
    'current_owner: ' + (flowList[0] || to || 'host'),
    '---',
    '',
    body,
    '## 记录',
    '',
    '- ' + hm() + ' ' + (from || 'host') + ' 派单：' + String(task || '').slice(0, 80),
    '',
  ].filter((x) => x !== null).join('\n')
  writeAtomic(file, md)
  return { id: oid, day, file, name, md, task_hash: hash, protocol: 'v2', flow: flowList, current_owner: flowList[0] || to, missing, template: 'dispatch.md' }
}

/** F/G：collab/done-index.md —— 按日期分段 + 时间/单号/标题/负责人/状态/路径 */
export function rebuildDoneIndex() {
  try {
    const done = allOrders().filter((o) => o.done)
    const byDay = {}
    for (const o of done) {
      const body = String(o.body || '')
      const m = body.match(/(?:【派单[^】]*】|\*\*任务\*\*[：:])\s*(.+)/) || []
      const title = String(m[1] || '').replace(/^-\s*/, '').trim().slice(0, 60) || '（未写标题）'
      const t = String(o.frontmatter.created_at || '')
      const hm = (t.match(/T(\d{2}:\d{2})/) || [])[1] || ''
      const row = '| ' + (hm || '—') + ' | ' + o.id + ' | ' + title.replace(/\|/g, '/') + ' | ' + String(o.frontmatter.current_owner || o.frontmatter.assignee || '') + ' | ' + (/cancelled/i.test(o.file) ? 'cancelled' : 'done') + ' | ' + path.relative(path.dirname(COLLAB), o.file).split(path.sep).join('\\') + ' |'
      ;(byDay[o.day] || (byDay[o.day] = [])).push(row)
    }
    const lines = ['# 协作单完成索引', '', '> 自动生成：按日期分段；跨日引用写 YYYY-MM-DD/dhNNN', '']
    for (const day of Object.keys(byDay).sort().reverse()) {
      lines.push('## ' + day, '', '| 时间 | 单号 | 标题 | 负责人 | 状态 | 路径 |', '|---|---|---|---|---|---|', ...byDay[day], '')
    }
    writeAtomic(path.join(COLLAB, 'done-index.md'), lines.join('\n'))
    return { ok: true, count: done.length }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
}

/** 更新 v2 frontmatter 字段（flow/current_owner） */
export function updateOrderFrontmatter(id, patch) {
  const o = findOrder(id)
  if (!o) throw new Error('找不到协作单：' + id)
  const m = String(o.text).match(/^---\n([\s\S]*?)\n---\n/)
  if (!m) throw new Error('协作单无 frontmatter：' + id)
  const lines = m[1].split(/\r?\n/)
  for (const [k, v] of Object.entries(patch || {})) {
    const idx = lines.findIndex((l) => new RegExp('^' + k + '\\s*:').test(l))
    const line = k + ': ' + v
    if (idx >= 0) lines[idx] = line; else lines.push(line)
  }
  const t = '---\n' + lines.join('\n') + '\n---\n' + String(o.text).slice(m[0].length)
  writeAtomic(o.file, t)
  return o.file
}

/** 追加自动段头（## 接管-<角色> / ## 交接-<角色> / ## 验收） */
export function appendOrderSection(id, heading) {
  const o = findOrder(id)
  if (!o) throw new Error('找不到协作单：' + id)
  if (String(o.text).indexOf('\n' + heading + '\n') >= 0) return o.file
  const t = String(o.text).replace(/\s*$/, '\n\n' + heading + '\n\n')
  writeAtomic(o.file, t)
  return o.file
}

function hms() { const d = new Date(); const p2 = (n) => (n < 10 ? '0' : '') + n; return p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) }
const KIND_LABEL = { dispatch: '派单', ack: '已接单（ack）', progress: '进度', submit: '提交', verify: '验收通过', reject: '验收退回', close: '关单', comment: '说明', stale: '超时无动作', heartbeat: '心跳', handoff: '交接', takeover: '接管' }

/** v2 记录行：插件统一写时间/作者/前缀，AI 只写正文 */
export function appendProtocolRecord(id, by, kind, text) {
  const o = findOrder(id)
  if (!o) throw new Error('找不到协作单：' + id)
  if (o.done) throw new Error('协作单已关闭：' + id)
  const label = KIND_LABEL[kind] || '记录'
  const row = '- ' + hms() + ' ' + (by || '?') + ' ' + label + '：' + String(text || '').replace(/\s*$/, '')
  let t = o.text
  const at = t.indexOf('## 终态')
  if (at >= 0) t = t.slice(0, at).replace(/\s*$/, '\n') + row + '\n\n' + t.slice(at)
  else t = t.replace(/\s*$/, '\n') + row + '\n'
  writeAtomic(o.file, t)
  return o.file
}

/** 追加记录（v2 内部按 progress 写） */
export function appendRecord(id, author, line) {
  return appendProtocolRecord(id, author, 'progress', line)
}

/** 关闭协作单：done=终态 .done.md；blocked=暂停记录（保持 open）；cancelled=需原因/权限 → .cancelled.md */
export async function closeOrder(id, { status = 'done', note = '', closedBy = 'host', refs = [] } = {}) {
  let o = findOrder(id)
  if (!o) throw new Error('找不到协作单：' + id)
  if (o.done) throw new Error('协作单已关闭：' + id)
  if (!['done', 'blocked', 'cancelled'].includes(status)) throw new Error('status 只能是 done / blocked / cancelled')
  const fm = o.frontmatter || {}
  const relOf = (file) => 'collab/' + o.day + '/' + path.basename(file)
  if (status === 'blocked') {
    appendRecord(id, closedBy, '阻塞：' + (note || '（未写原因）') + '（仍在途；恢复用 wb_write reopen）')
    await logEvent({ type: 'blocked', order_id: id, by: closedBy, note: String(note || '').slice(0, 300) })
    return { file: o.file, rel: relOf(o.file), status: 'blocked', keptOpen: true }
  }
  if (status === 'cancelled') {
    if (!note) throw new Error('取消必须写原因（note）')
    const allowed = new Set([String(fm.dispatcher || ''), String(fm.assignee || ''), 'host'])
    if (!allowed.has(String(closedBy))) throw new Error('无权取消：只有发起方/接单方/宿主可以取消（当前 ' + closedBy + '）')
  }
  try { updateOrderFrontmatter(id, { close_at: localIso() }) } catch (e) { /* ignore */ }
  o = findOrder(id)
  let t = o.text.replace(/\s*$/, '\n')
  const evShort = Array.isArray(refs) && refs.length ? ' · 证据：' + refs.slice(0, 3).map((r) => String(r)).join(' ; ') : ''
  t += '- ' + hms() + ' ' + closedBy + ' 关单：' + status + (note ? ' · ' + String(note).replace(/\n/g, ' / ').slice(0, 80) : '') + evShort + '\n'
  t += [
    '',
    '## 终态',
    '',
    'status: ' + status,
    'at: ' + nowIso(),
    'closed_by: ' + closedBy,
    'note: ' + String(note || '').replace(/\n/g, ' / ').slice(0, 500),
    Array.isArray(refs) && refs.length ? 'refs: ' + refs.map((r) => String(r)).join(' ; ') : null,
    '',
  ].filter((x) => x !== null).join('\n')
  const doneFile = o.file.replace(/\.md$/, status === 'cancelled' ? '.cancelled.md' : '.done.md')
  writeAtomic(doneFile, t)
  try { fs.unlinkSync(o.file) } catch (e) { /* ignore */ }
  const rel = relOf(doneFile)
  await logEvent({ type: 'close', order_id: id, from: closedBy, to: String(o.frontmatter.assignee || ''), status, note: String(note || '').slice(0, 300), ref: rel, protocol: 'v2' })
  return { file: doneFile, rel, status }
}

/** 恢复被 blocked 的协作单（追加记录；文件保持 open） */
export async function reopenOrder(id, { by = 'host', note = '' } = {}) {
  const o = findOrder(id)
  if (!o) throw new Error('找不到协作单：' + id)
  if (o.state !== 'open') throw new Error('只有 open 单可以恢复（当前：' + o.state + '）')
  appendRecord(id, by, '恢复：' + (note || '继续做'))
  await logEvent({ type: 'reopen', order_id: id, by, note: String(note || '').slice(0, 300) })
  return { file: o.file, rel: 'collab/' + o.day + '/' + path.basename(o.file) }
}

/** 由文件状态 + 事件推导协作单当前状态（v2 状态机） */
export function deriveStatus(order, events = readEvents()) {
  if (!order) return ''
  if (order.state === 'cancelled') return 'cancelled'
  if (order.state === 'done') return 'done'
  let s = 'open'
  for (const e of events) {
    if (!e || String(e.order_id) !== order.id) continue
    const t = String(e.type || '')
    if (t === 'dispatch') s = 'open'
    else if (t === 'delivered') s = 'delivered'
    else if (t === 'ack') s = 'ack'
    else if (t === 'progress') s = 'working'
    else if (t === 'submit') s = 'submit'
    else if (t === 'handoff') s = 'working'
    else if (t === 'takeover') s = 'working'
    else if (t === 'verify') s = 'verified'
    else if (t === 'reject') s = 'working'
    else if (t === 'stale') s = 'stale'
    else if (t === 'comment') { /* 不改变主状态 */ }
    else if (t === 'blocked') s = 'blocked'
    else if (t === 'reopen') s = 'open'
    else if (t === 'interrupted') s = 'interrupted'
    else if (t === 'close') s = 'done'
  }
  return s
}

/** v2 维护：delivered 后 3 分钟无 ack/progress → stale + 通知 dispatcher + 自动重唤醒 assignee 一次；20 分钟无记录 → 心跳 */
export async function runCollabMaintenance(nowMs, opts = {}) {
  const now = Number(nowMs) || Date.now()
  const staleMs = (Number(opts.staleMinutes) || 3) * 60000
  const hbMs = (Number(opts.heartbeatMinutes) || 20) * 60000
  const events = readEvents()
  const out = { stale: [], heartbeat: [] }
  const byOrder = {}
  for (const e of events) { const id = String(e.order_id || ''); if (!id) continue; (byOrder[id] || (byOrder[id] = [])).push(e) }
  const wakeByScene = async (sceneId, msg) => {
    try {
      const sc = (await import('./rules.js')).findScene(sceneId)
      const sid = sc && Array.isArray(sc.sessions) && sc.sessions[0] ? String(sc.sessions[0].sessionId || '') : ''
      if (!sid) return { ok: false, reason: 'no-session' }
      const r = await (await import('./sessions.js')).promptSession(sid, msg)
      return { ok: !!r.ok, sid, reason: r.reason || '' }
    } catch (e) { return { ok: false, reason: String((e && e.message) || e) } }
  }
  for (const o of allOrders()) {
    if (o.done) continue
    const evs = byOrder[o.id] || []
    const tsOf = (e) => { const t = Date.parse(String(e.ts || '')); return Number.isFinite(t) ? t : 0 }
    const delivered = evs.filter((e) => e.type === 'delivered').map(tsOf).filter(Boolean).sort((a, b) => b - a)[0] || 0
    const activityTypes = ['ack', 'progress', 'submit', 'comment', 'verify', 'reject']
    const acts = evs.filter((e) => activityTypes.includes(String(e.type || ''))).map(tsOf).filter(Boolean)
    const lastAct = acts.length ? Math.max(...acts) : 0
    const staleEvs = evs.filter((e) => e.type === 'stale')
    const dispatcher = String(o.frontmatter.dispatcher || '')
    const assignee = String(o.frontmatter.assignee || '')
    if (delivered && lastAct <= delivered && now - delivered > staleMs) {
      const mins = Math.round((now - delivered) / 60000)
      try {
        if (!staleEvs.length) {
          appendProtocolRecord(o.id, 'host', 'stale', 'delivered 后 ' + mins + ' 分钟无 ack/progress（通知 dispatcher + 重唤醒 assignee 一次）')
          await logEvent({ type: 'stale', order_id: o.id, from: 'host', to: dispatcher, protocol: 'v2', minutes: mins, retry: 0 })
          if (dispatcher && dispatcher !== 'host') await wakeByScene(dispatcher, '【协作 stale】' + o.id + ' delivered 后 ' + mins + ' 分钟无动作，已重唤醒 ' + assignee + ' 一次；请关注。')
          if (assignee) {
            const w = await wakeByScene(assignee, '【重唤醒】' + o.id + ' 已 ' + mins + ' 分钟未 ack/开工，请立即处理（收到先 ack）。')
            await logEvent({ type: 'wake', order_id: o.id, from: 'host', to: assignee, reason: 'stale-retry', retry: 1, ok: !!w.ok, protocol: 'v2' })
          }
          out.stale.push(o.id)
        } else {
          const retried = evs.some((e) => e.type === 'wake' && e.reason === 'stale-retry')
          const retry2 = staleEvs.some((e) => Number(e.retry) === 2)
          if (!retried) {
            const w = await wakeByScene(assignee, '【重唤醒】' + o.id + ' 仍无响应，请立即 ack/开工。')
            await logEvent({ type: 'wake', order_id: o.id, from: 'host', to: assignee, reason: 'stale-retry', retry: 1, ok: !!w.ok, protocol: 'v2' })
          } else if (!retry2 && now - delivered > staleMs * 2) {
            appendProtocolRecord(o.id, 'host', 'stale', '重唤醒后仍无响应（' + mins + ' 分钟），再次通知 dispatcher')
            await logEvent({ type: 'stale', order_id: o.id, from: 'host', to: dispatcher, protocol: 'v2', minutes: mins, retry: 2 })
            await wakeByScene(dispatcher, '【协作 stale·再次通知】' + o.id + ' 重唤醒后仍无响应（' + mins + ' 分钟）。')
            out.stale.push(o.id)
          }
        }
      } catch (e) { /* ignore */ }
    }
    const hbMarked = evs.some((e) => e.type === 'comment' && e.heartbeat === true && tsOf(e) > lastAct)
    if (lastAct && now - lastAct > hbMs && !hbMarked) {
      try {
        appendProtocolRecord(o.id, 'host', 'heartbeat', '已 ' + Math.round((now - lastAct) / 60000) + ' 分钟无记录，请更新进度')
        await logEvent({ type: 'comment', order_id: o.id, from: 'host', heartbeat: true, note: 'heartbeat 20m', protocol: 'v2' })
        out.heartbeat.push(o.id)
      } catch (e) { /* ignore */ }
    }
  }
  return out
}

/** 某会话被中断/归档 → 把它作为 assignee 的 open 单标 interrupted（写记录+事件，不自动取消） */
export async function markInterruptedBySession(sessionId, reason = '中断', { onlyOrderIds = null } = {}) {
  const sid = String(sessionId || '').trim()
  if (!sid) return { ok: true, marked: [] }
  const reg = readJson(REGISTRY, {}) || {}
  const scene = (Array.isArray(reg.scenes) ? reg.scenes : []).find((s) => {
    if (String(s.id) === sid) return true
    return (Array.isArray(s.sessions) ? s.sessions : []).some((x) => x && String(x.sessionId) === sid)
  })
  if (!scene) return { ok: true, marked: [], skipped: 'no-scene' }
  const events = readEvents()
  const marked = []
  for (const o of allOrders()) {
    if (o.done) continue
    if (onlyOrderIds && onlyOrderIds.indexOf(o.id) < 0) continue
    if (String(o.frontmatter.assignee || '') !== String(scene.id)) continue
    if (deriveStatus(o, events) === 'interrupted') continue
    appendRecord(o.id, 'host', '中断：会话 ' + sid.slice(0, 20) + '… 被' + reason + '（不自动取消；发起方可用 wb_write cancel 取消）')
    await logEvent({ type: 'interrupted', order_id: o.id, session_id: sid, scene: String(scene.id), reason })
    marked.push(o.id)
  }
  return { ok: true, marked, scene: String(scene.id) }
}
