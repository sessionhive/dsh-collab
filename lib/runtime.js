/**
 * workbench-core · 插件入口
 *   host：注册 wb_read / wb_write 两个工具 + client/看板用的 HTTP 路由
 *   client：设置页「场景协作」（client\client.js，与同包 dsh.client.inject 一起加载）
 *
 * 路由前缀：/plugins/workbench-core
 *   GET  /board-data     看板 JSON（场景/协作/事件/预算/黑板/违规）
 *   GET  /board          看板 HTML（插件内置模板，写至 <dataRoot>\board\index.html）
 *   GET  /spike          client API spike 自证（settings.section + host 路由）
 *   GET  /global-rules   全局规则内容
 *   POST /global-rules   保存全局规则（≤32KB；保存后合成注入片段）
 *   GET  /scenes         已注册场景（含 card/summary/会话）
 *   POST /scene          新增/编辑场景协作配置（card.json + scenarios 条目 + gen-index）
 *   GET  /notice         催办开关（_meta\config.json notice）
 *   POST /notice         保存催办开关
 */
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  ROOT, TOOLS, SCENARIOS, AGENTS, CONFIG, GLOBAL_RULES, GLOBAL_INJECT, BOARD_HTML, BOARD_DIR,
  CONSTITUTION, DSH_HOME, HAS_GUI, REGISTRY,
} from './paths.js'
import { readText, readJson, writeAtomic, writeJson, ensureDir, exists, nowIso } from './store.js'
import { wbRead } from './tools/read.js'
import { wbWrite } from './tools/write.js'
import { writeParameters, writeDescription, READ_PARAMS } from './tools/schema.js'
import { consumeConfigNotice } from './card-version.js'
import { learnSummary, weeklyReport, revertAdjustment } from './learn.js'
import { dict } from './i18n.js'
import { identityCheck } from './identity.js'
import { boardData, boardHtml, BOARD_BUILTIN, ensureBoardPage } from './board.js'
import { readRules, scenes, findScene } from './rules.js'
import { runGenIndex, runRegistrySync } from './projection.js'
import { allOrders, deriveStatus, runCollabMaintenance } from './collab.js'
import { config } from './budget.js'
import { readGroups, writeGroups, renameGroup, deleteGroup, assignSceneToGroup } from './groups.js'
import { listWorkspaces } from './workspaces.js'
import { resolveCreateCwd } from './workspaces.js'
import { canWriteDir } from './doctor.js'
import { enginePortInfo, saveEnginePort, detectEnginePort } from './engine-port.js'
import { engineVersionInfo, profilePath, runtimeVersion, diskPluginVersion, versionCompare } from './diagnostics.js'
import { rebindScene, markOrphanedOrders, unbindScene, handoverPreview } from './handover.js'
import { setManualArchived, allArchivedSet, contextTokenMap } from './session-state.js'
import { archiveScene, restoreScene, deleteSceneToTrash, exportSceneSnapshot, lifecycleStats, moveSceneInGroup } from './lifecycle.js'
import { listSessions, createSession, configureSessions, promptSession } from './sessions.js'
import { ensureBootstrap } from './bootstrap.js'
import { migrateNoteNames } from './memory-index.js'
import { migrateAll, verifyManifest } from './migrate.js'
import { startAutoIndex, stopAutoIndex, runAutoIndex, autoIndexStatus } from './auto-index.js'
import { startInterruptWatch, stopInterruptWatch, interruptStatus } from './interrupt-watch.js'
import * as ops from './ops.js'
import { injectAgents, injectPreview } from './agents-inject.js'
import { ensureSceneSkill, launchSeedText } from './scene-pack.js'
import { buildEntrySeed } from './entry-seed.js'
import { appendSessionEvent } from './timeline.js'
import { runDoctor } from './doctor.js'
import { hashFile, writeJsonGuardedSync } from './concurrency.js'

// defineTool 来自引擎（@deepseek-ai/dsh-tools，宿主 profile 里可解析）。
// 离线单测（插件目录还没装进 profile、没有 node_modules）时退化成恒等函数，工具定义仍是纯对象 ⇒ 测试可跑。
let defineTool = (o) => o
try {
  const mod = await import('@deepseek-ai/dsh-tools')
  if (mod && typeof mod.defineTool === 'function') defineTool = mod.defineTool
} catch (e) { /* 离线/未装依赖：保持恒等 */ }

export const name = 'workbench-core'
export const inject = ['tools', 'webServer']

const MAX_RULES = 32 * 1024
const BASE = '/plugins/workbench-core'

function toolRender(_args, value) {
  let text = ''
  try { text = typeof value === 'string' ? value : JSON.stringify(value) } catch (e) { text = String(value) }
  return [{ type: 'text', text: String(text).slice(0, 6000) }]
}

/** 工具输出必须是 lossless JSON：递归去掉 undefined / NaN / 函数（引擎会校验） */
function jsonSafe(v) {
  try { return JSON.parse(JSON.stringify(v)) } catch (e) { return { ok: false, rule: 'INTERNAL', hint: '输出不是纯 JSON：' + String((e && e.message) || e) } }
}

const READ_TOOL = defineTool({
  name: 'wb_read',
  description: '只读：check/scene/order/board（含 outgoing）/search（query/scope/since/limit）。',
  parameters: READ_PARAMS,
  output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' } } }, render: toolRender },
  execute: async (args, exec) => jsonSafe({ ...(await wbRead(args, exec)), configNotice: consumeConfigNotice(exec) }),
})

const WRITE_TOOL = defineTool({
  name: 'wb_write',
  description: writeDescription(),
  parameters: writeParameters(),
  output: { schema: { type: 'object', additionalProperties: true, properties: { ok: { type: 'boolean' } } }, render: toolRender },
  execute: async (args, exec) => jsonSafe({ ...(await wbWrite(args, exec)), configNotice: consumeConfigNotice(exec) }),
})

// ---------------- HTTP（client 设置页 / 看板 / 壳面板共用） ----------------
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(obj))
}
function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => { buf += c; if (buf.length > 2 * 1024 * 1024) req.destroy() })
    req.on('end', () => resolve(buf))
    req.on('error', () => resolve(''))
  })
}
async function readJsonBody(req) {
  const raw = await readBody(req)
  try { return { ok: true, value: JSON.parse(raw || '{}') } } catch (e) { return { ok: false, error: 'body 不是合法 JSON' } }
}

function globalRulesInfo() {
  const text = readText(GLOBAL_RULES)
  const inject = readText(GLOBAL_INJECT)
  return {
    ok: true,
    path: GLOBAL_RULES,
    bytes: Buffer.byteLength(text, 'utf8'),
    maxBytes: MAX_RULES,
    text,
    injectPath: GLOBAL_INJECT,
    injectBytes: Buffer.byteLength(inject, 'utf8'),
    constitution: readRules().map((r) => ({ id: r.id, title: r.title })).slice(0, 40),
  }
}

function saveGlobalRules(text) {
  const t = String(text == null ? '' : text)
  const bytes = Buffer.byteLength(t, 'utf8')
  if (!t.trim()) return { ok: false, rule: 'PRT-009', hint: '全局规则不能为空（要清空请写一行说明）' }
  if (bytes > MAX_RULES) return { ok: false, rule: 'PRT-010', hint: '全局规则 ≤32KB（当前 ' + bytes + ' 字节）' }
  writeAtomic(GLOBAL_RULES, t.replace(/\s*$/, '\n'))
  // 注入片段：只把用户规则合成一个可被注入/读取的头部文件（不出现宪法/分层注释）
  const inject = [
    '<!-- 由 workbench-core 生成：源 shared\\env\\global-rules.md；仅对 registry 已注册场景生效 -->',
    '# 全局规则（用户可编辑 · 仅对 registry 已注册场景生效）',
    '',
    t.trim(),
    '',
  ].join('\n')
  writeAtomic(GLOBAL_INJECT, inject)
  return { ok: true, bytes: Buffer.byteLength(t, 'utf8'), injectBytes: Buffer.byteLength(inject, 'utf8'), path: GLOBAL_RULES, injectPath: GLOBAL_INJECT, at: nowIso() }
}

function sceneRows() {
  return scenes().map((s) => {
    const id = String(s.id)
    const card = readJson(path.join(AGENTS, id, 'card.json'), null)
    const summary = readText(path.join(AGENTS, id, 'summary.md'))
    return {
      id, name: String(s.name || id), skill: String(s.skill || ''),
      lifecycle: String(s.lifecycle || ''), archivedAt: String(s.archivedAt || ''), lastGroup: String(s.lastGroup || ''),
      cardPath: path.join(AGENTS, id, 'card.json'), cwd: String(s.cwd || ''),
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
      panels: Array.isArray(s.panels) ? s.panels : [],
      card, summaryBytes: Buffer.byteLength(summary, 'utf8'), summaryHead: summary.split(/\r?\n/).filter(Boolean).slice(0, 8).join('\n'),
      memoryRoot: 'agents\\' + id + '\\',
    }
  })
}

function upsertScene(body) {
  const id = String(body.id || '').trim()
  const name = String(body.name || '').trim() || id
  const sessionId = String(body.sessionId || '').trim()
  const role = String(body.role || '').trim()
  const notRole = String(body.notRole || '').trim()
  // 技能多选（dh029）：skills[] 数组；旧客户端只传 skill 单值也兼容
  const skillList = (Array.isArray(body.skills) ? body.skills : (body.skill ? [body.skill] : []))
    .map((x) => String(x || '').trim()).filter(Boolean)
  const skill = skillList[0] || id
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(id)) return { ok: false, rule: 'PRT-012', hint: '协作 id 只能小写字母/数字/连字符（2~32 位）' }
  if (!name) return { ok: false, rule: 'PRT-012', hint: '会话名称不能为空' }
  if (!sessionId) return { ok: false, rule: 'PRT-012', hint: 'sessionId 不能为空（先选/填一个会话）' }
  const hasGui = HAS_GUI && exists(path.join(SCENARIOS))
  const scenFile = hasGui ? path.join(SCENARIOS, id + '.json') : null
  const existed = hasGui ? exists(scenFile) : scenes().some((s) => String(s.id) === id)
  if (existed && !body.confirm) return { ok: false, needConfirm: true, hint: '协作会话已存在：' + id + '（确认要覆盖请带 confirm:true）' }
  const cardFile = path.join(AGENTS, id, 'card.json')
  const oldCard = readJson(cardFile, null) || { schemaVersion: 1, id, name, panels: [], sessions: [], mission: '', responsibilities: [], boundaries: [], skills: [skill], memoryRoot: 'agents/' + id }
  const card = { ...oldCard, id, name, memoryRoot: 'agents/' + id, mission: role || oldCard.mission, responsibilities: role ? [role] : (oldCard.responsibilities || []) }
  card.card_version = (Number(card.card_version) || 0) + 1
  card.updated_at = nowIso()
  if (notRole) card.boundaries = ['我不负责：' + notRole]
  if (skillList.length) card.skills = Array.from(new Set(skillList))
  else if (!Array.isArray(card.skills) || !card.skills.length) card.skills = [skill]
  ensureDir(path.dirname(cardFile))
  writeJson(cardFile, card)
  // v0.3.2：任何新建/编辑都确保基础 SKILL 存在且非空（未选技能也自动创建）
  let skillPack = null
  const skillCreated = []
  try { skillPack = ensureSceneSkill({ id, name, mission: String(card.mission || role || '') }) } catch (e) { skillPack = { ok: false, error: String((e && e.message) || e) } }
  for (const sid of (Array.isArray(card.skills) ? card.skills : [])) {
    try {
      const rr = ensureSceneSkill({ id: String(sid), name: String(sid), mission: String(card.mission || '') })
      if (rr && rr.existed === false) skillCreated.push(String(sid))
    } catch (e) { /* ignore */ }
  }
  let scen = null
  if (hasGui) {
    if (!existed) {
      scen = {
        id, name, description: role.slice(0, 160), cols: 4, theme: 'dark',
        panels: [
          { id: 'preview-' + id.slice(0, 12), title: '预览', type: 'view', col: 1, row: 1, w: 2, h: 4 },
          { id: id.slice(0, 16) + '-ai', title: 'AI·' + name, type: 'harness', sessionTitle: body.sessionTitleActual || name, sessionId, pinTarget: [name], col: 3, row: 1, w: 2, h: 4 },
        ],
      }
      writeJson(scenFile, scen)
    } else {
      scen = readJson(scenFile, null)
    }
  } else {
    // 无外壳：场景真源 = _meta\registry.json（scenes 直接写 registry，不写 scenarios json）
    try {
      scen = upsertRegistryScene({ id, name, role, sessionId, skill, sessionTitle: body.sessionTitleActual || name })
    } catch (e) {
      if (e && e.concurrent) return { ok: false, concurrent: true, rule: 'PRT-016', hint: e.message }
      throw e
    }
  }
  if (!exists(path.join(AGENTS, id, 'summary.md'))) {
    writeAtomic(path.join(AGENTS, id, 'summary.md'), '# ' + name + ' · 当前状态\n\n## 在做\n- 空闲\n\n## 下一步\n- 待派活\n\n## 卡点\n- 无\n\n## 指针\n- 最后更新：' + nowIso().slice(0, 10) + '\n- 详情：`agents\\' + id + '\\memory\\' + nowIso().slice(0, 10) + '\\`\n')
  }
  const gen = runRegistrySync()
  return { ok: true, id, name, existed, hasGui, scenario: hasGui ? '外壳\\scenarios\\' + id + '.json' : null, card: 'agents\\' + id + '\\card.json', genIndex: gen, skillPack, skillCreated, cardVersion: card.card_version, skillId: (Array.isArray(card.skills) && card.skills[0]) || id, skills: card.skills || [] }
}

/** 无外壳环境：直接 upsert registry.scenes（保持 registry 为场景真源） */
function upsertRegistryScene({ id, name, role, sessionId, skill, sessionTitle }) {
  const regHash = hashFile(REGISTRY)
  const reg = readJson(REGISTRY, {}) || {}
  const arr = Array.isArray(reg.scenes) ? reg.scenes.slice() : []
  const idx = arr.findIndex((s) => String(s.id) === id)
  const old = idx >= 0 ? arr[idx] : {}
  const aiPanel = id.slice(0, 16) + '-ai'
  const row = {
    ...old,
    id,
    name,
    json: null,
    panels: [
      { panelId: 'preview-' + id.slice(0, 12), type: 'view', title: '预览' },
      { panelId: aiPanel, type: 'harness', title: 'AI·' + name },
    ],
    memoryRoot: 'agents/' + id,
    summary: 'agents/' + id + '/summary.md',
    sessions: [{ panelId: aiPanel, sessionId, title: sessionTitle }],
    skill,
    contextCard: null,
    area: old.area || null,
  }
  if (idx >= 0) arr[idx] = row; else arr.push(row)
  reg.scenes = arr
  if (!Array.isArray(reg.groups)) reg.groups = []
  // dh046：写前比对 registry hash，被外部改动则取消写入并提示（不静默覆盖）
  const w = writeJsonGuardedSync(REGISTRY, reg, { expectedHash: regHash, reason: 'scene:' + id })
  if (!w.ok) {
    const err = new Error(w.reason)
    err.concurrent = true
    err.rule = 'PRT-016'
    throw err
  }
  return row
}

function configNotice() {
  const cfg = config()
  return { ok: true, path: CONFIG, notice: cfg.notice, handover: cfg.handover, budget: cfg.budget }
}

/** 允许从设置页打开的只读入口（白名单） */
const OPEN_ALLOW = {
  constitution: CONSTITUTION,
  constitutionDoc: path.join(ROOT, '说明', '宪法.md'),
  globalRules: GLOBAL_RULES,
  config: CONFIG,
  dataDir: DSH_HOME,
}
function openTarget(t) {
  const p = OPEN_ALLOW[String(t || '')]
  if (!p) return { ok: false, rule: 'PRT-009', hint: '不允许打开：' + (t || '(空)') }
  if (!exists(p)) return { ok: false, hint: '路径不存在：' + p }
  try {
    if (fs.statSync(p).isDirectory()) spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref()
    else spawn('cmd.exe', ['/c', 'start', '', p], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return { ok: true, target: String(t), path: p }
  } catch (e) {
    return { ok: false, hint: '打开失败：' + String((e && e.message) || e) }
  }
}

const SKILLS_DIR = path.join(DSH_HOME, 'skills')
const SKILL_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const SKILL_MAX = 16 * 1024
function skillFile(id) { return path.join(SKILLS_DIR, id, 'SKILL.md') }
function skillInfo(id) {
  const p = skillFile(id)
  const st = exists(p) ? fs.statSync(p) : null
  return { id, path: p, exists: !!st, bytes: st ? st.size : 0, mtime: st ? Math.floor(st.mtimeMs / 1000) : 0, text: st ? readText(p) : '' }
}
function skillTemplate(id) {
  return ['---', 'name: ' + id, 'description: 一句话：这个技能干什么（含触发词）', '---', '', '# ' + id, '',
    '## 什么时候用', '', '（写：什么场景/用户说什么话时，该用这个技能）', '',
    '## 怎么做', '', '（写：步骤或要点，给以后的自己看）', '',
    '## 交付标准', '', '（写：做出什么算完成——文件 / 命令 / 证据路径）', '',
    '## 注意', '', '（写：坑、约束；没有可删）', ''].join('\n')
}
function saveSkill(id, text, create) {
  const sid = String(id || '').trim().replace(/^\uFEFF/, '')
  if (!SKILL_ID_RE.test(sid)) return { ok: false, rule: 'PRT-012', hint: '技能 id 只能小写字母/数字/连字符（1~32 位）' }
  const p = skillFile(sid)
  const st = exists(p) ? fs.statSync(p) : null
  if (create && st) return { ok: false, rule: 'PRT-012', hint: '技能已存在：' + sid }
  let body = String(text == null ? (create ? skillTemplate(sid) : '') : text).replace(/^\uFEFF/, '')
  if (!body.trim()) return { ok: false, rule: 'BND-002', hint: '技能内容不能为空' }
  if (body.indexOf('\u0000') >= 0) return { ok: false, rule: 'BND-002', hint: '技能内容含非法空字符' }
  const bytes = Buffer.byteLength(body, 'utf8')
  if (bytes > SKILL_MAX) return { ok: false, rule: 'BND-002', hint: '技能超过 16KB（' + bytes + ' 字节），请删减' }
  ensureDir(path.dirname(p))
  try { writeAtomic(p, body) } catch (e) { return { ok: false, rule: 'PRT-014', hint: '技能写入失败：' + String((e && e.message) || e) } }
  return { ok: true, ...skillInfo(sid), created: !!create && !st }
}
function pluginInfo() {
  let pkg = {}
  try { pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) } catch (e) { pkg = {} }
  const eng = engineVersionInfo()
  const vc = versionCompare()
  let libMtime = 0
  try { libMtime = Math.floor(fs.statSync(fileURLToPath(import.meta.url)).mtimeMs / 1000) } catch (e) { libMtime = 0 }
  return {
    ok: true,
    plugin: { name: pkg.name || '@sessionhive/dsh-collab', version: runtimeVersion() || pkg.version || '0.0.0', diskVersion: diskPluginVersion(), path: fileURLToPath(new URL('../', import.meta.url)), stale: vc.stale },
    engine: { dir: path.join(ROOT, '引擎'), version: eng.version, versionReason: eng.reason || '', versionSource: eng.source || '' },
    profile: profilePath(),
    mount: '@sessionhive/dsh-collab',
    libMtime,
    upgradeRequired: !!vc.stale,
    upgradeHint: vc.stale ? '插件已更新，需重启加载新版本（运行 ' + (runtimeVersion() || '?') + ' / 磁盘 ' + (diskPluginVersion() || '?') + '）' : '',
    manifest: verifyManifest(),
  }
}

function saveNotice(body) {
  const cur = readJson(CONFIG, {}) || {}
  const notice = { ...(cur.notice || { enabled: false, minutes: 20 }) }
  if (typeof body.enabled === 'boolean') notice.enabled = body.enabled
  if (body.minutes != null) {
    const m = Number(body.minutes)
    if (!Number.isFinite(m) || m < 1 || m > 1440) return { ok: false, rule: 'PRT-012', hint: 'minutes 取 1~1440（分钟）' }
    notice.minutes = Math.round(m)
  }
  const next = { ...cur, notice }
  writeJson(CONFIG, next)
  return { ok: true, notice, path: CONFIG }
}

async function handle(req, res) {
  const u = new URL(req.url || '/', 'http://x')
  const p = u.pathname
  const method = (req.method || 'GET').toUpperCase()
  if (p === BASE + '/board' && method === 'GET') {
    const html = boardHtml()
    if (!html) return sendJson(res, 404, { ok: false, error: '插件内置看板模板读取失败：' + BOARD_BUILTIN })
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(html)
  }
  if (p === BASE + '/board-data' && method === 'GET') return sendJson(res, 200, await boardData({ full: u.searchParams.get('full') === '1' }))
  if (p === BASE + '/spike' && method === 'GET') {
    return sendJson(res, 200, {
      ok: true,
      clientApi: 'settings.section（client 插件 ctx.slots.inject("settings.section")）',
      hostComm: 'webServer 前缀路由 + fetch（与 插件\\启动动画 同一套已运行 API）',
      precedent: '插件\\启动动画 v1.1.0：settings.section 标签 + /plugins/boot-anim/* 路由',
      sections: ['global-rules', 'scenes', 'notice'],
      evidence: { boardHtml: BOARD_BUILTIN, routes: [BASE + '/board-data', BASE + '/global-rules', BASE + '/scenes', BASE + '/notice'] },
    })
  }
  if (p === BASE + '/global-rules' && method === 'GET') return sendJson(res, 200, globalRulesInfo())
  if (p === BASE + '/global-rules' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = saveGlobalRules(b.value.text)
    if (r.ok) { try { r.inject = injectAgents('rules') } catch (e) { r.inject = { ok: false, error: String((e && e.message) || e) } } }
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/inject/preview' && method === 'GET') {
    return sendJson(res, 200, injectPreview())
  }
  if (p === BASE + '/doctor' && method === 'GET') {
    return sendJson(res, 200, runDoctor())
  }
  if (p === BASE + '/ops/engine-port' && method === 'GET') {
    return sendJson(res, 200, enginePortInfo())
  }
  if (p === BASE + '/ops/engine-port' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    if (v.auto) {
      const d = await detectEnginePort()
      if (!d.ok) return sendJson(res, 200, { ok: false, ...d })
      const s = saveEnginePort(d.port, { expectedHash: v.expectedHash })
      if (s.ok) { try { s.board = ensureBoardPage(d.port) } catch (e) { s.board = { ok: false } } }
      return sendJson(res, s.ok ? 200 : 400, { ...s, detected: d.port, candidates: d.candidates, root: d.root })
    }
    const s = saveEnginePort(v.port, { expectedHash: v.expectedHash })
    if (s.ok) { try { s.board = ensureBoardPage(v.port) } catch (e) { s.board = { ok: false } } }
    return sendJson(res, s.ok ? 200 : 400, s)
  }
  if (p === BASE + '/scenes' && method === 'GET') {
    const g = readGroups()
    const ctxMap = await contextTokenMap()
    const arch = allArchivedSet()
    const cfg = config()
    const warnT = Number(cfg.handover && cfg.handover.warnContextTokens) || 60000
    const thT = Number(cfg.handover && cfg.handover.contextThresholdTokens) || 120000
    const rows = sceneRows().map((row) => {
      const sid = Array.isArray(row.sessions) && row.sessions[0] ? String(row.sessions[0].sessionId || '') : ''
      const ct = sid && ctxMap[sid] != null ? ctxMap[sid] : null
      const lifeArchived = String(row.lifecycle) === 'archived'
      const sessionArchived = !!sid && arch.has(sid)
      const archived = lifeArchived
      const state = lifeArchived ? 'archived' : (sid ? 'active' : 'pending')
      return {
        ...row, sessionId: sid, archived, sessionArchived, state,
        contextTokens: ct, warnContextTokens: warnT, contextThresholdTokens: thT,
        pressure: ct == null ? 'unknown' : (ct >= thT ? 'fail' : (ct >= warnT ? 'warn' : 'ok')),
      }
    })
    const archivedScenes = new Set(rows.filter((x) => x.archived).map((x) => String(x.id)))
    return sendJson(res, 200, {
      ok: true,
      scenes: rows,
      lifecycle: lifecycleStats(),
      orders: allOrders().filter((o) => !o.done).map((o) => ({ id: o.id, assignee: o.frontmatter.assignee || '', status: deriveStatus(o), orphaned: archivedScenes.has(String(o.frontmatter.assignee || '')) })),
      groups: g.groups, sceneGroup: g.sceneGroup, ungrouped: g.ungrouped,
    })
  }
  if (p === BASE + '/scene' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const body = b.value || {}
    // 已存在场景需确认时，先别建会话（避免"确认前就多一条空会话"）
    const preId = String(body.id || '').trim()
    const preFile = path.join(SCENARIOS, preId + '.json')
    const preExists = HAS_GUI ? exists(preFile) : scenes().some((s) => String(s.id) === preId)
    if (preExists && !body.confirm) {
      return sendJson(res, 400, { ok: false, needConfirm: true, hint: '协作会话已存在：' + preId + '（确认要覆盖请带 confirm:true）' })
    }
    // ④ sessionId 不手填：sessionMode='new' 自动建会话；'pick' 用 /sessions 的 unbound 选择
    if (body.sessionId) {
      // 绑定已有会话时，面板的 sessionTitle 必须用**会话真实标题**（否则 check-gui 的 sessions.mjs 会报"切错会话"）
      try {
        const lr = await listSessions()
        const list = lr.items || []
        const hit = list.find((x) => x.sessionId === String(body.sessionId))
        if (hit && hit.title) body.sessionTitleActual = hit.title
      } catch (e) { /* 引擎不可达就退回场景名 */ }
    }
    if (!String(body.sessionId || '').trim() && String(body.sessionMode || '') === 'new') {
      const title = String(body.sessionTitle || body.name || body.id || '').trim() || '新场景'
      // dh046：新建前校验目标工作区可写（不可写明确提示换一个）
      const cwdTarget = resolveCreateCwd({ cwd: body.cwd, workspaceId: body.workspaceId })
      const wr = canWriteDir(cwdTarget.cwd)
      if (!wr.ok) return sendJson(res, 400, { ok: false, rule: 'PRT-015', hint: '目标工作区不可写：' + wr.reason + '；请换一个工作区（或修目录权限）后重试', cwd: cwdTarget.cwd, cwdSource: cwdTarget.source, doctor: true })
      // dh043：可选工作区（cwd=工作区）；无选择走 config.defaultCwd → 旧行为
      // dh044：seed 延后到场景创建后，用启动包文案（先读 card/summary + 核心规则）
      const cr = await createSession({ title, cwd: body.cwd, workspaceId: body.workspaceId, seed: false })
      if (!cr.ok) return sendJson(res, 400, { ok: false, rule: 'PRT-012', hint: '自动新建会话失败：' + cr.error, sessionMode: 'new', cwdSource: cr.cwdSource || '' })
      body.sessionId = cr.sessionId
      body.sessionTitleActual = cr.title || title
      body.autoSession = cr
    }
    const r = upsertScene(body)
    if (r.ok && body.autoSession) {
      // dh044：启动包（技能 + seed 文案）
      const pack = ensureSceneSkill({ id: r.id, name: r.name, mission: String(body.role || '') })
      r.skillPack = pack
      if (!pack.existed) r.skill = 'skills\\' + r.id + '\\SKILL.md'
      if (body.autoSession.ok !== false && body.autoSession.sessionId) {
        const es = buildEntrySeed(r.id)
        const seed = await promptSession(body.autoSession.sessionId, es.ok ? es.text : launchSeedText({ id: r.id, name: r.name, mission: String(body.role || '') }))
        body.autoSession.seeded = !!seed.ok
        body.autoSession.seedMethod = seed.ok ? 'entry-seed' : (seed.degraded ? 'unavailable' : 'failed')
        body.autoSession.seedError = seed.ok ? '' : (seed.reason || '')
        try { appendSessionEvent(r.id, 'entry', { from: 'plugin', to: body.autoSession.sessionId, reason: 'bind new', note: 'entry seed' }) } catch (e) { /* ignore */ }
      }
      r.autoSession = body.autoSession
    }
    if (r.ok && body.sessionId && !body.autoSession && !r.existed) {
      // 选已有会话也必须发入场 seed（强制，无配置）
      try {
        const es = buildEntrySeed(r.id)
        const seed = await promptSession(body.sessionId, es.ok ? es.text : '')
        r.seed = { attempted: true, ok: !!seed.ok, degraded: !!seed.degraded, hint: seed.reason || '' }
        appendSessionEvent(r.id, 'entry', { from: 'plugin', to: body.sessionId, reason: 'bind pick', note: 'entry seed' })
      } catch (e) { r.seed = { attempted: true, ok: false, hint: String((e && e.message) || e) } }
    }
    if (r.ok && !r.existed && String(body.groupId || '').trim()) {
      const g = assignSceneToGroup(r.id, String(body.groupId).trim())
      if (g.ok) r.group = { ...g }
    }
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/workspaces' && method === 'GET') {
    return sendJson(res, 200, listWorkspaces())
  }
  if (p === BASE + '/sessions' && method === 'GET') {
    try {
      const listRes = await listSessions()
      const items = (listRes.items || []).slice()
      const bound = {}
      for (const s of scenes()) for (const ss of (Array.isArray(s.sessions) ? s.sessions : [])) bound[String(ss.sessionId)] = String(s.id)
      const rows = items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 300).map((x) => ({ ...x, boundSceneId: bound[x.sessionId] || '', archived: allArchivedSet().has(String(x.sessionId)) }))
      return sendJson(res, 200, {
        ok: listRes.ok !== false,
        source: listRes.source || 'none',
        sessionError: listRes.reason || '',
        sessions: rows, bound: rows.filter((x) => x.boundSceneId), unbound: rows.filter((x) => !x.boundSceneId),
      })
    } catch (e) {
      return sendJson(res, 200, { ok: false, source: 'none', sessionError: String((e && e.message) || e), sessions: [], bound: [], unbound: [] })
    }
  }
  if (p === BASE + '/sessions/archive' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = await setManualArchived(b.value && b.value.sessionId, !!(b.value && b.value.archived))
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/rebind' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = await rebindScene(b.value || {})
    if (r.ok) {
      try { appendSessionEvent(r.sceneId, 'handover', { from: r.oldSessionId, to: r.newSessionId, reason: 'archived' }) } catch (e) { /* ignore */ }
      try { appendSessionEvent(r.sceneId, 'entry', { from: 'plugin', to: r.newSessionId, reason: 'handover', note: 'handover seed' }) } catch (e) { /* ignore */ }
    }
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/unbind' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = unbindScene(b.value && b.value.id)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/archive' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = archiveScene(b.value && b.value.id)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/restore' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = restoreScene(b.value && b.value.id)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/delete' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = deleteSceneToTrash(b.value && b.value.id, !!(b.value && b.value.confirm))
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/export' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = exportSceneSnapshot(b.value && b.value.id)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/handover-preview' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = handoverPreview(b.value && b.value.id)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/scene/order' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = moveSceneInGroup(b.value && b.value.id, b.value && b.value.groupId, b.value && b.value.index)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/orphaned' && method === 'GET') {
    const r = await markOrphanedOrders()
    return sendJson(res, 200, r)
  }
  if (p === BASE + '/session/create' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const cr = await createSession(String((b.value && b.value.title) || '').trim())
    return sendJson(res, cr.ok ? 200 : 400, cr)
  }
  if (p === BASE + '/skills' && method === 'GET') {
    let dirs = []
    try { dirs = fs.readdirSync(path.join(DSH_HOME, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && d.name[0] !== '_').map((d) => d.name).sort() } catch (e) { dirs = [] }
    const skills = dirs.map((id) => {
      const f = path.join(DSH_HOME, 'skills', id, 'SKILL.md')
      const st = exists(f) ? fs.statSync(f) : null
      return { id, hasSkillMd: !!st, bytes: st ? st.size : 0, mtime: st ? Math.floor(st.mtimeMs / 1000) : 0 }
    })
    return sendJson(res, 200, { ok: true, skills })
  }
  if (p === BASE + '/skill' && method === 'GET') {
    const id = String(u.searchParams.get('id') || '')
    if (!SKILL_ID_RE.test(id)) return sendJson(res, 400, { ok: false, rule: 'PRT-012', hint: '技能 id 不合法' })
    return sendJson(res, 200, { ok: true, ...skillInfo(id), maxBytes: SKILL_MAX })
  }
  if (p === BASE + '/skill' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    const r = saveSkill(String(v.id || v.name || ''), v.text, !!v.create)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/rebuild-index' && method === 'POST') {
    const r = runRegistrySync()
    return sendJson(res, r.ok ? 200 : 500, r)
  }
  if (p === BASE + '/plugin-info' && method === 'GET') return sendJson(res, 200, pluginInfo())
  if (p === BASE + '/interrupt-status' && method === 'GET') return sendJson(res, 200, interruptStatus())
  if (p === BASE + '/auto-index-status' && method === 'GET') return sendJson(res, 200, { ok: true, ...autoIndexStatus() })
  // ---- 「其他设置」v6：运维 / 预算 / 清理（dh039） ----
  if (p === BASE + '/ops/info' && method === 'GET') return sendJson(res, 200, ops.opsInfo())
  if (p === BASE + '/ops/selfcheck' && method === 'POST') {
    const r = await ops.selfCheck()
    return sendJson(res, 200, r)
  }
  if (p === BASE + '/ops/open' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = ops.openTarget2(String((b.value && b.value.target) || ''), String((b.value && b.value.path) || ''))
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/trash' && method === 'GET') return sendJson(res, 200, ops.trashInfo())
  if (p === BASE + '/ops/trash/clear' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = ops.clearTrash(b.value && b.value.confirm)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/trash/delete' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = ops.deleteTrash(b.value && b.value.names)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/identity-check' && method === 'GET') return sendJson(res, 200, identityCheck())
  if (p.split('?')[0] === BASE + '/i18n' && method === 'GET') {
    const lang = u.searchParams.get('lang') || ''
    return sendJson(res, 200, { ok: true, ...dict(lang) })
  }
  if (p === BASE + '/learn/summary' && method === 'GET') return sendJson(res, 200, learnSummary())
  if (p === BASE + '/learn/report' && method === 'GET') return sendJson(res, 200, weeklyReport())
  if (p === BASE + '/learn/revert' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = revertAdjustment(b.value && b.value.id)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/learn/feedback' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    const verdict = String(v.verdict || '').trim()
    if (!['smooth', 'stuck', 'issue'].includes(verdict)) return sendJson(res, 400, { ok: false, hint: 'verdict 只能是 smooth/stuck/issue' })
    await (await import('./events.js')).logEvent({ type: 'feedback', order_id: String(v.orderId || ''), from: String(v.from || 'ui'), verdict, note: String(v.note || '') })
    return sendJson(res, 200, { ok: true, verdict })
  }
  if (p === BASE + '/ops/open-item' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    const out = ops.openItem(String(v.kind || ''), String(v.name || ''), String(v.action || 'file'))
    return sendJson(res, out.ok ? 200 : 400, out)
  }
  if (p === BASE + '/ops/backups' && method === 'GET') return sendJson(res, 200, ops.backupsInfo())
  if (p === BASE + '/ops/backups/delete' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    const r = ops.deleteBackups(v.names, !!v.confirm)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/events' && method === 'GET') return sendJson(res, 200, ops.eventsInfo())
  if (p === BASE + '/ops/events/trim' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    const r = ops.trimEvents(v.keep, !!v.confirm)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/events/delete' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    const r = ops.deleteEventsSelected(v.lines, !!v.confirm)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/temp' && method === 'GET') return sendJson(res, 200, ops.tempInfo())
  if (p === BASE + '/ops/temp/clean' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = ops.cleanTemp(!!(b.value && b.value.confirm), b.value && b.value.names)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/config/ui' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = ops.saveUiConfig(b.value || {})
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/config' && method === 'GET') return sendJson(res, 200, ops.configInfo())
  if (p === BASE + '/ops/budget' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = ops.saveBudget(b.value || {})
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/ops/token' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = ops.saveToken(b.value || {})
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/groups' && method === 'GET') return sendJson(res, 200, { ok: true, ...readGroups() })
  if (p === BASE + '/groups' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const v = b.value || {}
    // dh043：支持 action=rename / delete；无 action 时维持整表覆盖（兼容）
    if (v.action === 'rename') {
      const r = renameGroup(v.id, { name: v.name, note: v.note })
      return sendJson(res, r.ok ? 200 : 400, r)
    }
    if (v.action === 'delete') {
      const r = deleteGroup(v.id)
      return sendJson(res, r.ok ? 200 : 400, r)
    }
    const r = writeGroups(v.groups)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/open' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = openTarget(String((b.value && b.value.target) || ''))
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  if (p === BASE + '/notice' && method === 'GET') return sendJson(res, 200, configNotice())
  if (p === BASE + '/notice' && method === 'POST') {
    const b = await readJsonBody(req)
    if (!b.ok) return sendJson(res, 400, b)
    const r = saveNotice(b.value)
    return sendJson(res, r.ok ? 200 : 400, r)
  }
  return sendJson(res, 404, { ok: false, error: '未知路径：' + p })
}

export async function install(ctx, config) {
  try { configureSessions(ctx, config) } catch (e) { /* 无 host ctx 时降级 */ }
  try { ensureBootstrap() } catch (e) { /* 自举失败不阻断插件加载（外部环境只读时可继续只读使用） */ }
    try { migrateNoteNames() } catch (e) { /* 记忆改名幂等失败不阻断 */ }
    try { migrateAll() } catch (e) { /* schema 迁移失败不阻断加载 */ }
  try { injectAgents('startup') } catch (e) { /* 核心宪法注入失败不阻断插件 */ }
  try { runDoctor() } catch (e) { /* 启动预检失败不阻断插件 */ }
  try { markOrphanedOrders() } catch (e) { /* orphaned 标记失败不阻断 */ }
  try { runCollabMaintenance().catch(() => {}) } catch (e) { /* v2 stale/心跳失败不阻断 */ }
  try { startAutoIndex() } catch (e) { /* 自动索引失败不阻断插件加载 */ }
  try { startInterruptWatch(ctx) } catch (e) { /* 中断监听失败不阻断插件加载 */ }
  if (ctx && typeof ctx.effect === 'function') {
    try { ctx.effect(() => () => { stopAutoIndex(); stopInterruptWatch() }) } catch (e) { /* ignore */ }
  }
  ctx.tools.register(READ_TOOL)
  ctx.tools.register(WRITE_TOOL)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: BASE, handler: handle }))
}

export { READ_TOOL, WRITE_TOOL }
