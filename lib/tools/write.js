/**
 * tools/write.js —— wb_write 实现：note / record / task / close。
 * 每个 action 先过 rules.js 校验；失败 { ok:false, rule, hint } 并写 violations。
 */
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { AGENTS, TOOLS, ROOT } from '../paths.js'
import { readText, writeAtomic, ensureDir, readJson, today, nowIso, slugify, exists } from '../store.js'
import { writeTextGuarded } from '../concurrency.js'
import { localIso } from '../timeline.js'
import { validateNote, findScene, callerScene, canWriteOrder, scenes } from '../rules.js'
import { createOrder, findOrder, appendRecord, appendProtocolRecord, appendOrderSection, updateOrderFrontmatter, closeOrder, reopenOrder, allOrders, taskHash, parseList, runCollabMaintenance, rebuildDoneIndex } from '../collab.js'
import { logEvent, logViolation } from '../events.js'
import { canWake, config } from '../budget.js'
import { recomputeSummary } from '../projection.js'
import { groupOfScene } from '../groups.js'
import { promptSession, listSessions } from '../sessions.js'
import { isArchived } from '../session-state.js'
import { rebuildMemoryIndex } from '../memory-index.js'
import { appendSessionEvent } from '../timeline.js'
import { search } from '../search.js'
import { listFiles } from '../store.js'

async function fail(rule, hint, extra = {}) {
  try { await logViolation({ rule, detail: hint, path: extra.path || '' }) } catch (e) { /* ignore */ }
  return { ok: false, rule, hint, ...extra }
}

function authorOf(args, exec) {
  const c = callerScene(exec)
  return String(args.author || (c && c.id) || '').trim() || 'host'
}

async function wakeScene(sceneId, text, force) {
  const sc = findScene(sceneId)
  const sessionId = sc && Array.isArray(sc.sessions) && sc.sessions[0] ? String(sc.sessions[0].sessionId || '') : ''
  if (!sessionId) return { ok: false, degraded: true, reason: '场景没有会话 id（无法提醒；已只落盘）' }
  if (isArchived(sessionId)) return { ok: false, degraded: true, reason: '会话已归档（' + sessionId + '）：已跳过唤醒，请先在设置页「重新绑定」' }
  // dh042：优先 host 会话 API，不再 import 工具\_共用-引擎.mjs；不可用则明确降级
  return await promptSession(sessionId, text)
}

function hashFile(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') } catch (e) { return '' }
}

function refCheck(ref, bases = []) {
  const s = String(ref || '').trim()
  if (!s) return { ok: false, reason: '空引用' }
  if (/^https?:\/\//i.test(s)) return { ok: true, path: s, kind: 'url' }
  const norm = s.replace(/\\/g, '/')
  if (norm.split('/').some((seg) => seg === '..')) return { ok: false, reason: '路径穿越（..）' }
  const cands = []
  if (path.isAbsolute(s)) cands.push(s)
  else {
    for (const b of bases) { if (b) cands.push(path.resolve(String(b), s)) }
    cands.push(s, path.join(ROOT, s), path.join(AGENTS, s), path.resolve(process.cwd(), s))
  }
  const tried = []
  for (const p of cands) {
    tried.push(path.resolve(p))
    try {
      if (!exists(p)) continue
      fs.accessSync(p, fs.constants.R_OK)
      const st = fs.statSync(p)
      if (st.isFile() && st.size > 20 * 1024 * 1024) return { ok: false, reason: '文件超过 20MB 上限' }
      return { ok: true, path: p, kind: st.isDirectory() ? 'dir' : 'file', size: st.size }
    } catch (e) { /* next */ }
  }
  return { ok: false, reason: '不可达/不可读（已尝试：' + (tried[0] || path.resolve(s)) + '）' }
}

function refReachable(ref) { return refCheck(ref).ok }

async function refBases(exec) {
  const bases = []
  try {
    const sc = callerScene(exec)
    if (sc && sc.cwd) bases.push(String(sc.cwd))
    if (sc) {
      const ids = (Array.isArray(sc.sessions) ? sc.sessions : []).map((x) => String((x && x.sessionId) || '')).filter(Boolean)
      const list = ((await listSessions()).items || [])
      for (const sid of ids) {
        const hit = list.find((x) => String(x.sessionId || '') === sid)
        if (hit && hit.cwd) bases.push(String(hit.cwd))
      }
    }
  } catch (e) { /* ignore */ }
  return bases
}

async function validateRefsSafe(refs, action, orderId, exec) {
  const bad = []
  const bases = await refBases(exec)
  for (const r of (refs || [])) {
    const s = String(r || '').trim()
    if (!s) { bad.push('（空引用）'); continue }
    if (s.startsWith('#')) continue // 单内段引用
    const c = refCheck(s, bases)
    if (!c.ok) {
      bad.push(s + '（' + c.reason + '）')
      try { await logViolation({ rule: 'PRT-001', path: s, detail: action + ' refs 校验失败：' + c.reason }) } catch (e) { /* ignore */ }
    }
  }
  if (bad.length) return fail('PRT-001', '证据不可达：' + bad.join(' ; ') + '（相对路径按场景工作区解析；handoff/submit/verify/reject 与 close 同规则）', { action, orderId, badRefs: bad, bases })
  return { ok: true }
}

function nextOfOrder(o, who) {
  const fm = (o && o.frontmatter) || {}
  const flow = parseList(fm.flow)
  const cur = String(who || fm.current_owner || fm.assignee || '')
  const i = flow.indexOf(cur)
  return i >= 0 ? (flow[i + 1] || '') : ''
}

async function doNote(args, exec) {
  const scene = String(args.scene || '').trim()
  const refs = Array.isArray(args.refs) ? args.refs : (args.refs ? [args.refs] : [])
  const v = validateNote({ scene, text: args.text, refs, exec })
  if (!v.ok) return fail(v.rule, v.hint, { action: 'note', scene })
  const sc = v.scene
  const orderId = String(args.orderId || '').trim()
  const day = today()
  const dir = ensureDir(path.join(AGENTS, sc.id, 'memory', day))
  const base = (orderId ? slugify(orderId) : 'note')
  let file = path.join(dir, base + '.md')
  // G：文件级 2KB 上限，超出轮转到 .detail.md / .detailN.md
  let rotated = false
  try {
    for (let i = 1; i <= 9; i++) {
      const candidate = i === 1 ? file : path.join(dir, base + '.detail' + (i > 2 ? String(i) : '') + '.md')
      const size = exists(candidate) ? fs.statSync(candidate).size : 0
      if (size + Buffer.byteLength(String(args.text || '').trim(), 'utf8') + 80 <= 2048) { if (candidate !== file) rotated = true; file = candidate; break }
    }
  } catch (e) { /* 轮转失败就用原文件 */ }
  const title = '# ' + (orderId || 'note') + ' · ' + day
  const body = [
    title,
    '',
    String(args.text || '').trim(),
    '',
    '来源：',
    ...v.refs.map((r) => '- ' + r),
    '',
    '- 时间：' + nowIso(),
    '',
  ].join('\n')
  const w = await writeTextGuarded(file, function (existing) {
    return existing ? existing.replace(/\s*$/, '\n\n---\n\n') + body : body
  }, { reason: 'wb_write:note' })
  if (!w.ok) return fail('PRT-014', w.reason || '写入时发现文件被并发改动', { action: 'note', scene: sc.id, stale: true })
  const summaryFile = path.join(AGENTS, sc.id, 'summary.md')
  const beforeHash = hashFile(summaryFile)
  const sum = recomputeSummary(sc.id)
  const summaryChanged = beforeHash !== hashFile(summaryFile)
  try { rebuildMemoryIndex(sc.id) } catch (e) { /* 索引失败不阻断 note */ }
  try { const L = await import('../learn.js'); await L.recordInjectionHit(orderId || 'note', 'note', args.text, v.refs) } catch (e) { /* 命中率失败不阻断 */ }
  return {
    ok: true, action: 'note', scene: sc.id,
    file: path.relative(TOOLS, file).replace(/^\.\.\\/, '').split(path.sep).join('\\'),
    staleRetried: !!w.retried,
    rotated,
    refs: v.refs, summaryUpdated: summaryChanged, summaryChanged, summary: sum.ok ? { bytes: sum.bytes, file: sum.file } : { error: sum.error },
  }
}

async function doRecord(args, exec) { return await doProgress(args, exec) }

function orderParties(o) {
  const fm = (o && o.frontmatter) || {}
  const collabs = String(fm.collaborators || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
  return { dispatcher: String(fm.dispatcher || ''), assignee: String(fm.assignee || ''), collabs }
}
function canV2(o, me, action) {
  if (!o) return { ok: false, rule: 'PRT-005', hint: '找不到 v2 协作单（旧单不解析；请用 wb_read 查看或新建）' }
  const { dispatcher, assignee, collabs } = orderParties(o)
  const who = String(me || '').trim()
  const current = String(o.frontmatter.current_owner || assignee)
  const party = who === dispatcher || who === assignee || collabs.includes(who) || who === 'host'
  if (action === 'comment') return party ? { ok: true } : { ok: false, rule: 'PRT-005', hint: '说明只能由 dispatcher / assignee / collaborators 写' }
  if (action === 'progress' || action === 'handoff') return who === current ? { ok: true } : { ok: false, rule: 'PRT-005', hint: '只有 current_owner（' + current + '）能 progress/handoff；dispatcher 可 comment/verify/close' }
  if (action === 'submit') return (who === assignee || collabs.includes(who) || who === 'host') ? { ok: true } : { ok: false, rule: 'PRT-005', hint: 'submit 只能由 assignee 或 collaborators 写' }
  if (action === 'verify' || action === 'reject') return who === dispatcher ? { ok: true } : { ok: false, rule: 'PRT-005', hint: action + ' 只能由 dispatcher 写（当前 ' + who + '）' }
  if (action === 'close' || action === 'cancel') return (who === dispatcher || who === assignee || who === 'host') ? { ok: true } : { ok: false, rule: 'PRT-005', hint: '关单/取消只能由 dispatcher 或 assignee 写' }
  return { ok: false, rule: 'PRT-005', hint: '未知动作：' + action }
}

async function doComment(args, exec) {
  const id = String(args.orderId || args.id || '').trim()
  const text = String(args.text || args.line || '').trim()
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: 'comment' })
  if (!text) return fail('PRT-005', 'text 不能为空', { action: 'comment' })
  const o = findOrder(id), author = authorOf(args, exec)
  const perm = canV2(o, author, 'comment')
  if (!perm.ok) return fail(perm.rule, perm.hint, { action: 'comment', orderId: id })
  appendProtocolRecord(id, author, 'comment', text)
  await logEvent({ type: 'comment', order_id: id, from: author, note: text.slice(0, 300), protocol: 'v2', refs: args.refs || [] })
  return { ok: true, action: 'comment', orderId: id, author, file: o.file }
}

async function doProgress(args, exec) {
  const id = String(args.orderId || args.id || '').trim()
  const line = String(args.line || args.text || '').trim()
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: 'progress' })
  if (!line) return fail('INV-006', 'line 不能为空（记录要写清做了什么/结论）', { action: 'progress' })
  const o = findOrder(id), author = authorOf(args, exec)
  const perm = canV2(o, author, 'progress')
  if (!perm.ok) return fail(perm.rule, perm.hint, { action: 'progress', orderId: id })
  if (o && !o.frontmatter.started_at) { try { updateOrderFrontmatter(id, { started_at: localIso() }) } catch (e) { /* ignore */ } }
  const hasAck = (await import('../events.js')).readEvents().some((e) => String(e.order_id) === id && e.type === 'ack')
  const ackInText = /ack/i.test(line)
  let ackAuto = false
  if (!hasAck && !ackInText) {
    appendProtocolRecord(id, author, 'ack', '已接单（ack，自动补）')
    await logEvent({ type: 'ack', order_id: id, from: author, protocol: 'v2', auto: true })
    try { appendSessionEvent(author, 'accept', { from: author, to: String(o.frontmatter.dispatcher || ''), reason: 'order ' + id }) } catch (e) { /* ignore */ }
    ackAuto = true
  } else if (ackInText && !hasAck) {
    await logEvent({ type: 'ack', order_id: id, from: author, protocol: 'v2', auto: false, explicit: true })
  }
  const heading = '## 接管-' + author
  let takeover = false
  if (String(o.text).indexOf('\n' + heading + '\n') < 0) {
    appendOrderSection(id, heading)
    await logEvent({ type: 'takeover', order_id: id, from: author, owner: String(o.frontmatter.current_owner || o.frontmatter.assignee || ''), protocol: 'v2' })
    takeover = true
  }
  appendProtocolRecord(id, author, 'progress', line)
  await logEvent({ type: 'progress', order_id: id, from: author, note: line.slice(0, 300), protocol: 'v2' })
  return { ok: true, action: 'progress', orderId: id, author, file: o.file, ackAuto, takeover }
}

/** 单内接力：next（下一棒）/ back（打回上一棒）；只有 current_owner 可发 */
async function doHandoff(args, exec) {
  const id = String(args.orderId || args.id || '').trim()
  const kind = String(args.kind || 'next').trim()
  const to = String(args.to || '').trim()
  const note = String(args.note || args.text || '').trim()
  const refs = Array.isArray(args.refs) ? args.refs : (args.refs ? [args.refs] : [])
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: 'handoff' })
  if (!refs.length) return fail('PRT-001', 'handoff 必须带 refs（引用单内段/证据）', { action: 'handoff', orderId: id })
  if (!['next', 'back'].includes(kind)) return fail('PRT-005', 'kind 只能是 next / back', { action: 'handoff' })
  if (kind === 'next' && !to) return fail('PRT-005', 'to（下一棒角色）不能为空', { action: 'handoff' })
  const rv = await validateRefsSafe(refs, 'handoff', id, exec)
  if (!rv.ok) return rv
  if (kind === 'next') {
    try {
      const evs = (await import('../events.js')).readEvents().filter((e) => String(e.order_id || '') === id && e.type === 'handoff')
      const lastBack = evs.filter((e) => String(e.kind || '') === 'back').slice(-1)[0]
      const since = Date.now() - 10 * 60000
      const dup = evs.slice().reverse().find((e) => {
        const ts = Date.parse(String(e.ts || ''))
        if (!Number.isFinite(ts) || ts < since) return false
        if (String(e.to || '') !== String(to) || String(e.kind || 'next') !== 'next') return false
        if (lastBack && ts < Date.parse(String(lastBack.ts || ''))) return false
        return true
      })
      if (dup) return fail('PRT-005', '重复 handoff：' + id + ' 在 10 分钟内已交接给 ' + to + '（kind=next）；请勿重复转交', { action: 'handoff', orderId: id, duplicate: true })
    } catch (e) { /* ignore */ }
  }
  const o = findOrder(id), author = authorOf(args, exec)
  const perm = canV2(o, author, 'handoff')
  if (!perm.ok) return fail(perm.rule, perm.hint, { action: 'handoff', orderId: id })
  const fm = o.frontmatter || {}
  const dispatcher = String(fm.dispatcher || '')
  const flow = parseList(fm.flow)
  const current = String(fm.current_owner || fm.assignee || '')
  let target = to
  if (kind === 'back') {
    const idx = flow.indexOf(current)
    target = idx > 0 ? flow[idx - 1] : dispatcher
    if (!target) return fail('PRT-005', '没有上一棒可打回', { action: 'handoff' })
  } else if (!flow.includes(target) && target !== dispatcher) {
    return fail('PRT-005', 'to 必须在 flow（' + flow.join(' / ') + '）内或等于 dispatcher（' + dispatcher + '）', { action: 'handoff' })
  }
  if (target === current) return fail('PRT-005', '不能交接给当前 owner 自己', { action: 'handoff' })
  // C：同 order+to+kind 短窗口重复 handoff → 拒绝（打回后的再次交接视为合法）
  try {
    const evs = (await import('../events.js')).readEvents().filter((e) => String(e.order_id || '') === id && e.type === 'handoff')
    const lastBack = evs.filter((e) => String(e.kind || '') === 'back').slice(-1)[0]
    const since = Date.now() - 10 * 60000
    const dup = evs.slice().reverse().find((e) => {
      const ts = Date.parse(String(e.ts || ''))
      if (!Number.isFinite(ts) || ts < since) return false
      if (String(e.to || '') !== String(target) || String(e.kind || 'next') !== String(kind)) return false
      if (lastBack && ts < Date.parse(String(lastBack.ts || ''))) return false
      return true
    })
    if (dup) return fail('PRT-005', '重复 handoff：' + id + ' 在 10 分钟内已交接给 ' + target + '（kind=' + kind + '）；请勿重复转交', { action: 'handoff', orderId: id, duplicate: true })
  } catch (e) { /* ignore */ }
  const newFlow = flow.includes(target) ? flow : flow.concat([target])
  const oldCount = Number(o.frontmatter.handoff_count) || 0
  updateOrderFrontmatter(id, { flow: '[' + newFlow.join(', ') + ']', current_owner: target, handoff_at: localIso(), handoff_count: oldCount + 1 })
  appendOrderSection(id, '## 交接-' + target)
  appendProtocolRecord(id, author, 'handoff', (kind === 'back' ? '打回' : '交接') + ' → ' + target + (note ? ' · ' + note : '') + (refs.length ? ' · ' + refs.join(' ; ') : ''))
  await logEvent({ type: 'handoff', order_id: id, from: author, to: target, kind, note: note.slice(0, 300), refs, protocol: 'v2' })
  try { recomputeSummary(String(o.frontmatter.assignee || '')); recomputeSummary(target) } catch (e) { /* E：handoff 后同步 summary 投影 */ }
  let wake = { attempted: false }
  try {
    const nextWake = nextOfOrder(o, target)
    const w = await wakeScene(target, '【接力】' + id + ' ' + (kind === 'back' ? '打回' : '交接') + '给你（来自 ' + author + '）' + (note ? '：' + note : '') + (nextWake ? '\n下一棒=' + nextWake : '') + (refs.length ? '\n证据：' + refs.join(' ; ') : ''), !!args.force)
    wake = { attempted: true, ok: !!w.ok, degraded: !!w.degraded, hint: w.reason || '' }
    if (w.ok) {
      await logEvent({ type: 'wake', order_id: id, from: author, to: target, reason: 'handoff', kind, protocol: 'v2' })
      await logEvent({ type: 'delivered', order_id: id, from: author, to: target, protocol: 'v2', reason: 'handoff' })
    }
  } catch (e) { wake = { attempted: true, ok: false, hint: String((e && e.message) || e) } }
  return { ok: true, action: 'handoff', orderId: id, from: author, to: target, kind, flow: newFlow, current_owner: target, wake, file: o.file }
}

async function doSubmit(args, exec) {
  const id = String(args.orderId || args.id || '').trim()
  const note = String(args.note || args.text || '').trim()
  const refs = Array.isArray(args.refs) ? args.refs : (args.refs ? [args.refs] : [])
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: 'submit' })
  if (!refs.length) return fail('PRT-001', 'submit 必须带 refs 证据', { action: 'submit', orderId: id })
  const o = findOrder(id), author = authorOf(args, exec)
  const perm = canV2(o, author, 'submit')
  if (!perm.ok) return fail(perm.rule, perm.hint, { action: 'submit', orderId: id })
  const rv = await validateRefsSafe(refs, 'submit', id, exec)
  if (!rv.ok) return rv
  try { updateOrderFrontmatter(id, { submit_at: localIso() }) } catch (e) { /* ignore */ }
  appendProtocolRecord(id, author, 'submit', (note || '已提交') + ' · ' + refs.join(' ; '))
  await logEvent({ type: 'submit', order_id: id, from: author, note: note.slice(0, 300), refs, protocol: 'v2' })
  return { ok: true, action: 'submit', orderId: id, author, refs, file: o.file }
}

async function doVerify(args, exec, kind) {
  const id = String(args.orderId || args.id || '').trim()
  const note = String(args.note || args.text || '').trim()
  const refs = Array.isArray(args.refs) ? args.refs : (args.refs ? [args.refs] : [])
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: kind })
  if (!refs.length) return fail('PRT-001', kind + ' 必须带 refs 证据', { action: kind, orderId: id })
  const o = findOrder(id), author = authorOf(args, exec)
  const perm = canV2(o, author, kind)
  if (!perm.ok) return fail(perm.rule, perm.hint, { action: kind, orderId: id })
  const rv = await validateRefsSafe(refs, kind, id, exec)
  if (!rv.ok) return rv
  const { dispatcher, assignee } = orderParties(o)
  try { updateOrderFrontmatter(id, { verify_at: localIso() }) } catch (e) { /* ignore */ }
  appendOrderSection(id, '## 验收')
  appendProtocolRecord(id, author, kind, (note || (kind === 'verify' ? '验收通过' : '验收退回')) + ' · ' + refs.join(' ; '))
  await logEvent({ type: kind, order_id: id, from: author, note: note.slice(0, 300), refs, protocol: 'v2' })
  return { ok: true, action: kind, orderId: id, author, refs, file: o.file }
}

/** C：按任务关键词给场景 card 打分，返回 2~3 个候选 */
function recommendScenes(task) {
  const raw = String(task || '').toLowerCase()
  const words = new Set(raw.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/g) || [])
  // 中文长词补充 2 字片段，便于「后端接口实现」命中「接口实现」
  for (const seg of raw.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    for (let i = 0; i + 2 <= seg.length; i++) words.add(seg.slice(i, i + 2))
  }
  const list = Array.from(words)
  const rows = scenes().map((s) => {
    const id = String(s.id || '')
    const card = readJson(path.join(AGENTS, id, 'card.json'), {}) || {}
    const text = [s.name, card.name, card.mission, ...(Array.isArray(card.responsibilities) ? card.responsibilities : []), ...(Array.isArray(card.skills) ? card.skills : []), String(s.skill || '')].join(' ').toLowerCase()
    let score = 0
    const hits = []
    for (const w of list) if (text.indexOf(w) >= 0) { score += Math.min(w.length, 4); hits.push(w) }
    return { id, name: String(s.name || id), mission: String(card.mission || s.role || ''), skills: Array.isArray(card.skills) ? card.skills : [], score, reason: hits.length ? '匹配：' + hits.slice(0, 4).join(' / ') : '按职责排序' }
  }).filter((x) => x.id)
  rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return rows.slice(0, 3)
}

async function doTask(args, exec) {
  const to = String(args.to || args.assignee || args.scene || '').trim()
  const task = String(args.task || '').trim()
  if (!task) return fail('PRT-005', 'task 不能为空（任务要说清做什么）', { action: 'task' })
  if (!to) {
    const candidates = recommendScenes(task)
    return { ok: true, action: 'task', candidates, hint: '未指定 assignee：已按各场景 card 名称/职责/技能推荐 ' + candidates.length + ' 个候选；选定后再传 to' }
  }
  const sc = findScene(to)
  if (!sc) return fail('PRT-012', '接单场景未注册：' + to, { action: 'task' })
  const assignee = String(sc.id)
  const from = authorOf(args, exec)
  const loc = String(args.loc || '').trim() || '（待补：改哪些文件/接口）'
  const forbid = String(args.forbid || '').trim() || '（待补：不能动什么）'
  const accept = String(args.accept || '').trim() || '（待补：可观察的验收）'
  const writeScopes = Array.isArray(args.write_scopes) ? args.write_scopes : String(args.write_scopes || '').split(',').map((s) => s.trim()).filter(Boolean)
  const collaborators = Array.isArray(args.collaborators) ? args.collaborators : String(args.collaborators || '').split(',').map((s) => s.trim()).filter(Boolean)
  const dependsOn = Array.isArray(args.depends_on) ? args.depends_on : String(args.depends_on || '').split(',').map((s) => s.trim()).filter(Boolean)
  // A：有 collaborators 且未给 flow → 自动 flow=[assignee, ...collaborators]
  let flowList = Array.isArray(args.flow) ? args.flow.map((x) => String(x || '').trim()).filter(Boolean) : String(args.flow || '').split(',').map((s) => s.trim()).filter(Boolean)
  let flowAuto = false
  if (!flowList.length && collaborators.length) { flowList = [assignee, ...collaborators]; flowAuto = true }
  const hash = taskHash(task, writeScopes)
  // 一任务一单：同 hash 未关闭 → 硬拒绝
  const dup = allOrders().find((o) => !o.done && String(o.frontmatter.task_hash || '') === hash)
  if (dup) {
    return fail('PRT-005', '任务已存在未关闭协作单 ' + dup.id + '（task_hash 相同，硬拒绝）。请用 comment 补充说明/加 collaborators，或先关旧单。', { action: 'task', duplicate: true, existing: dup.id, task_hash: hash })
  }
  // scope 重叠仅警告
  let warning = ''
  const badScopes = writeScopes.filter((s) => {
    const x = String(s || '').trim()
    return path.isAbsolute(x) || x.indexOf('..') >= 0 || /^[a-zA-Z]:[\\/]/.test(x)
  })
  if (badScopes.length) {
    warning = 'write_scopes 越界（只允许工作区相对路径）：' + badScopes.join(' / ')
    try { await logViolation({ rule: 'PRT-010', path: badScopes[0], detail: 'task write_scopes 越界：' + badScopes.join(' / ') }) } catch (e) { /* ignore */ }
  }
  const mine = new Set(writeScopes.map((s) => String(s).toLowerCase()))
  for (const o of allOrders()) {
    if (o.done) continue
    const other = String(o.frontmatter.write_scopes || '').replace(/[\[\]]/g, '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const hit = other.filter((x) => mine.has(x))
    if (hit.length) { warning = 'write_scopes 与 ' + o.id + ' 重叠：' + hit.join(' / ') + '（警告，不硬锁）'; break }
  }
  const grp = groupOfScene(assignee)
  const groupLabel = String(args.group || '') || (grp ? grp.name + '（' + grp.id + '）' : '')
  const evidence = String(args.evidence || '').trim()
  const missingFields = []
  if (!String(args.loc || '').trim()) missingFields.push('交付物')
  if (!String(args.accept || '').trim()) missingFields.push('验收')
  if (!String(args.forbid || '').trim()) missingFields.push('约束')
  if (!evidence) missingFields.push('证据')
  const order = createOrder({ from, to: assignee, task, loc, forbid, accept, slug: args.slug || '', group: groupLabel, collaborators, depends_on: dependsOn, write_scopes: writeScopes, task_hash: hash, flow: flowList.length ? flowList : [assignee], evidence })
  const flowHint = flowAuto ? '本单流程：' + flowList.join(' → ') + ' → 回 ' + (from || 'dispatcher') + '；完成后 handoff 给下一棒' : ''
  // D：复合需求未给 flow / 5 分钟内同 dispatcher 重叠范围 → 警告（不硬拒；force 可强制）
  if (!args.force && /测试|文档|联调/.test(task) && flowList.length < 2) {
    warning = (warning ? warning + '；' : '') + '任务含「测试/文档/联调」且未给 flow：建议一张单用 flow 接力（PRT-015），勿按环节拆单'
  }
  if (!args.force) {
    const now = Date.now()
    for (const o of allOrders()) {
      if (o.id === order.id) continue
      if (o.done || String(o.frontmatter.dispatcher || '') !== from) continue
      const t = Date.parse(String(o.frontmatter.created_at || o.frontmatter.dispatched_at || ''))
      if (!Number.isFinite(t) || now - t > 5 * 60000) continue
      const other = parseList(o.frontmatter.write_scopes).map((x) => x.toLowerCase())
      const hit = other.filter((x) => mine.has(x))
      if (hit.length) { warning = (warning ? warning + '；' : '') + '5 分钟内同 dispatcher 已有未关闭单 ' + o.id + ' 且 write_scopes 重叠（' + hit.join(' / ') + '）；force 可强制'; break }
    }
  }
  const allMissing = Array.from(new Set([...(missingFields || []), ...((order.missing) || [])]))
  if (allMissing.length) warning = (warning ? warning + '；' : '') + '必填项为空：' + allMissing.join(' / ') + '（已警告）'
  await logEvent({ type: 'dispatch', order_id: order.id, from, to: assignee, task: task.slice(0, 300), group: groupLabel, task_hash: hash, write_scopes: writeScopes, depends_on: dependsOn, ref: 'collab/' + order.day + '/' + order.name + '.md', protocol: 'v2' })
  let wake = { attempted: false }
  if (args.wake) {
    const b = canWake(assignee, !!args.force)
    if (!b.ok) wake = { attempted: true, ok: false, skipped: true, used: b.used, limit: b.limit, hint: b.hint }
    else {
      let pointers = search({ query: task, scope: 'memory', limit: 3 }).hits || []
      if (!pointers.length) {
        const kw = String(task || '').replace(/\s+/g, '').slice(0, 2)
        if (kw) pointers = search({ query: kw, scope: 'memory', limit: 3 }).hits || []
      }
      const ptrText = pointers.length
        ? '\n\n相关历史（≤3）：\n' + pointers.map((h) => '- ' + h.path + ' · ' + String(h.one_line || '').slice(0, 80)).join('\n')
        : '\n\n未找到相关历史'
      const nextWake = nextOfOrder(order, assignee)
    const w = await wakeScene(assignee, '【派单 ' + order.id + '】' + task + (nextWake ? '（下一棒=' + nextWake + '）' : '') + '（详情：collab\\' + order.day + '\\' + order.name + '.md）' + ptrText, !!args.force)
      wake = {
        attempted: true, ok: !!w.ok, degraded: !!w.degraded, hint: w.reason || '',
        sessionId: w.sessionId || (findScene(assignee) && findScene(assignee).sessions && findScene(assignee).sessions[0] ? String(findScene(assignee).sessions[0].sessionId || '') : ''),
        error: w.ok ? '' : (w.reason || '提醒失败'), used: b.used, limit: b.limit, forced: !!b.forced,
      }
      await logEvent({ type: 'wake', to: assignee, order_id: order.id, status: w.ok ? 'ok' : (w.degraded ? 'degraded' : 'failed') })
      if (w.ok) await logEvent({ type: 'delivered', order_id: order.id, from: from, to: assignee, protocol: 'v2' })
    }
  }
  return {
    ok: true, action: 'task', orderId: order.id, assignee, task_hash: hash,
    file: 'collab/' + order.day + '/' + order.name + '.md',
    flow: flowList, flowAuto, flowHint,
    wake, warning,
  }
}

async function doClose(args, exec) {
  const id = String(args.orderId || args.id || '').trim()
  const status = String(args.status || 'done').trim()
  const note = String(args.note || '').trim()
  const refs = (Array.isArray(args.refs) ? args.refs : (args.refs ? [args.refs] : [])).map((r) => String(r || '').trim()).filter(Boolean)
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: 'close' })
  if (!['done', 'blocked', 'cancelled'].includes(status)) return fail('PRT-005', 'status 只能是 done / blocked / cancelled', { action: 'close', orderId: id })
  if (status === 'cancelled' && !note) return fail('PRT-005', '取消必须写原因（note）', { action: 'close', orderId: id })
  if (status !== 'blocked' && !note) return fail('PRT-001', '终态必须有结论（note：结论 + 证据路径）', { action: 'close', orderId: id })
  if (status !== 'blocked' && !refs.length) return fail('PRT-001', '终态必须有证据（refs 非空：文件路径 / 命令输出 / 链接）', { action: 'close', orderId: id })
  if (status === 'done') {
    const missing = refs.filter((r) => !refReachable(r))
    if (missing.length) return fail('PRT-001', '证据不可达：' + missing.join(' ; ') + '（请确认文件存在/路径正确后重试）', { action: 'close', orderId: id, missingRefs: missing })
  }
  const o = findOrder(id)
  const author = authorOf(args, exec)
  const perm = canWriteOrder(o, author, { close: true })
  if (!perm.ok) return fail(perm.rule, perm.hint, { action: 'close', orderId: id })
  // C：done 且 current_owner 不是最后一棒 → 不关单，自动 handoff 给下一棒
  if (status === 'done') {
    const flow = parseList(o.frontmatter.flow)
    const current = String(o.frontmatter.current_owner || o.frontmatter.assignee || '')
    const idx = flow.indexOf(current)
    if (idx >= 0 && idx < flow.length - 1) {
      const next = flow[idx + 1]
      updateOrderFrontmatter(id, { current_owner: next })
      appendOrderSection(id, '## 交接-' + next)
      appendProtocolRecord(id, author, 'handoff', 'close 自动接力 → ' + next + '（当前 owner 不是最后一棒，未关单）')
      await logEvent({ type: 'handoff', order_id: id, from: author, to: next, kind: 'next', reason: 'close-relay', protocol: 'v2' })
      let wake = { attempted: false }
      try {
        const w = await wakeScene(next, '【自动接力】' + id + ' ' + current + ' 试图关单，但 flow 还有下一棒：' + next + '；请接管，最后一棒再 close。', !!args.force)
        wake = { attempted: true, ok: !!w.ok, degraded: !!w.degraded }
      } catch (e) { wake = { attempted: true, ok: false, hint: String((e && e.message) || e) } }
      return { ok: true, action: 'close', orderId: id, relayed: true, to: next, current_owner: next, wake, warning: 'current_owner（' + current + '）不是最后一棒，已自动 handoff 给 ' + next + '（未关单）' }
    }
  }
  const assignee0 = String(o.frontmatter.assignee || '')
  const beforeSummaryHash = hashFile(path.join(AGENTS, assignee0, 'summary.md'))
  const r = await closeOrder(id, { status, note, closedBy: author, refs })
  try { rebuildDoneIndex() } catch (e) { /* index 失败不阻断 */ }
  try { const L = await import('../learn.js'); await L.recordInjectionHit(id, 'close', note, refs); await L.autoApply(); L.weeklyReport() } catch (e) { /* 学习闭环失败不阻断关单 */ }
  const assignee = String(o.frontmatter.assignee || '')
  const dispatcher = String(o.frontmatter.dispatcher || '')
  // 关单回执：仅当 dispatcher 不是自己时写 receipt 并唤醒（自关不产生 to=self 噪声）
  try {
    if (dispatcher && dispatcher !== author) {
      const summary = String(note || '').replace(/\s+/g, ' ').slice(0, 120)
      await logEvent({ type: 'receipt', order_id: id, from: author, to: dispatcher, status, note: summary, refs, protocol: 'v2' })
      const msg = '【回执】' + id + ' · ' + (assignee || '?') + ' · ' + status + ' · ' + summary + (refs.length ? '\n证据：' + refs.join(' ; ') : '')
      try { await wakeScene(dispatcher, msg, !!args.force) } catch (e) { /* 回执唤醒失败不阻断 */ }
    }
  } catch (e) { /* ignore */ }
  let sum = findScene(assignee) ? recomputeSummary(assignee) : { ok: false, error: '接单场景未注册' }
  let autoMemory = ''
  if (status === 'done' && assignee) {
    const memDir = path.join(AGENTS, assignee, 'memory')
    const hit = listFiles(memDir, { recursive: true, limit: 300 }).filter((f) => path.basename(f).replace(/\.md$/i, '') === id)
    if (!hit.length) {
      const day = today()
      const dir = ensureDir(path.join(memDir, day))
      const file = path.join(dir, id + '.md')
      const body = ['# ' + id + ' · ' + day, '', String(note || '').trim(), '', '来源：', ...refs.map((x) => '- ' + x), '', '- auto: true（关单时插件自动补写）', '- 时间：' + nowIso(), ''].join('\n')
      try { writeAtomic(file, body); autoMemory = path.relative(AGENTS, file).replace(/\\/g, '/') } catch (e) { /* ignore */ }
      await logEvent({ type: 'comment', order_id: id, warning: 'memory-auto', from: author, note: '关单时未发现 memory 写回，插件已自动补写：' + autoMemory })
    }
    try { rebuildMemoryIndex(assignee) } catch (e) { /* ignore */ }
    try { sum = recomputeSummary(assignee) } catch (e) { /* close 后强制重算，失败不阻断 */ }
    try { appendSessionEvent(assignee, 'end', { reason: 'close done', note: String(note || '').slice(0, 120) }) } catch (e) { /* ignore */ }
    // depends_on：前置 done → 自动 wake 下游一次
    const evs = (await import('../events.js')).readEvents()
    for (const down of allOrders()) {
      if (down.done) continue
      const deps = String(down.frontmatter.depends_on || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
      if (deps.indexOf(id) < 0) continue
      if (evs.some((e) => e.type === 'wake' && String(e.order_id) === down.id && e.reason === 'depends_on')) continue
      try {
        const w = await wakeScene(String(down.frontmatter.assignee || ''), '【依赖完成】' + id + ' 已 done，可开始 ' + down.id + '（详情：collab\\' + down.day + '\\' + path.basename(down.file) + '）', !!args.force)
        await logEvent({ type: 'wake', order_id: down.id, from: 'plugin', to: String(down.frontmatter.assignee || ''), reason: 'depends_on', dependency: id, status: w.ok ? 'ok' : 'degraded' })
      } catch (e) { /* ignore */ }
    }
  }
  const summaryChanged = beforeSummaryHash !== hashFile(path.join(AGENTS, assignee, 'summary.md'))
  return { ok: true, action: 'close', orderId: id, status, file: r.rel, keptOpen: !!r.keptOpen, summaryUpdated: !!(sum.ok && summaryChanged), summaryChanged, autoMemory }
}

/** 取消（close status=cancelled 的便捷入口；需原因 + dispatcher/assignee/host 权限） */
async function doCancel(args, exec) {
  const id = String(args.orderId || args.id || '').trim()
  const note = String(args.note || args.reason || '').trim()
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: 'cancel', orderId: id })
  if (!note) return fail('PRT-005', '取消必须写原因（note）', { action: 'cancel', orderId: id })
  const o = findOrder(id)
  const author = authorOf(args, exec)
  const perm = canWriteOrder(o, author, { close: true })
  if (!perm.ok) return fail(perm.rule, perm.hint, { action: 'cancel', orderId: id })
  const r = await closeOrder(id, { status: 'cancelled', note, closedBy: author })
  try { rebuildDoneIndex() } catch (e) { /* ignore */ }
  const assignee = String(o.frontmatter.assignee || '')
  const sum = findScene(assignee) ? recomputeSummary(assignee) : { ok: false, error: '接单场景未注册' }
  return { ok: true, action: 'cancel', orderId: id, status: 'cancelled', file: r.rel, summaryUpdated: !!sum.ok }
}

/** 恢复被 blocked 的协作单（blocked → open） */
async function doReopen(args, exec) {
  const id = String(args.orderId || args.id || '').trim()
  const note = String(args.note || args.reason || '').trim()
  if (!id) return fail('PRT-005', 'orderId 不能为空', { action: 'reopen', orderId: id })
  const o = findOrder(id)
  if (!o) return fail('PRT-005', '找不到协作单：' + id, { action: 'reopen', orderId: id })
  if (o.state !== 'open') return fail('PRT-005', '只有 open 单可以恢复（当前：' + o.state + '）', { action: 'reopen', orderId: id })
  const author = authorOf(args, exec)
  const r = await reopenOrder(id, { by: author, note })
  return { ok: true, action: 'reopen', orderId: id, status: 'open', file: r.rel, by: author }
}

export async function wbWrite(args = {}, exec) {
  const action = String(args.action || '').trim()
  if (args.dryRun === true || args.dry_run === true) {
    const id = String(args.orderId || args.id || '').trim()
    const base = { ok: true, dryRun: true, action, note: '未写入：dryRun 仅返回将写入内容' }
    if (action === 'task') return { ...base, would: { file: 'collab/<日期>/' + (String(args.to || args.assignee || '').trim() || '<assignee>') + '.md', frontmatter: { protocol: 'v2', assignee: String(args.to || args.assignee || ''), flow: args.flow || [] }, body: args.task || '' } }
    if (action === 'note') return { ...base, would: { file: 'agents/' + (args.scene || '<scene>') + '/memory/<日期>/' + (id || 'note') + '.md', text: String(args.text || ''), refs: args.refs || [] } }
    if (action === 'close') return { ...base, would: { orderId: id, status: args.status || 'done', note: args.note || '', refs: args.refs || [], terminal: '## 终态' } }
    return { ...base, would: { orderId: id, to: args.to || '', kind: args.kind || 'next', refs: args.refs || [] } }
  }
  try {
    if (action === 'note') return await doNote(args, exec)
    if (action === 'record' || action === 'progress') return await doProgress(args, exec)
    if (action === 'comment') return await doComment(args, exec)
    if (action === 'task') return await doTask(args, exec)
    if (action === 'submit') return await doSubmit(args, exec)
    if (action === 'handoff') return await doHandoff(args, exec)
    if (action === 'verify' || action === 'reject') return await doVerify(args, exec, action)
    if (action === 'close') return await doClose(args, exec)
    if (action === 'cancel') return await doCancel(args, exec)
    if (action === 'reopen') return await doReopen(args, exec)
    return fail('PRT-012', 'action 只能是 note / task / comment / progress / submit / verify / reject / handoff / close / cancel / reopen（收到：' + (action || '空') + '）', { action })
  } catch (e) {
    return { ok: false, rule: 'INTERNAL', hint: String((e && e.message) || e).slice(0, 300), action }
  }
}

export { scenes, config }
