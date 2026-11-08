/**
 * handover.js —— 归档会话重新绑定 + orphaned 标记（dh049）。
 *   从文件生成接力摘要（card 职责 + summary 在做/下一步/卡点 + 最近 3 条 memory + 该场景 open 协作单）
 *   → 写 sessions.jsonl handover(old→new, reason=archived) → 给新会话发 seed（接力摘要+核心规则+三步）
 *   → 更新 card 绑定与 registry / scenario。
 */
import fs from 'node:fs'
import path from 'node:path'
import { AGENTS, DSH_HOME, REGISTRY, ROOT, META, CONFIG } from './paths.js'
import { readJson, readText, writeJson, writeAtomic, appendLine, listFiles, ensureDir, exists, statInfo, nowIso } from './store.js'
import { findScene, scenes } from './rules.js'
import { allOrders } from './collab.js'
import { createSession, promptSession, listSessions, renameSession } from './sessions.js'
import { allArchivedSet } from './session-state.js'
import { logEvent } from './events.js'
import { readGroups } from './groups.js'

const SESSIONS_JSONL = path.join(DSH_HOME, 'sessions.jsonl')
const ORPHAN_FILE = path.join(META, 'orphaned.json')

function summarySections(sceneId) {
  const t = readText(path.join(AGENTS, sceneId, 'summary.md'))
  const secs = { doing: '', next: '', blocked: '' }
  let cur = ''
  for (const line of t.split(/\r?\n/)) {
    const h = line.match(/^##\s*(.+)$/)
    if (h) { cur = h[1].trim(); continue }
    const m = line.match(/^[-*]\s*(.+)$/)
    if (m) {
      const v = m[1].trim()
      if (!secs.doing && /在做/.test(cur)) secs.doing = v
      else if (!secs.next && /下一步/.test(cur)) secs.next = v
      else if (!secs.blocked && /卡点/.test(cur)) secs.blocked = v
    }
  }
  return secs
}

function recentMemory(sceneId, n = 3) {
  const dir = path.join(AGENTS, sceneId, 'memory')
  const files = listFiles(dir, { recursive: true, limit: 200 })
    .filter((f) => /\.md$/i.test(f) && path.basename(f).toLowerCase() !== 'index.md' && !/\.errors\.md$/i.test(f))
  files.sort((a, b) => statInfo(b).mtime - statInfo(a).mtime)
  const seen = new Set()
  const out = []
  for (const f of files) {
    const base = path.basename(f).replace(/\.md$/i, '')
    const m = base.match(/^(dh\d+)/i)
    const key = m ? m[1].toLowerCase() : base.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
    if (out.length >= n) break
  }
  return out.map((f) => path.relative(DSH_HOME, f).split(path.sep).join('\\'))
}

/** 接力摘要文本（绝对路径） */
export function buildHandover(sceneId) {
  const sc = findScene(sceneId)
  if (!sc) return { ok: false, hint: '找不到场景：' + sceneId }
  const id = String(sc.id)
  const card = readJson(path.join(AGENTS, id, 'card.json'), null) || {}
  const secs = summarySections(id)
  const mem = recentMemory(id)
  const orders = allOrders().filter((o) => !o.done && String(o.frontmatter.assignee || '') === id)
  const lines = [
    '# 接力摘要 · ' + (sc.name || id),
    '',
    '数据根（绝对）：' + DSH_HOME,
    '协作 id：' + id,
    '职责：' + String(card.mission || (card.responsibilities && card.responsibilities[0]) || '（card 未写）'),
    '身份文件：`' + path.join(AGENTS, id, 'card.json') + '`；摘要：`' + path.join(AGENTS, id, 'summary.md') + '`',
    '',
    '## 在做', '- ' + (secs.doing || '（未写）'),
    '## 下一步', '- ' + (secs.next || '（未写）'),
    '## 卡点', '- ' + (secs.blocked || '（未写）'),
    '',
    '## 最近记忆',
    ...(mem.length ? mem.map((m) => '- `' + path.join(DSH_HOME, m) + '`') : ['- （无）']),
    '',
    '## 在途协作单',
    ...(orders.length ? orders.slice(0, 8).map((o) => '- ' + o.id + ' · ' + String((o.body.match(/^\*\*任务\*\*[：:]\s*(.+)$/m) || [])[1] || '').slice(0, 80) + ' · `' + o.file + '`') : ['- 无单即收（不要调研/探索，直接回执）']),
    '',
  ]
  return { ok: true, text: lines.join('\n'), sceneId: id, orders: orders.length, memory: mem.length }
}

/** 交接预览（F）：返回摘要文本 + card/summary/open 单摘要，供 UI 折叠预览 */
export function handoverPreview(sceneId) {
  const h = buildHandover(sceneId)
  if (!h.ok) return h
  const id = String(sceneId || '')
  const sc = findScene(id) || {}
  const card = readJson(path.join(AGENTS, id, 'card.json'), null) || {}
  const secs = summarySections(id)
  const orders = allOrders().filter((o) => !o.done && String(o.frontmatter.assignee || '') === id)
  return {
    ok: true, sceneId: id, text: h.text,
    card: { name: String(card.name || sc.name || id), mission: String(card.mission || '') },
    summary: secs,
    openOrders: orders.slice(0, 8).map((o) => o.id),
  }
}

function updateBindings(sceneId, newSessionId, title) {
  const id = String(sceneId)
  // card
  const cardFile = path.join(AGENTS, id, 'card.json')
  const card = readJson(cardFile, null) || { schemaVersion: 1, id }
  card.sessions = [{ sessionId: newSessionId }]
  writeJson(cardFile, card)
  // registry（无壳真源；有壳也同步，避免 board 读旧会话）
  const reg = readJson(REGISTRY, {}) || {}
  const arr = Array.isArray(reg.scenes) ? reg.scenes : []
  const sc = arr.find((x) => String(x.id) === id)
  if (sc) {
    sc.sessions = [{ panelId: (sc.panels && sc.panels[0] ? sc.panels[0].panelId : id + '-ai'), sessionId: newSessionId, title: String(title || '') }]
    delete sc.lifecycle
    delete sc.archivedAt
    const lastGroup = String(sc.lastGroup || '')
    if (lastGroup && Array.isArray(reg.groups)) {
      const g = reg.groups.find((x) => String(x.id) === lastGroup)
      if (g) { if (!Array.isArray(g.members)) g.members = []; if (g.members.indexOf(id) < 0) g.members.push(id) }
    }
    writeJson(REGISTRY, reg)
  }
  // 壳场景 json（若有）
  try {
    const sf = path.join(ROOT, '外壳', 'scenarios', id + '.json')
    if (exists(sf)) {
      const scen = readJson(sf, null)
      if (scen && Array.isArray(scen.panels)) {
        for (const p of scen.panels) if (p && p.type === 'harness') { p.sessionId = newSessionId; if (title) p.sessionTitle = title }
        writeJson(sf, scen)
      }
    }
  } catch (e) { /* ignore */ }
  return { card: cardFile }
}

function stamp() {
  const d = new Date()
  const p2 = (n) => (n < 10 ? '0' : '') + n
  return p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes())
}

/** A：新会话保持原场景名；重名加「 2」「 3」 */
async function uniqueSceneTitle(sc, excludeSessionId) {
  const base = String(sc.name || sc.id)
  // A：只与「registry 绑定中的会话」去重，历史残留同名 app 会话不参与
  const bound = new Set()
  try {
    for (const s of scenes()) for (const ses of (Array.isArray(s.sessions) ? s.sessions : [])) if (ses && ses.sessionId) bound.add(String(ses.sessionId))
  } catch (e) { /* ignore */ }
  let titles = []
  try {
    titles = ((await listSessions()).items || [])
      .filter((x) => bound.has(String(x.sessionId || '')) && String(x.sessionId || '') !== String(excludeSessionId || ''))
      .map((x) => String(x.title || ''))
  } catch (e) { /* 引擎不可达 */ }
  if (titles.indexOf(base) < 0) return base
  for (let i = 2; i < 100; i++) if (titles.indexOf(base + ' ' + i) < 0) return base + ' ' + i
  return base + ' ' + Date.now()
}

/** A：旧会话改名为 `<原场景名>（已交接 MM-DD HH:mm）` */
function archivedSceneTitle(sc) {
  return String(sc.name || sc.id) + '（已交接 ' + stamp() + '）'
}

/**
 * 重新绑定场景到新会话。
 * @param {{id:string, sessionId?:string, autoCreate?:boolean, title?:string}} opts
 */
export async function rebindScene(opts = {}) {
  const id = String(opts.id || '').trim()
  const sc = findScene(id)
  if (!sc) return { ok: false, rule: 'PRT-012', hint: '找不到场景：' + id }
  const old = Array.isArray(sc.sessions) && sc.sessions[0] ? String(sc.sessions[0].sessionId || '') : ''
  let newId = String(opts.sessionId || '').trim()
  let createInfo = null
  let newTitle = String(opts.title || '').trim()
  if (!newId) {
    if (!opts.autoCreate) return { ok: false, rule: 'PRT-012', hint: '请选新会话或开启自动新建' }
    const cfg = readJson(CONFIG, {}) || {}
    // ① 交接工作区回退链：表单 cwd → 会话 cwd → 场景 cwd → config.defaultCwd → dataRoot
    let cwd = String(opts.cwd || '').trim()
    if (!cwd && old) {
      try {
        const hit = ((await listSessions()).items || []).find((x) => String(x.sessionId || '') === old)
        if (hit && hit.cwd) cwd = String(hit.cwd)
      } catch (e) { /* 引擎不可达 */ }
    }
    if (!cwd) cwd = String(sc.cwd || '').trim()
    if (!cwd) cwd = String(cfg.defaultCwd || '').trim()
    if (!cwd) cwd = DSH_HOME
    if (!cwd) return { ok: false, rule: 'PRT-012', hint: '交接目标工作区未确定：请在表单里选择一个工作区（或先配置默认工作区）后重试' }
    // A：先改旧会话名，再建新会话用原名；冲突检测排除正在交接的旧会话
    if (old) {
      try { await renameSession(old, archivedSceneTitle(sc)) } catch (e) { /* 旧会话改名失败不阻断交接 */ }
    }
    if (!newTitle) newTitle = await uniqueSceneTitle(sc, old)
    const cr = await createSession({ title: newTitle, cwd, seed: false })
    if (!cr.ok) return { ok: false, rule: 'PRT-012', hint: '自动新建会话失败：' + cr.error }
    newId = cr.sessionId
    createInfo = cr
    if (old) {
      try { await renameSession(old, archivedSceneTitle(sc)) } catch (e) { /* 旧会话改名失败不阻断交接 */ }
    }
  }
  if (newId === old) return { ok: false, rule: 'PRT-012', hint: '新会话不能与旧会话相同' }
  const h = buildHandover(id)
  if (!h.ok) return h
  const title = newTitle || (sc.name || id) + '（接力）'
  updateBindings(id, newId, title)
  try {
    appendLine(SESSIONS_JSONL, JSON.stringify({ ts: nowIso(), type: 'handover', from: old, to: newId, scene: id, reason: 'archived', by: 'plugin' }) + '\n')
  } catch (e) { /* ignore */ }
  const seed = h.text + '\n## 收口三步\n1. 先读上面的接力摘要，够用就开工\n2. 干完把结论写回 memory 和 summary\n3. 回执 3 行内（结论+证据路径）\n\n## 规则\n记忆写回 / 结论带来源 / 只写自己目录 / 协作单状态按 v2。\n'
  const sd = await promptSession(newId, seed)
  try { await logEvent({ type: 'handover', scene: id, from: old, to: newId, status: 'archived', seeded: !!sd.ok }) } catch (e) { /* ignore */ }
  return { ok: true, sceneId: id, oldSessionId: old, newSessionId: newId, handover: h.text, seeded: !!sd.ok, seedError: sd.ok ? '' : (sd.reason || ''), autoCreated: !!createInfo }
}

/** 解除绑定（仅文件模式）：保留 card/summary/memory，但场景无会话；之后可重新绑定 */
export function unbindScene(id) {
  const sceneId = String(id || '').trim()
  const sc = findScene(sceneId)
  if (!sc) return { ok: false, hint: '找不到场景：' + sceneId }
  const cardFile = path.join(AGENTS, sceneId, 'card.json')
  const card = readJson(cardFile, null) || { schemaVersion: 1, id: sceneId }
  card.sessions = []
  writeJson(cardFile, card)
  const reg = readJson(REGISTRY, {}) || {}
  const arr = Array.isArray(reg.scenes) ? reg.scenes : []
  const row = arr.find((x) => String(x.id) === sceneId)
  if (row) {
    let gid = ''
    try { gid = String(readGroups().sceneGroup[sceneId] || row.lastGroup || '') } catch (e) { gid = '' }
    row.sessions = []
    delete row.lifecycle
    delete row.archivedAt
    row.lastGroup = gid
  }
  if (Array.isArray(reg.groups)) for (const g of reg.groups) g.members = (g.members || []).filter((m) => String(m) !== sceneId)
  writeJson(REGISTRY, reg)
  try {
    const sf = path.join(ROOT, '外壳', 'scenarios', sceneId + '.json')
    if (exists(sf)) {
      const scen = readJson(sf, null)
      if (scen && Array.isArray(scen.panels)) {
        for (const p of scen.panels) if (p && p.type === 'harness') { p.sessionId = ''; p.sessionTitle = '' }
        writeJson(sf, scen)
      }
    }
  } catch (e) { /* ignore */ }
  return { ok: true, sceneId, unbound: true, card: cardFile, note: '场景已解除绑定（仅文件模式）：card/summary/memory 保留，等待重新绑定' }
}

/** 扫描并记录 orphaned（assignee 场景会话已归档），不自动取消 */
export async function markOrphanedOrders() {
  const archived = allArchivedSet()
  const archivedScenes = new Set(scenes().filter((s) => {
    const sid = Array.isArray(s.sessions) && s.sessions[0] ? String(s.sessions[0].sessionId || '') : ''
    return sid && archived.has(sid)
  }).map((s) => String(s.id)))
  const hit = allOrders().filter((o) => !o.done && archivedScenes.has(String(o.frontmatter.assignee || ''))).map((o) => o.id)
  let prev = []
  try { prev = (readJson(ORPHAN_FILE, null) || {}).orders || [] } catch (e) { prev = [] }
  const fresh = hit.filter((x) => !prev.includes(x))
  try {
    ensureDir(META)
    writeJson(ORPHAN_FILE, { orders: hit, scenes: [...archivedScenes], at: nowIso() })
  } catch (e) { /* ignore */ }
  for (const oid of fresh) { try { await logEvent({ type: 'orphaned', order_id: oid, reason: 'assignee-archived' }) } catch (e) { /* ignore */ } }
  return { ok: true, orphanedOrders: hit, archivedScenes: [...archivedScenes], fresh }
}
