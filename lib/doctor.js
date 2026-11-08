/**
 * doctor.js —— 启动预检 / GET /doctor（dh046）。
 *   逐项返回 ok|warn|fail：dataRoot / 工作区 cwd 可写性 / 必需目录 / config / 版本 / 注入状态。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, DSH_HOME, AGENTS, COLLAB, BLACKBOARD, SHARED, EVENTS_DIR, META, CONFIG, REGISTRY } from './paths.js'
import { exists, readJson } from './store.js'
import { listWorkspaces, resolveCreateCwd } from './workspaces.js'
import { injectPreview } from './agents-inject.js'
import { versionCompare } from './diagnostics.js'

const PKG = fileURLToPath(new URL('../package.json', import.meta.url))

function pkgVersion() {
  try { return String((JSON.parse(fs.readFileSync(PKG, 'utf8')) || {}).version || '') } catch (e) { return '' }
}

/** 目录可写性（写一个探针文件再删；不存在=不可写） */
export function canWriteDir(dir) {
  const d = String(dir || '').trim()
  if (!d) return { ok: false, reason: '目录为空' }
  try {
    if (!fs.statSync(d).isDirectory()) return { ok: false, reason: '不是目录：' + d }
  } catch (e) { return { ok: false, reason: '目录不存在：' + d } }
  const probe = path.join(d, '.wb-doctor-probe-' + process.pid + '-' + Date.now())
  try {
    fs.writeFileSync(probe, 'ok', 'utf8')
    fs.unlinkSync(probe)
    return { ok: true }
  } catch (e) {
    try { fs.unlinkSync(probe) } catch (e2) { /* ignore */ }
    return { ok: false, reason: '不可写：' + d + '（' + String((e && e.code) || (e && e.message) || e) + '）' }
  }
}

function item(name, status, detail, extra = {}) { return { name, status, detail: String(detail || '').slice(0, 240), ...extra } }

export function runDoctor() {
  const checks = []
  // 1) 数据根
  const dr = canWriteDir(DSH_HOME)
  checks.push(item('dataRoot', dr.ok ? 'ok' : 'fail', dr.ok ? DSH_HOME : (dr.reason + ' · ' + DSH_HOME), { path: DSH_HOME }))
  // 2) 工作区 cwd 可写性（默认 cwd + 已注册工作区各检查前 3 个）
  const ws = listWorkspaces()
  const target = resolveCreateCwd({})
  const cwds = []
  if (target.cwd) cwds.push({ label: '默认 cwd', path: target.cwd, source: target.source })
  for (const w of (ws.workspaces || []).slice(0, 3)) cwds.push({ label: '工作区 ' + (w.title || w.id), path: w.path, source: 'workspace' })
  if (!cwds.length) checks.push(item('工作区 cwd', 'warn', '没有可用的工作区/默认 cwd（新建会话会退回 ' + target.cwd + '）'))
  else {
    const results = cwds.map((c) => ({ ...c, r: canWriteDir(c.path) }))
    const bad = results.filter((x) => !x.r.ok)
    const hasWorkspace = results.some((x) => x.source === 'workspace')
    const status = bad.length === 0 ? 'ok' : (hasWorkspace ? (bad.length === results.length ? 'fail' : 'warn') : 'warn')
    checks.push(item('工作区 cwd', status,
      results.map((x) => x.label + '：' + (x.r.ok ? '可写' : x.r.reason)).join('；') + (bad.length && !hasWorkspace ? '（外部可先选/建工作区再新建会话）' : ''), { cwds: results.map((x) => ({ label: x.label, path: x.path, ok: x.r.ok })) }))
  }
  // 3) 必需目录
  const dirs = [AGENTS, COLLAB, BLACKBOARD, SHARED, path.join(SHARED, 'env'), EVENTS_DIR, META, path.join(DSH_HOME, 'constitution', 'current')]
  const miss = dirs.filter((d) => !exists(d))
  checks.push(item('必需目录', miss.length ? 'fail' : 'ok', miss.length ? '缺：' + miss.join('、') : 'agents/collab/blackboard/shared/env/events/_meta/constitution 齐全', { dirs }))
  // 4) config
  let cfg = null
  try { cfg = readJson(CONFIG, null) } catch (e) { cfg = null }
  const cfgOk = !!cfg && typeof cfg === 'object'
  checks.push(item('config.json', cfgOk ? 'ok' : 'fail', cfgOk ? ('可读 · inject=' + String(cfg.inject || 'auto') + ' · seedOnCreate=' + (cfg.seedOnCreate !== false)) : '缺失或不是合法 JSON', { path: CONFIG }))
  // 5) registry
  let regOk = false
  try { const reg = readJson(REGISTRY, null); regOk = !!reg && typeof reg === 'object' && Array.isArray(reg.scenes) } catch (e) { regOk = false }
  checks.push(item('registry.json', regOk ? 'ok' : 'fail', regOk ? ('可读 · 场景 ' + readJson(REGISTRY, {}).scenes.length + ' 个') : '缺失/不是合法 JSON/无 scenes 数组', { path: REGISTRY }))
  // 6) 版本
  const v = pkgVersion()
  checks.push(item('插件版本', v ? 'ok' : 'warn', v || '读不到 package.json version', { version: v }))
  // 6b) 运行内存版本 vs 磁盘 package.json（热替换后能辨出代码旧）
  const vc = versionCompare()
  checks.push(item('版本一致性（运行 vs 磁盘）', vc.same ? 'ok' : 'warn',
    '运行 ' + (vc.runtime || 'unknown') + ' / 磁盘 ' + (vc.disk || 'unknown') + (vc.stale ? '（不一致：代码旧/热替换后需重载）' : ''),
    { runtime: vc.runtime, disk: vc.disk, stale: vc.stale }))
  // 7) 注入状态
  try {
    const pv = injectPreview()
    const st = pv.mode === 'on' ? (pv.injected ? 'ok' : 'warn') : 'ok'
    checks.push(item('注入状态', st, '模式=' + pv.mode + ' · 已注入=' + (pv.injected ? '是' : '否') + ' · ' + (pv.note || ''), { mode: pv.mode, injected: pv.injected }))
  } catch (e) { checks.push(item('注入状态', 'warn', String((e && e.message) || e))) }
  // 8) SKILL / 通用协作规则（v0.3.5 无角色）
  try {
    const scenes = (readJson(REGISTRY, {}).scenes || [])
    const missing = [], ruleIssues = []
    for (const s of scenes) {
      const id = String(s.id || '')
      if (!id) continue
      const skillFile = path.join(DSH_HOME, 'skills', id, 'SKILL.md')
      let txt = ''
      try { txt = fs.readFileSync(skillFile, 'utf8') } catch (e) { txt = '' }
      const how = (txt.split('## 怎么做')[1] || '').split(/^## /m)[0] || ''
      if (!txt || how.replace(/[\s#（(）)]/g, '').length < 8) missing.push(id)
      if (!/## 协作规则/.test(txt)) ruleIssues.push(id)
    }
    checks.push(item('SKILL 文件', missing.length ? 'warn' : 'ok', missing.length ? ('缺/空：' + missing.slice(0, 5).join(' / ')) : ('已覆盖 ' + scenes.length + ' 个场景且「怎么做」非空'), { missing }))
    checks.push(item('协作规则', ruleIssues.length ? 'warn' : 'ok', ruleIssues.length ? ('SKILL 缺通用协作规则：' + ruleIssues.slice(0, 5).join(' / ')) : '所有 SKILL 含通用协作规则', { issues: ruleIssues }))
  } catch (e) { checks.push(item('SKILL 文件', 'warn', String((e && e.message) || e))) }
  const fail = checks.filter((c) => c.status === 'fail').length
  const warn = checks.filter((c) => c.status === 'warn').length
  const result = { ok: fail === 0, at: new Date().toISOString(), version: v, dataRoot: DSH_HOME, root: ROOT, fail, warn, checks }
  globalThis.__wbDoctor = result
  return result
}

export function lastDoctor() { return globalThis.__wbDoctor || null }
