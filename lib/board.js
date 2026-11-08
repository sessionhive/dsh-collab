/**
 * board.js —— 看板数据（P1.5）：场景状态 / 协作在途 / 事件 / 预算 / 黑板 / 违规。
 * 供 GET /plugins/workbench-core/board-data 与 工具\wb_read(board) 共用。
 */
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AGENTS, BLACKBOARD, GLOBAL_RULES, DSH_HOME, BOARD_HTML, EVENTS_FILE, COLLAB, CONFIG, REGISTRY } from './paths.js'
import { readText, readJson, listFiles, today, statInfo } from './store.js'
import { readEvents } from './events.js'
import { scenes, findScene } from './rules.js'
import { allOrders, deriveStatus } from './collab.js'
import { computeTiming } from './timing.js'
import { learnSummary } from './learn.js'
import { config } from './budget.js'
import { readGroups } from './groups.js'
import { enginePort } from './engine-port.js'
import { allArchivedSet, contextTokenMap } from './session-state.js'

function summarySections(sceneId) {
  const t = readText(path.join(AGENTS, sceneId, 'summary.md'))
  if (!t) return null
  const secs = { doing: '', next: '', blocked: '' }
  let cur = ''
  for (const line of t.split(/\r?\n/)) {
    const h = line.match(/^##\s*(.+)$/)
    if (h) { cur = h[1].trim(); continue }
    if (/^[-*]\s*/.test(line) && line.replace(/^[-*]\s*/, '').trim()) {
      const v = line.replace(/^[-*]\s*/, '').trim()
      if (/在做/.test(cur) && !secs.doing) secs.doing = v
      else if (/下一步/.test(cur) && !secs.next) secs.next = v
      else if (/卡点/.test(cur) && !secs.blocked) secs.blocked = v
    }
  }
  return secs
}

function boardIndex(date) {
  let days = []
  try { days = fs.readdirSync(BLACKBOARD).filter((d) => d !== 'archive').sort().reverse() } catch (e) { return { date: '', entries: [] } }
  const day = date || days[0] || today()
  const f = path.join(BLACKBOARD, day, 'index.json')
  let entries = []
  try {
    const j = JSON.parse(readText(f))
    const arr = Array.isArray(j) ? j : (Array.isArray(j.records) ? j.records : (Array.isArray(j.entries) ? j.entries : []))
    entries = arr.map((e) => ({
      id: String((e && e.id) || ''),
      type: String((e && e.type) || ''),
      epistemic: String((e && e.epistemic) || ''),
      title: String((e && (e.one_line || e.title || e.text)) || ''),
      at: String((e && (e.at || e.date)) || ''),
    }))
  } catch (e) { entries = [] }
  return { date: day, entries: entries.slice(0, 50) }
}

/** 纯 JSON 安全：去掉 undefined / NaN（引擎工具输出按 lossless JSON 校验，原样返回会报 invalid output） */
function jsonSafe(v) { return JSON.parse(JSON.stringify(v)) }

const BOARD_CACHE = { at: 0, lean: null, sig: '' }

function boardSig() {
  try { return String(fs.statSync(EVENTS_FILE).size) + ':' + String(fs.statSync(EVENTS_FILE).mtimeMs) + ':' + String(fs.statSync(COLLAB).mtimeMs) + ':' + String(fs.statSync(CONFIG).mtimeMs) + ':' + String(fs.statSync(REGISTRY).mtimeMs) } catch (e) { return String(Date.now()) }
}

export async function boardData({ full = false } = {}) {
  const sig = boardSig()
  if (!full && BOARD_CACHE.lean && BOARD_CACHE.sig === sig && Date.now() - BOARD_CACHE.at < 2000) return BOARD_CACHE.lean
  const cfg = config()
  const ctxMap = await contextTokenMap()
  const archived = allArchivedSet()
  const archivedSceneIds = new Set(scenes().filter((s) => {
    const sid = Array.isArray(s.sessions) && s.sessions[0] ? String(s.sessions[0].sessionId || '') : ''
    return sid && archived.has(sid)
  }).map((s) => String(s.id)))
  const ev = readEvents()
  const isoDay = new Date().toISOString().slice(0, 10)
  const evToday = ev.filter((e) => String(e.ts || '').startsWith(isoDay))
  const orders = allOrders()
  const open = orders.filter((o) => !o.done).map((o) => {
    const status = deriveStatus(o, ev)
    const orphaned = archivedSceneIds.has(String(o.frontmatter.assignee || ''))
    const fm = o.frontmatter || {}
    const flow = String(fm.flow || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
    const cur = String(fm.current_owner || fm.assignee || '')
    const ci = flow.indexOf(cur)
    return {
      id: o.id, assignee: fm.assignee || '', dispatcher: fm.dispatcher || '', owner: fm.owner || fm.dispatcher || '',
      current_owner: cur, flow, next: ci >= 0 ? (flow[ci + 1] || '') : '',
      timeline: ev.filter((e) => String(e.order_id || '') === o.id).map((e) => ({ ts: e.ts, type: e.type, from: e.from || '', to: e.to || '', note: String(e.note || e.task || '').slice(0, 200) })),
      fileAbs: o.file,
      timing: computeTiming(o, ev),
      metrics: computeTiming(o, ev),
      events: ev.filter((e) => String(e.order_id || '') === o.id && !['handover', 'rename', 'session'].includes(String(e.type || ''))).map((e) => ({ ts: e.ts, type: e.type, from: e.from || '', to: e.to || '', note: String(e.note || e.task || '').slice(0, 300), refs: Array.isArray(e.refs) ? e.refs : [] })),
      task: (() => {
        const m = String(o.body || '').match(/^\*\*任务\*\*[：:]\s*(.+)$/m)
        if (m) return m[1].trim()
        const sec = String(o.body || '').split(/^## 派单/m)[1] || ''
        const line = sec.split(/\r?\n/).map((x) => x.trim()).find((x) => x && !/^#/.test(x)) || ''
        return line.replace(/^【派单[^】]*】\s*/, '').replace(/^-\s*/, '').slice(0, 160)
      })(),
      rel: path.relative(DSH_HOME, o.file).split(path.sep).join('\\'),
      day: o.day,
      state: o.done ? 'done' : (o.state || 'open'),
      derived: orphaned ? 'orphaned' : status,
      status: orphaned ? 'orphaned' : status,
      orphaned,
      interrupted: status === 'interrupted',
      blocked: status === 'blocked',
    }
  })
  const doneToday = orders.filter((o) => o.state === 'done' && o.day === today()).map((o) => ({ id: o.id, assignee: o.frontmatter.assignee || '', status: 'done' }))
  const cancelledToday = orders.filter((o) => o.state === 'cancelled' && o.day === today()).map((o) => ({ id: o.id, assignee: o.frontmatter.assignee || '', status: 'cancelled' }))
  // B②：全部单（open/done/cancelled）按时间倒序，默认近 20 条
  const recent = orders.slice(0, 20).map((o) => {
    const fm = o.frontmatter || {}
    const flow = String(fm.flow || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
    const cur = String(fm.current_owner || fm.assignee || '')
    const ci = flow.indexOf(cur)
    const task = String((String(o.body || '').match(/(?:【派单[^】]*】|\*\*任务\*\*[：:])\s*(.+)/) || [])[1] || '').slice(0, 80)
    return {
      id: o.id, state: o.state, status: o.state, day: o.day, assignee: String(fm.assignee || ''), dispatcher: String(fm.dispatcher || ''),
      current_owner: cur, flow, next: ci >= 0 ? (flow[ci + 1] || '') : '', task,
      rel: path.relative(DSH_HOME, o.file).split(path.sep).join('\\'), fileAbs: o.file,
      refs: String(fm.refs || '').replace(/[\[\]]/g, '').split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 8),
      timing: computeTiming(o, ev),
      metrics: computeTiming(o, ev),
      timeline: ev.filter((e) => String(e.order_id || '') === o.id && !['handover', 'rename', 'session'].includes(String(e.type || ''))).map((e) => ({ ts: e.ts, type: e.type, from: e.from || '', to: e.to || '', note: String(e.note || e.task || '').slice(0, 200) })),
      events: ev.filter((e) => String(e.order_id || '') === o.id && !['handover', 'rename', 'session'].includes(String(e.type || ''))).map((e) => ({ ts: e.ts, type: e.type, from: e.from || '', to: e.to || '', note: String(e.note || e.task || '').slice(0, 300), refs: Array.isArray(e.refs) ? e.refs : [] })),
    }
  })
  const statusCounts = {}
  for (const o of open) statusCounts[o.status] = (statusCounts[o.status] || 0) + 1
  const gs = readGroups()
  const warnTokens = Number(cfg.handover && cfg.handover.warnContextTokens) || 60000
  const thresholdTokens = Number(cfg.handover && cfg.handover.contextThresholdTokens) || 120000
  const life = { active: 0, pending: 0, archived: 0, oldArchived: 0 }
  const sceneRows = scenes().map((s) => {
    const id = String(s.id)
    const card = readJson(path.join(AGENTS, id, 'card.json'), {}) || {}
    const secs = summarySections(id)
    const own = open.filter((o) => String(o.assignee) === id)
    const last = ev.filter((e) => e && (e.to === id || e.from === id)).slice(-1)[0]
    const gid = gs.sceneGroup[id] || ''
    const grp = gid ? gs.groups.find((x) => x.id === gid) : null
    const sid = Array.isArray(s.sessions) && s.sessions[0] ? String(s.sessions[0].sessionId || '') : ''
    const isArchived = String(s.lifecycle) === 'archived' || (!!sid && archived.has(sid))
    const state = isArchived ? 'archived' : (sid ? 'active' : 'pending')
    life[state]++
    if (state === 'archived' && s.archivedAt && Date.now() - new Date(s.archivedAt).getTime() > 30 * 24 * 3600 * 1000) life.oldArchived++
    const contextTokens = sid && ctxMap[sid] != null ? ctxMap[sid] : null
    const pressure = contextTokens == null ? 'unknown' : (contextTokens >= thresholdTokens ? 'fail' : (contextTokens >= warnTokens ? 'warn' : 'ok'))
    return {
      id, name: String(s.name || id), skill: String(s.skill || ''),
      mission: String(card.mission || ''), skills: Array.isArray(card.skills) ? card.skills : [],
      lifecycle: String(s.lifecycle || ''), state, archivedAt: String(s.archivedAt || ''), lastGroup: String(s.lastGroup || ''),
      panels: Array.isArray(s.panels) ? s.panels.length : 0,
      summary: secs, openOrders: own.length,
      recentOrders: orders.filter((o) => String(o.frontmatter.assignee || '') === id).slice(-5).map((o) => ({ id: o.id, task: String((String(o.body || '').match(/(?:【派单[^】]*】|\*\*任务\*\*[：:])\s*(.+)/) || [])[1] || '').slice(0, 60), status: o.state, rel: path.relative(DSH_HOME, o.file).split(path.sep).join('\\') })),
      handover: ev.filter((e) => e && e.type === 'handover' && (String(e.scene || '') === id || String(e.from || '') === id || String(e.to || '') === id)).slice(-5).map((e) => ({ ts: e.ts, from: e.from || '', to: e.to || '', status: e.status || '' })),
      sessionId: sid,
      archived: isArchived,
      contextTokens,
      warnContextTokens: warnTokens,
      contextThresholdTokens: thresholdTokens,
      pressure,
      interruptedOrders: own.filter((o) => o.status === 'interrupted').length,
      blockedOrders: own.filter((o) => o.status === 'blocked').length,
      lastEventAt: last ? String(last.ts || '') : '',
      summaryPath: 'agents\\' + id + '\\summary.md',
      group: grp ? { id: grp.id, name: grp.name } : null,
    }
  })
  const violations = ev.filter((e) => e && e.type === 'violation')
  const board = boardIndex()
  const out = jsonSafe({
    ok: true,
    generatedAt: new Date().toISOString(),
    root: DSH_HOME,
    scenes: sceneRows,
    learn: (() => { try { return learnSummary() } catch (e) { return { ok: false, error: String((e && e.message) || e) } } })(),
    orders: { open, recent, doneToday, cancelledToday, statusCounts },
    events: {
      today: evToday.length,
      total: ev.length,
      last: ev.filter((e) => !['handover', 'rename', 'session'].includes(String(e.type || ''))).slice(-8).map((e) => ({ ts: e.ts || '', type: e.type || '', from: e.from || '', to: e.to || '', order_id: e.order_id || '', status: e.status || '', text: String(e.text || '').slice(0, 120) })),
    },
    budget: { handover: cfg.handover, notice: cfg.notice, warnContextTokens: warnTokens, contextThresholdTokens: thresholdTokens },
    lifecycle: life,
    enginePort: enginePort(),
    archivedSessionIds: [...archived],
    board,
    groups: gs.groups,
    violations: { today: violations.filter((v) => String(v.ts || '').startsWith(isoDay)).length, last: violations.slice(-5) },
    globalRules: { path: GLOBAL_RULES, bytes: statInfo(GLOBAL_RULES).size },
    boardPage: BOARD_BUILTIN,
    ...(full ? { config: cfg.raw } : {}),
  })
  if (!full) { BOARD_CACHE.at = Date.now(); BOARD_CACHE.lean = out; BOARD_CACHE.sig = sig }
  return out
}

/** 看板页内置模板（dh042）：不再读中文工作区目录，外部无工作区也可用 */
export const BOARD_BUILTIN = fileURLToPath(new URL('./board-page.html', import.meta.url))

/** 把内置看板写到 <dataRoot>\board\index.html（dh048/dh049：英文目录；注入引擎端口） */
export function ensureBoardPage(port) {
  try {
    let html = fs.readFileSync(BOARD_BUILTIN, 'utf8')
    const p = String(port || enginePort())
    // 只替换第一个占位（赋值处）；board-page 的哨兵比较保留 "__WB_ENGINE_PORT__" 用于判断是否注入
    html = html.replace('__WB_ENGINE_PORT__', p)
    const dir = path.dirname(BOARD_HTML)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    let cur = ''
    try { cur = fs.readFileSync(BOARD_HTML, 'utf8') } catch (e) { cur = '' }
    if (cur !== html) fs.writeFileSync(BOARD_HTML, html, 'utf8')
    return { ok: true, file: BOARD_HTML, written: cur !== html, enginePort: Number(p) }
  } catch (e) {
    return { ok: false, file: BOARD_HTML, error: String((e && e.message) || e) }
  }
}

export function boardHtml() {
  const p = String(enginePort())
  const inject = (html) => {
    // 仅当赋值处仍是占位时才替换第一个；哨兵比较保留，保证 PORT_OK 判断正确
    if (html.indexOf("var INJECTED_PORT = '__WB_ENGINE_PORT__'") < 0) return html
    return html.replace('__WB_ENGINE_PORT__', p)
  }
  try { return inject(fs.readFileSync(BOARD_HTML, 'utf8')) } catch (e) {
    try { return inject(fs.readFileSync(BOARD_BUILTIN, 'utf8')) } catch (e2) { return '' }
  }
}
