/**
 * tools/read.js —— wb_read 实现：check / scene / order / board。
 * 只读；不写任何文件。返回 { ok, action, ... }。
 */
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { ROOT, TOOLS, AGENTS, DSH_HOME, COLLAB, BLACKBOARD, SHARED, EVENTS_DIR, META, CONFIG, REGISTRY } from '../paths.js'
import { readText, readJson, listFiles, statInfo } from '../store.js'
import { scenes, findScene, callerScene } from '../rules.js'
import { findOrder, allOrders, deriveStatus } from '../collab.js'
import { boardData } from '../board.js'
import { computeTiming } from '../timing.js'
import { readEvents } from '../events.js'
import { search } from '../search.js'

function runCheck(file, args = []) {
  const full = path.join(TOOLS, file)
  if (!fs.existsSync(full)) {
    return { ok: true, code: 0, summary: '外部环境无工具层（缺 工具\\' + file + '），跳过 ' + path.basename(file), errors: [], degraded: true, missing: path.join('工具', file) }
  }
  try {
    const r = spawnSync(process.execPath, [full, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 90000, windowsHide: true })
    const out = String((r.stdout || '') + (r.stderr || '')).trim()
    const lines = out.split(/\r?\n/).filter(Boolean)
    return { ok: r.status === 0, code: r.status, summary: lines.slice(-1)[0] || '', errors: lines.filter((l) => (/✗|FAIL|FAILED|失败|不一致/.test(l) && !/异常 0 个/.test(l))).slice(0, 5) }
  } catch (e) {
    return { ok: false, code: -1, summary: String((e && e.message) || e), errors: [], degraded: true }
  }
}

/** 外部无工具层时的插件自带自检（dh042）：bootstrap / registry 一致性 / config / skills */
function builtinCheck() {
  const t0 = Date.now()
  const items = []
  const add = (name, ok, summary) => items.push({ name, ok: !!ok, code: ok ? 0 : 1, summary: String(summary || '').slice(0, 200), errors: ok ? [] : [String(summary || '').slice(0, 200)], degraded: false, builtin: true })
  // 1) bootstrap 目录/缺省文件
  const needDirs = [AGENTS, COLLAB, BLACKBOARD, SHARED, EVENTS_DIR, META]
  const needFiles = [CONFIG, REGISTRY, path.join(SHARED, 'env', 'global-rules.md')]
  const missDirs = needDirs.filter((d) => !fs.existsSync(d))
  const missFiles = needFiles.filter((f) => !fs.existsSync(f))
  add('bootstrap（目录/缺省文件）', missDirs.length === 0 && missFiles.length === 0, missDirs.length || missFiles.length ? '缺：' + missDirs.concat(missFiles).map((x) => path.basename(x)).join('、') : '目录与 config/registry/global-rules 齐全')
  // 2) registry 一致性
  let regOk = false, regMsg = ''
  try {
    const reg = readJson(REGISTRY, null)
    if (!reg || typeof reg !== 'object') { regMsg = 'registry 读不到或不是 JSON' }
    else {
      const arr = Array.isArray(reg.scenes) ? reg.scenes : []
      const bad = arr.filter((s) => !s || !s.id || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(String(s.id)))
      const ids = new Set(arr.map((s) => String(s.id)))
      const groups = Array.isArray(reg.groups) ? reg.groups : []
      const badGroups = groups.filter((g) => !g || !g.id || (Array.isArray(g.members) ? g.members : []).some((m) => !ids.has(String(m))))
      regOk = bad.length === 0 && badGroups.length === 0
      regMsg = regOk ? ('场景 ' + arr.length + ' 个 / 分组 ' + groups.length + ' 个，id 与 members 一致') : ('非法场景 ' + bad.length + ' 个，非法分组 ' + badGroups.length + ' 个')
    }
  } catch (e) { regMsg = 'registry 解析失败：' + String((e && e.message) || e) }
  add('registry 一致性', regOk, regMsg)
  // 3) config 结构
  let cfgOk = false, cfgMsg = ''
  try {
    const c = readJson(CONFIG, null)
    const b = c && c.budget, h = c && c.handover
    cfgOk = !!c && (b === undefined || typeof b === 'object') && (h === undefined || typeof h === 'object')
    cfgMsg = cfgOk ? 'config.json 可读（budget/handover 结构正常）' : 'config.json 结构异常'
  } catch (e) { cfgMsg = 'config 读取失败：' + String((e && e.message) || e) }
  add('config 结构', cfgOk, cfgMsg)
  // 4) skills
  let skOk = false, skMsg = ''
  try {
    const dir = path.join(DSH_HOME, 'skills')
    const dirs = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name[0] !== '_').map((d) => d.name) : []
    const bad = dirs.filter((id) => {
      const f = path.join(dir, id, 'SKILL.md')
      if (!fs.existsSync(f)) return true
      return fs.statSync(f).size > 16 * 1024
    })
    skOk = bad.length === 0
    skMsg = skOk ? ('技能 ' + dirs.length + ' 个（SKILL.md 齐全且 ≤16KB）') : ('异常技能：' + bad.join('、'))
  } catch (e) { skMsg = 'skills 检查失败：' + String((e && e.message) || e) }
  add('skills（SKILL.md/≤16KB）', skOk, skMsg)
  return {
    ok: items.every((x) => x.ok), action: 'check', mode: 'builtin',
    checks: items, okCount: items.filter((x) => x.ok).length, total: items.length,
    degraded: false, degradedReason: '',
    hint: '外部环境无工具层，已改用插件自带自检（bootstrap/registry/config/skills），不是降级失败',
    ms: Date.now() - t0,
  }
}

function checkAll() {
  // dh042：外部无 工具\ 时跑插件自带自检，而不是全部 degraded
  if (!fs.existsSync(path.join(TOOLS, '宪法.mjs'))) return builtinCheck()
  const items = [
    { name: '宪法', r: runCheck(path.join('宪法.mjs'), ['--check']) },
    { name: 'registry/索引', r: runCheck(path.join('gen', 'gen-index.mjs'), ['--check']) },
    { name: '交接完整性', r: runCheck(path.join('gen', 'check-handover.mjs'), []) },
  ]
  const ok = items.filter((x) => x.r.ok).length
  const missing = items.map((x) => x.r.missing).filter(Boolean)
  return {
    ok: ok === items.length,
    action: 'check',
    checks: items.map((x) => ({ name: x.name, ok: x.r.ok, code: x.r.code, summary: x.r.summary, errors: x.r.errors, degraded: !!x.r.degraded, missing: x.r.missing || '' })),
    okCount: ok,
    total: items.length,
    degraded: missing.length > 0 || items.some((x) => x.r.degraded && !x.r.missing),
    degradedReason: missing.length
      ? '外部环境无工具层：缺 ' + missing.join('、') + '，已跳过对应检查（不是失败）；有 工具\\ 目录的工作台会正常执行'
      : (items.some((x) => x.r.degraded) ? '部分检查降级（工具执行异常），见 checks 明细' : ''),
  }
}

export async function wbRead(args = {}, exec = null) {
  const action = String(args.action || '').trim()
  if (action === 'check') return checkAll()
  if (action === 'scene') {
    const sc = findScene(args.scene)
    if (!sc) return { ok: false, rule: 'PRT-012', hint: '找不到场景：' + String(args.scene || '(空)') }
    const id = String(sc.id)
    const dir = path.join(AGENTS, id)
    const summaryPath = path.join(dir, 'summary.md')
    const memory = listFiles(path.join(dir, 'memory'), { recursive: true, limit: 200 })
      .filter((f) => /\.md$/i.test(f)).sort().reverse().slice(0, 3)
      .map((f) => ({ path: path.relative(ROOT, f).split(path.sep).join('\\'), mtime: statInfo(f).mtime, head: readText(f).split(/\r?\n/).filter(Boolean).slice(0, 3).join(' / ').slice(0, 200) }))
    return {
      ok: true, action: 'scene', id, name: String(sc.name || id),
      card: readJson(path.join(dir, 'card.json'), null),
      summary: readText(summaryPath).slice(0, 4000),
      summaryPath: 'agents\\' + id + '\\summary.md',
      memory,
      sessions: Array.isArray(sc.sessions) ? sc.sessions : [],
    }
  }
  if (action === 'order') {
    const o = findOrder(args.id || args.orderId)
    if (!o) return { ok: false, rule: 'PRT-005', hint: '找不到协作单：' + String(args.id || args.orderId || '(空)') }
    const allEv = readEvents()
    const events = allEv.filter((e) => e && e.order_id === o.id).slice(-50)
    const fm = o.frontmatter || {}
    const flow = String(fm.flow || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
    const cur = String(fm.current_owner || fm.assignee || '')
    const ci = flow.indexOf(cur)
    const steps = flow.map((owner, i) => ({ owner, status: String(owner) === cur ? 'current' : (ci >= 0 && i < ci ? 'done' : 'todo') }))
    const timeline = events.map((e) => ({ ts: e.ts, type: e.type, from: e.from || '', to: e.to || '', note: String(e.note || e.task || '').slice(0, 200) }))
    return {
      ok: true, action: 'order', id: o.id, done: o.done,
      file: path.relative(ROOT, o.file).split(path.sep).join('\\'),
      frontmatter: fm, text: o.text.slice(0, 8000), events,
      current_owner: cur, flow, next: ci >= 0 ? (flow[ci + 1] || '') : '', steps, timeline,
      metrics: computeTiming(o, allEv),
    }
  }
  if (action === 'board') {
    const b = await boardData({ full: !!args.full })
    const me = String((callerScene(exec) || {}).id || args.scene || '')
    const events = readEvents()
    const outgoing = allOrders().filter((o) => me && String(o.frontmatter.dispatcher || '') === me).map((o) => {
      const fl = String(o.frontmatter.flow || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
      const cur = String(o.frontmatter.current_owner || o.frontmatter.assignee || '')
      const i = fl.indexOf(cur)
      return {
        id: o.id, assignee: String(o.frontmatter.assignee || ''), state: deriveStatus(o, events), done: o.done, file: 'collab/' + o.day + '/' + path.basename(o.file),
        current_owner: cur, flow: fl, next: i >= 0 ? (fl[i + 1] || '') : '',
      }
    })
    return { ok: true, action: 'board', ...b, outgoing }
  }
  if (action === 'search') {
    const r = search({ query: args.query, q: args.q, scope: args.scope, scene: args.scene, task_type: args.task_type, since: args.since, limit: args.limit })
    return { ok: true, action: 'search', ...r }
  }
  return { ok: false, rule: 'PRT-012', hint: 'action 只能是 check / scene / order / board / search（收到：' + (action || '空') + '）' }
}

export { allOrders, scenes }
