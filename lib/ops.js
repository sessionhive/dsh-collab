/**
 * ops.js —— 「其他设置」v6 运维/预算/清理 host 实现（dh039；dh048 路径全英文，只操作 dataRoot 下 trash/temp/backups 与事件流）。
 * 不接管使用者工作区（由 app 管理），不创建/引用中文目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { ROOT, DSH_HOME, EVENTS_DIR, EVENTS_FILE, CONFIG, TOOLS, REGISTRY, META } from './paths.js'
import { readText, readJson, writeJson, ensureDir, exists, today, nowIso } from './store.js'
import { hashFile, writeJsonGuardedSync } from './concurrency.js'
import { engineVersionInfo, profilePath, runtimeVersion, diskPluginVersion, versionCompare } from './diagnostics.js'
import { ensureBoardPage } from './board.js'
import { enginePort, boardUrl } from './engine-port.js'

const TRASH = path.join(DSH_HOME, 'trash')
const TEMP = path.join(DSH_HOME, 'temp')
const BACKUPS = path.join(DSH_HOME, 'backups')
const BOARD = path.join(DSH_HOME, 'board', 'index.html')

let lastSelfCheck = null

function dirStats(p) {
  const out = { path: p, exists: exists(p), files: 0, dirs: 0, bytes: 0 }
  const walk = (d, depth = 0) => {
    if (depth > 8) return
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    for (const e of ents) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) { out.dirs++; walk(f, depth + 1) } else { out.files++; try { out.bytes += fs.statSync(f).size } catch (e2) { /* ignore */ } }
    }
  }
  if (exists(p)) walk(p)
  return out
}

function entryList(dir) {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return [] }
  return ents.map((e) => {
    const f = path.join(dir, e.name)
    let bytes = 0, mtime = 0
    try { const st = fs.statSync(f); bytes = st.isDirectory() ? dirStats(f).bytes : st.size; mtime = st.mtimeMs } catch (e2) { /* ignore */ }
    return { name: e.name, dir: e.isDirectory(), bytes, mtime: Math.floor(mtime / 1000) }
  }).sort((a, b) => b.mtime - a.mtime)
}

function moveToTrash(src, tag) {
  ensureDir(TRASH)
  const sub = path.join(TRASH, tag + '-' + String(Date.now()))
  ensureDir(sub)
  const dest = path.join(sub, path.basename(src))
  try { fs.renameSync(src, dest) } catch (e) {
    fs.cpSync(src, dest, { recursive: true })
    fs.rmSync(src, { recursive: true, force: true })
  }
  return dest
}

function runOne(name, script, args) {
  return new Promise((resolve) => {
    const full = path.join(TOOLS, script)
    if (!exists(full)) return resolve({ name, ok: true, skipped: true, code: 0, ms: 0, summary: '外部环境无 工具\\' + script + '，跳过' })
    if (script.indexOf(path.sep) >= 0 && !exists(full)) return resolve({ name, ok: true, skipped: true, code: 0, ms: 0, summary: '缺失，跳过' })
    const t0 = Date.now()
    let out = ''
    try {
      const child = spawn(process.execPath, [full, ...(args || [])], { cwd: ROOT, windowsHide: true })
      const timer = setTimeout(() => { try { child.kill() } catch (e) { /* ignore */ } }, 180000)
      child.stdout.on('data', (d) => { out += String(d) })
      child.stderr.on('data', (d) => { out += String(d) })
      child.on('error', (e) => { clearTimeout(timer); resolve({ name, ok: false, code: -1, ms: Date.now() - t0, summary: String((e && e.message) || e).slice(0, 200), out: out.slice(0, 2000) }) })
      child.on('close', (code) => {
        clearTimeout(timer)
        const lines = String(out).split(/\r?\n/).filter(Boolean)
        resolve({ name, ok: code === 0, code, ms: Date.now() - t0, summary: String(lines.slice(-1)[0] || (code === 0 ? '通过' : '失败')).slice(0, 200), out: String(out).slice(0, 4000) })
      })
    } catch (e) {
      resolve({ name, ok: false, code: -1, ms: Date.now() - t0, summary: String((e && e.message) || e).slice(0, 200) })
    }
  })
}

export async function selfCheck() {
  const t0 = Date.now()
  const items = []
  const add = (name, status, detail, extra) => items.push({ name, status, ok: status === 'ok', detail: String(detail || ''), ...(extra || {}) })
  // ① 路由可响应（能执行到这里即已响应）
  add('路由响应', 'ok', '/ops/selfcheck 正常响应')
  // ② dataRoot 可写
  try {
    const probe = path.join(DSH_HOME, '_meta', '.selfcheck-probe')
    fs.mkdirSync(path.dirname(probe), { recursive: true })
    fs.writeFileSync(probe, String(Date.now()))
    fs.unlinkSync(probe)
    add('dataRoot 可写', 'ok', DSH_HOME)
  } catch (e) { add('dataRoot 可写', 'fail', '写入失败：' + String((e && e.message) || e)) }
  // ③ config 合法
  try {
    const cfg = readJson(CONFIG, null)
    add('config 合法', cfg && typeof cfg === 'object' ? 'ok' : 'fail', cfg ? 'config.json 可读' : '缺失/不是合法 JSON')
  } catch (e) { add('config 合法', 'fail', String((e && e.message) || e)) }
  // ④ index 与 registry 一致
  try {
    const reg = readJson(REGISTRY, {}) || {}
    const ids = (Array.isArray(reg.scenes) ? reg.scenes : []).map((s) => String(s.id || '')).filter(Boolean)
    const idx = readText(path.join(META, 'scene-index.md'))
    const miss = ids.filter((id) => idx.indexOf(id) < 0)
    add('index/registry 一致', miss.length ? 'warn' : 'ok', miss.length ? ('索引缺：' + miss.slice(0, 5).join(' / ')) : ('registry ' + ids.length + ' 个场景已入索引'))
  } catch (e) { add('index/registry 一致', 'warn', String((e && e.message) || e)) }
  // ⑤ 运行版本 vs 磁盘
  try {
    const rv = runtimeVersion(), dv = diskPluginVersion()
    add('版本一致', rv && dv && rv === dv ? 'ok' : 'warn', '运行 ' + (rv || '?') + ' / 磁盘 ' + (dv || '?') + (rv && dv && rv !== dv ? '（需重启加载新版本）' : ''))
  } catch (e) { add('版本一致', 'warn', String((e && e.message) || e)) }
  // ⑥ 模板可解析
  try {
    const { loadTemplate, renderTemplate } = await import('./templates.js')
    const seed = renderTemplate('seed.md', { name: '自检', id: 'selfcheck', root: DSH_HOME, openOrders: '无 → 无单即收', hardRule: '' })
    const disp = renderTemplate('dispatch.md', { id: 'dh001', goal: '自检', delivery: 'x', accept: 'y', constraints: 'z', evidence: 'e', flow: 'a → b' })
    add('模板可解析', seed && disp ? 'ok' : 'warn', seed && disp ? 'seed/dispatch 可渲染' : '模板缺失或渲染为空')
  } catch (e) { add('模板可解析', 'warn', String((e && e.message) || e)) }
  // ⑦ 技能文件存在
  try {
    const reg = readJson(REGISTRY, {}) || {}
    const ids = (Array.isArray(reg.scenes) ? reg.scenes : []).map((s) => String(s.id || '')).filter(Boolean)
    const miss = ids.filter((id) => !exists(path.join(DSH_HOME, 'skills', id, 'SKILL.md')))
    add('技能文件', miss.length ? 'warn' : 'ok', miss.length ? ('缺：' + miss.slice(0, 5).join(' / ')) : ('已覆盖 ' + ids.length + ' 个会话'))
  } catch (e) { add('技能文件', 'warn', String((e && e.message) || e)) }
  // ⑧ trash/logs 目录可建
  try {
    ensureDir(TRASH); ensureDir(path.join(DSH_HOME, 'logs'))
    add('trash/logs 目录', 'ok', '可创建/已存在')
  } catch (e) { add('trash/logs 目录', 'fail', String((e && e.message) || e)) }
  // ⑨ manifest sha（若已生成）
  try {
    const { verifyManifest } = await import('./migrate.js')
    const v = verifyManifest()
    add('manifest sha', v.ok ? 'ok' : (v.skipped ? 'warn' : 'fail'), v.detail || '')
  } catch (e) { add('manifest sha', 'warn', String((e && e.message) || e)) }
  const fail = items.filter((x) => x.status === 'fail').length
  const warn = items.filter((x) => x.status === 'warn').length
  lastSelfCheck = { ok: fail === 0, at: nowIso(), ms: Date.now() - t0, passed: items.filter((x) => x.ok).length, total: items.length, fail, warn, items }
  return lastSelfCheck
}

export function opsInfo() {
  const eng = engineVersionInfo()
  const vc = versionCompare()
  return {
    ok: true, plugin: { name: 'dsh-workbench-core', version: runtimeVersion() || '0.0.0', diskVersion: diskPluginVersion(), stale: vc.stale }, engine: { version: eng.version, reason: eng.reason || '' }, root: ROOT, dataRoot: DSH_HOME, profile: profilePath(), lastSelfCheck,
    paths: {
      root: ROOT,
      trash: exists(TRASH),
      backups: exists(BACKUPS),
      temp: exists(TEMP),
      board: exists(BOARD),
      events: exists(EVENTS_DIR),
    },
    diagnostics: (() => {
      const t = dirStats(TRASH), b = dirStats(BACKUPS), m = dirStats(TEMP)
      return {
        dataRoot: DSH_HOME,
        trash: { path: TRASH, exists: exists(TRASH), files: t.files, dirs: t.dirs, items: t.files + t.dirs, bytes: t.bytes },
        backups: { path: BACKUPS, exists: exists(BACKUPS), files: b.files, dirs: b.dirs, bytes: b.bytes },
        temp: { path: TEMP, exists: exists(TEMP), files: m.files, dirs: m.dirs, bytes: m.bytes },
        events: { path: EVENTS_DIR, exists: exists(EVENTS_DIR) },
      }
    })(),
  }
}

export function opsPaths() { return { trash: TRASH, temp: TEMP, backups: BACKUPS, board: BOARD } }

export function openTarget2(target, pathArg) {
  const t = String(target || '')
  if (t === 'path') {
    const p = String(pathArg || '')
    if (!p || !exists(p)) return { ok: false, hint: '路径不存在：' + (p || '(空)') }
    try {
      if (fs.statSync(p).isDirectory()) spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref()
      else spawn('cmd.exe', ['/c', 'start', '', p], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      return { ok: true, target: 'path', path: p }
    } catch (e) { return { ok: false, hint: '打开失败：' + String((e && e.message) || e) } }
  }
  if (t === 'board') {
    // dh049：优先打开引擎 HTTP 地址（同源）；文件版兜底注入端口
    const port = enginePort()
    try { ensureBoardPage(port) } catch (e) { /* 写盘失败仍尝试 URL/文件 */ }
    const url = boardUrl(port)
    try {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      return { ok: true, target: 'board', url, path: BOARD, mode: 'http', enginePort: port }
    } catch (e) { /* 打不开 URL 再退回文件 */ }
  }
  const map = {
    board: BOARD, events: EVENTS_DIR, trash: TRASH, temp: TEMP, backups: BACKUPS, dataDir: DSH_HOME, exports: path.join(DSH_HOME, 'exports'),
  }
  const p = map[t]
  if (!p) return { ok: false, hint: '不允许打开：' + (t || '(空)') }
  if (!exists(p)) return { ok: false, hint: '路径不存在：' + p }
  try {
    if (fs.statSync(p).isDirectory()) spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref()
    else spawn('cmd.exe', ['/c', 'start', '', p], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return { ok: true, target: String(target), path: p }
  } catch (e) { return { ok: false, hint: '打开失败：' + String((e && e.message) || e) } }
}

export function openItem(kind, name, action = 'file') {
  const map = { trash: TRASH, backups: BACKUPS, temp: TEMP }
  const base = map[String(kind || '')]
  if (!base) return { ok: false, hint: '不允许打开：' + kind }
  const n = String(name || '').trim()
  if (!n || n.indexOf('..') >= 0 || /[\\/]/.test(n)) return { ok: false, hint: '条目名不合法：' + n }
  const abs = path.join(base, n)
  if (!exists(abs)) return { ok: false, hint: '条目不存在：' + abs }
  try {
    const isDir = fs.statSync(abs).isDirectory()
    if (action === 'dir') spawn('explorer.exe', [isDir ? abs : path.dirname(abs)], { detached: true, stdio: 'ignore' }).unref()
    else if (isDir) spawn('explorer.exe', [abs], { detached: true, stdio: 'ignore' }).unref()
    else spawn('cmd.exe', ['/c', 'start', '', abs], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return { ok: true, path: abs, isDir }
  } catch (e) { return { ok: false, hint: '打开失败：' + String((e && e.message) || e) } }
}

export function trashInfo() {
  const st = dirStats(TRASH)
  return { ok: true, path: TRASH, count: st.files, dirs: st.dirs, items: st.files + st.dirs, bytes: st.bytes, entries: entryList(TRASH).slice(0, 20) }
}

export function deleteTrash(names) {
  const list = (Array.isArray(names) ? names : [names]).map((x) => String(x || '').trim()).filter(Boolean)
  let removed = 0
  for (const name of list) {
    if (name.indexOf('..') >= 0 || /[\\/]/.test(name)) continue
    try { fs.rmSync(path.join(TRASH, name), { recursive: true, force: true }); removed++ } catch (e) { /* skip */ }
  }
  return { ok: true, removed, items: list.length }
}

export function clearTrash(confirm) {
  if (String(confirm || '') !== '清空') return { ok: false, hint: '需要输入「清空」确认（不可回滚）' }
  const before = dirStats(TRASH)
  let removed = 0
  let ents = []
  try { ents = fs.readdirSync(TRASH) } catch (e) { ents = [] }
  for (const name of ents) {
    try { fs.rmSync(path.join(TRASH, name), { recursive: true, force: true }); removed++ } catch (e) { /* skip */ }
  }
  return { ok: true, removed, bytes: before.bytes, path: TRASH, note: '已永久清空（不可回滚）' }
}

export function backupsInfo() {
  const st = dirStats(BACKUPS)
  return { ok: true, path: BACKUPS, count: st.files, dirs: st.dirs, bytes: st.bytes, entries: entryList(BACKUPS).slice(0, 50) }
}

export function deleteBackups(names, confirm) {
  if (!confirm) return { ok: false, hint: '需要确认（会移入回收站，可找回）' }
  const list = (Array.isArray(names) ? names : []).map(String).filter(Boolean)
  if (!list.length) return { ok: false, hint: '没有选择要删除的备份项' }
  const moved = []
  for (const name of list) {
    const src = path.join(BACKUPS, name)
    if (!exists(src)) continue
    try {
      const dest = moveToTrash(src, 'backup-delete')
      moved.push({ name, dest: path.relative(DSH_HOME, dest) })
    } catch (e) { /* skip */ }
  }
  return { ok: true, moved, note: '已移入 dataRoot\\trash（可找回）' }
}

export function eventsInfo() {
  let bytes = 0, lines = 0
  let arr = []
  try {
    const t = readText(EVENTS_FILE)
    bytes = Buffer.byteLength(t, 'utf8')
    arr = t.split(/\r?\n/).filter(Boolean)
    lines = arr.length
  } catch (e) { /* ignore */ }
  const recent = []
  for (let i = Math.max(0, arr.length - 100); i < arr.length; i++) {
    let j = null
    try { j = JSON.parse(arr[i]) } catch (e) { j = null }
    if (!j) continue
    const t = j.text || [j.from, j.to].filter(Boolean).join('→') || [j.order_id, j.status].filter(Boolean).join(' ') || ''
    recent.push({ line: i + 1, ts: String(j.ts || ''), type: String(j.type || ''), summary: String(t).slice(0, 80) })
  }
  recent.reverse()
  return { ok: true, path: EVENTS_FILE, bytes, lines, recent }
}

/** 清理勾选的事件行（按 1-based 行号；选中行进回收站） */
export function deleteEventsSelected(lineNumbers, confirm) {
  if (!confirm) return { ok: false, hint: '需要确认（选中行会移入回收站）' }
  const want = new Set((Array.isArray(lineNumbers) ? lineNumbers : []).map((n) => Math.floor(Number(n) || 0)).filter((n) => n > 0))
  if (!want.size) return { ok: false, hint: '未勾选要清理的行' }
  let text = ''
  try { text = readText(EVENTS_FILE) } catch (e) { text = '' }
  const lines = text.split(/\r?\n/).filter(Boolean)
  const removed = []
  const kept = []
  lines.forEach((line, i) => { if (want.has(i + 1)) removed.push(line); else kept.push(line) })
  if (!removed.length) return { ok: true, removed: 0, kept: kept.length, note: '没有匹配的行（可能已被清理）' }
  const tag = 'events-selected-' + String(Date.now())
  const dir = ensureDir(path.join(TRASH, tag))
  const backupFile = path.join(dir, 'events-removed.jsonl')
  fs.writeFileSync(backupFile, removed.join('\n') + '\n', 'utf8')
  fs.writeFileSync(EVENTS_FILE, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8')
  return { ok: true, removed: removed.length, kept: kept.length, backup: path.relative(DSH_HOME, backupFile), note: '选中行已移入 dataRoot\\trash，可找回' }
}

export function trimEvents(keep, confirm) {
  const n = Math.max(0, Math.floor(Number(keep) || 0))
  if (!confirm) return { ok: false, hint: '需要确认（旧事件会移入回收站）' }
  let text = ''
  try { text = readText(EVENTS_FILE) } catch (e) { text = '' }
  const lines = text.split(/\r?\n/).filter(Boolean)
  if (lines.length <= n) return { ok: true, removed: 0, kept: lines.length, note: '行数不足，无需清理' }
  const removedLines = lines.slice(0, lines.length - n)
  const kept = lines.slice(lines.length - n)
  const tag = 'events-trim-' + String(Date.now())
  const dir = ensureDir(path.join(TRASH, tag))
  const backupFile = path.join(dir, 'events-removed.jsonl')
  fs.writeFileSync(backupFile, removedLines.join('\n') + '\n', 'utf8')
  fs.writeFileSync(EVENTS_FILE, kept.join('\n') + '\n', 'utf8')
  return { ok: true, removed: removedLines.length, kept: kept.length, backup: path.relative(DSH_HOME, backupFile), note: '旧行已移入 dataRoot\\trash，可找回' }
}

export function tempInfo() {
  const st = dirStats(TEMP)
  let entries = []
  try { entries = fs.readdirSync(TEMP, { withFileTypes: true }).filter((e) => e.name !== '_回收').map((e) => e.name) } catch (e) { entries = [] }
  return { ok: true, path: TEMP, files: st.files, dirs: st.dirs, bytes: st.bytes, entries: entries.slice(0, 50), count: entries.length }
}

export function cleanTemp(confirm, names) {
  if (!confirm) return { ok: false, hint: '需要确认（会移入回收站，可找回）' }
  let ents = []
  try { ents = fs.readdirSync(TEMP, { withFileTypes: true }).filter((e) => e.name !== '_回收') } catch (e) { ents = [] }
  const only = Array.isArray(names) && names.length ? new Set(names.map(String)) : null
  if (only) ents = ents.filter((e) => only.has(e.name))
  const moved = []
  for (const e of ents) {
    try {
      const dest = moveToTrash(path.join(TEMP, e.name), '临时清理')
      moved.push({ name: e.name, dest: path.relative(DSH_HOME, dest) })
    } catch (err) { /* skip */ }
  }
  return { ok: true, moved, note: '已移入 dataRoot\\trash（可找回）' }
}

export function saveUiConfig(patch = {}) {
  const cfg = readJson(CONFIG, {}) || {}
  const theme = String(patch.theme || '').trim()
  const lang = String(patch.lang || '').trim()
  if (theme) {
    if (!['auto', 'dark', 'light'].includes(theme)) return { ok: false, hint: 'theme 只能是 auto/dark/light' }
    cfg.theme = theme
  }
  if (lang) {
    if (!['zh', 'en'].includes(lang)) return { ok: false, hint: 'lang 只能是 zh/en' }
    cfg.lang = lang
  }
  writeJson(CONFIG, cfg)
  return { ok: true, theme: cfg.theme || 'auto', lang: cfg.lang || 'zh' }
}

export function configInfo() {
  const c = readJson(CONFIG, {}) || {}
  const b = c.budget || {}
  const h = c.handover || {}
  return {
    ok: true, path: CONFIG, enginePort: enginePort(),
    budget: { wakePerScenePerDay: Number.isFinite(Number(b.wakePerScenePerDay)) ? Number(b.wakePerScenePerDay) : 3 },
    token: { enabled: h.enabled === true, warnContextTokens: Number(h.warnContextTokens) || 60000, contextThresholdTokens: Number(h.contextThresholdTokens) || 120000 },
    defaults: { defaultCwd: String(c.defaultCwd || ''), seedOnCreate: c.seedOnCreate !== false },
    theme: String(c.theme || 'auto'),
    lang: String(c.lang || 'zh'),
    notice: c.notice || {},
  }
}

export function saveBudget(body = {}, opts = {}) {
  const cfgHash = opts.expectedHash != null ? String(opts.expectedHash) : hashFile(CONFIG)
  const cur = readJson(CONFIG, {}) || {}
  const b = Object.assign({}, cur.budget || {})
  delete b.enforceWake // v0.2.12：唤醒闸字段彻底移除，不再接受/写回
  if (body.wakePerScenePerDay != null) {
    const n = Number(body.wakePerScenePerDay)
    if (!Number.isFinite(n) || n < 1 || n > 100) return { ok: false, hint: 'wakePerScenePerDay 取 1~100' }
    b.wakePerScenePerDay = Math.round(n)
  }
  cur.budget = b
  const w = writeJsonGuardedSync(CONFIG, cur, { expectedHash: cfgHash, reason: 'config-budget' })
  if (!w.ok) return { ok: false, concurrent: true, rule: 'PRT-016', hint: w.reason }
  return { ok: true, config: configInfo(), path: CONFIG }
}

export function saveToken(body = {}, opts = {}) {
  const cfgHash = opts.expectedHash != null ? String(opts.expectedHash) : hashFile(CONFIG)
  const cur = readJson(CONFIG, {}) || {}
  const h = Object.assign({}, cur.handover || {})
  const pick = (v, def) => {
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) return null
    return Math.round(n)
  }
  if (body.warnContextTokens != null) { const v = pick(body.warnContextTokens); if (v == null) return { ok: false, hint: '提醒值必须是 ≥0 的数字' }; h.warnContextTokens = v }
  if (body.contextThresholdTokens != null) { const v = pick(body.contextThresholdTokens); if (v == null) return { ok: false, hint: '交接值必须是 ≥0 的数字' }; h.contextThresholdTokens = v }
  if (typeof body.enabled === 'boolean') h.enabled = body.enabled
  cur.handover = h
  const w2 = writeJsonGuardedSync(CONFIG, cur, { expectedHash: cfgHash, reason: 'config-token' })
  if (!w2.ok) return { ok: false, concurrent: true, rule: 'PRT-016', hint: w2.reason }
  return { ok: true, config: configInfo(), path: CONFIG }
}
