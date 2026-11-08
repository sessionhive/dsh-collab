/**
 * agents-inject.js —— 核心宪法注入（dh044）。
 *
 * 独立模式（无 外壳\scenarios，即外部）：把「核心宪法（内置 core.md）+ global-rules 注入片段 + 已注册场景指针」
 * 写入 <dataRoot>\AGENTS.md 的托管段（<!-- wb-core:begin --> … <!-- wb-core:end -->）。
 *   - 保留用户其它内容；幂等（重复 apply 不叠加）；写前备份 AGENTS.md → AGENTS.md.bak
 * 壳模式默认不注入（避免与工作台 gen-agents 冲突）；config.inject = auto|on|off 可覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DSH_HOME, HAS_GUI, GLOBAL_RULES, GLOBAL_INJECT, REGISTRY, CONFIG, META, AGENTS } from './paths.js'
import { readJson, readText, writeAtomic, ensureDir, exists } from './store.js'

export const BEGIN = '<!-- wb-core:begin -->'
export const END = '<!-- wb-core:end -->'
export const CORE_VERSION = 'v1'
const CORE_FILE = fileURLToPath(new URL('./constitution/core.md', import.meta.url))
const STATE_FILE = path.join(META, 'inject-state.json')

export function coreText() {
  try { return fs.readFileSync(CORE_FILE, 'utf8') } catch (e) { return '' }
}

export function coreHash() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(CORE_FILE)).digest('hex').slice(0, 12) } catch (e) { return '' }
}

/** 注入模式：config.inject=on/off 显式覆盖；auto（默认）= 独立模式注入、壳模式不注入 */
export function injectMode() {
  let cfg = {}
  try { cfg = readJson(CONFIG, {}) || {} } catch (e) { cfg = {} }
  const raw = String(cfg.inject || 'auto').toLowerCase()
  if (raw === 'on' || raw === 'off') return raw
  return HAS_GUI ? 'off' : 'on'
}

function globalInjectText() {
  try {
    if (exists(GLOBAL_INJECT)) return String(readText(GLOBAL_INJECT) || '').trim()
    if (exists(GLOBAL_RULES)) return String(readText(GLOBAL_RULES) || '').trim()
  } catch (e) { /* ignore */ }
  return ''
}

function scenePointers() {
  try {
    const reg = readJson(REGISTRY, {}) || {}
    const arr = Array.isArray(reg.scenes) ? reg.scenes : []
    if (!arr.length) return '- （暂无已注册场景；新增协作会话后自动更新）'
    return arr.map((s) => {
      const sid = Array.isArray(s.sessions) && s.sessions[0] ? String(s.sessions[0].sessionId || '') : ''
      const card = readJson(path.join(AGENTS, String(s.id), 'card.json'), {}) || {}
      const v = Number(card.card_version) || 0
      const upd = card.updated_at ? String(card.updated_at).replace('T', ' ').slice(0, 16) : ''
      return '- 场景身份：' + String(s.name || s.id) + '（' + String(s.id) + '）· card v' + v + (upd ? ' · 更新 ' + upd : '') + (sid ? ' · 会话 `' + sid + '`' : '') +
        ' · 卡 `agents\\' + String(s.id) + '\\card.json` · 摘要 `agents\\' + String(s.id) + '\\summary.md`'
    }).join('\n')
  } catch (e) { return '- （registry 读取失败：' + String((e && e.message) || e) + '）' }
}

/** 托管段内容（不含时间戳，保证无变化时字节级幂等） */
export function buildSection() {
  const core = coreText().trim()
  const rules = globalInjectText()
  return [
    BEGIN,
    '<!-- 由 dsh-workbench-core 生成 · 核心宪法 ' + CORE_VERSION + ' · 只读；用户内容请写在标记之外 -->',
    '# 工作台核心宪法（插件注入 · 只读）',
    '',
    '> 本节由 workbench-core 托管（开始/结束标记之间）；重复启动不会叠加。内置只读；可由 <dataRoot>\\shared\\templates 或配置覆盖。',
    '',
    core,
    '',
    '## 全局规则（global-rules 注入片段）',
    '',
    rules || '（尚未写全局规则；可在设置页区域①填写）',
    '',
    '## 已注册场景（指针）',
    '',
    scenePointers(),
    END,
    '',
  ].join('\n')
}

function stripManaged(text) {
  const re = /<!-- wb-core:begin[\s\S]*?<!-- wb-core:end -->[ \t]*\r?\n?/g
  return String(text || '').replace(re, '')
}

function extractManaged(text) {
  const m = String(text || '').match(/<!-- wb-core:begin[\s\S]*?<!-- wb-core:end -->/)
  return m ? m[0] : ''
}

function backup(file, content) {
  try {
    if (!content) return ''
    const bak = file + '.bak'
    fs.writeFileSync(bak, content, 'utf8')
    return bak
  } catch (e) { return '' }
}

function targetFile() { return path.join(DSH_HOME, 'AGENTS.md') }

/**
 * 重新生成注入（幂等）。@returns {{ok:boolean, mode:string, injected:boolean, changed:boolean, path?:string, backup?:string, reason?:string, error?:string, coreVersion:string}}
 */
export function injectAgents(reason = 'manual') {
  const mode = injectMode()
  const file = targetFile()
  const existing = exists(file) ? String(readText(file) || '') : ''
  const stripped = stripManaged(existing).replace(/\s+$/, '')
  try {
    if (mode !== 'on') {
      // off：显式关闭时移除托管段（用户内容保留）；auto+GUI：壳模式默认不碰 AGENTS.md
      const hasBlock = /<!-- wb-core:begin/.test(existing)
      if (hasBlock) {
        const bak = backup(file, existing)
        writeAtomic(file, stripped ? stripped + '\n' : '')
        saveState({ mode, injected: false, reason: reason + ':removed', coreVersion: CORE_VERSION, changed: true })
        return { ok: true, mode, injected: false, changed: true, path: file, backup: bak, reason: reason + ':removed', coreVersion: CORE_VERSION }
      }
      return { ok: true, mode, injected: false, changed: false, path: file, reason: HAS_GUI ? 'shell-mode' : 'off', coreVersion: CORE_VERSION }
    }
    const section = buildSection()
    const next = (stripped ? stripped + '\n\n' : '') + section
    if (next === existing) {
      saveState({ mode, injected: true, reason, coreVersion: CORE_VERSION, changed: false })
      return { ok: true, mode, injected: true, changed: false, path: file, reason, coreVersion: CORE_VERSION }
    }
    const bak = backup(file, existing)
    ensureDir(path.dirname(file))
    writeAtomic(file, next)
    saveState({ mode, injected: true, reason, coreVersion: CORE_VERSION, changed: true, bytes: Buffer.byteLength(next, 'utf8') })
    return { ok: true, mode, injected: true, changed: true, path: file, backup: bak, reason, coreVersion: CORE_VERSION, bytes: Buffer.byteLength(next, 'utf8') }
  } catch (e) {
    return { ok: false, mode, injected: false, changed: false, error: String((e && e.message) || e), coreVersion: CORE_VERSION }
  }
}

function saveState(obj) {
  try {
    ensureDir(META)
    writeAtomic(STATE_FILE, JSON.stringify({ ...obj, coreVersion: CORE_VERSION, at: new Date().toISOString() }, null, 2) + '\n')
  } catch (e) { /* ignore */ }
}

/** 内置规则条数（只给数字，不输出正文） */
export function coreRuleCount() {
  const text = coreText()
  const n = (text.match(/^- \*\*/gm) || []).length
  return n
}

/** 设置页预览：只展示 global-rules 内容 + 内置规则条数（绝不输出内置规则正文） */
export function injectPreview() {
  const mode = injectMode()
  const file = targetFile()
  const existing = exists(file) ? String(readText(file) || '') : ''
  const injected = /<!-- wb-core:begin/.test(existing)
  const gram = globalInjectText()
  const count = coreRuleCount()
  let state = null
  try { state = readJson(STATE_FILE, null) } catch (e) { state = null }
  return {
    ok: true, mode, target: file, injectExpected: mode === 'on', injected,
    globalRules: gram,
    coreCount: count,
    // 预览正文=全局规则；注入时插件在内部自动叠加「内置规则 N 条」，正文不对外展示
    preview: [
      '## 注入预览（托管段）',
      '',
      '> 内置基础规则由插件维护、不可修改、不在此展示（注入时自动叠加于本段之前）。',
      '> 内置规则：' + count + ' 条（随插件，不可改）',
      '',
      '### 全局规则（shared\\env\\global-rules.md）',
      '',
      gram || '（尚未写全局规则；可在上方编辑并保存）',
    ].join('\n'),
    note: mode === 'on' ? '独立模式：已注入/可注入；预览仅展示全局规则，内置基础规则自动叠加、不展示正文' : (HAS_GUI ? '壳模式：默认不注入（由 gen-agents 统一生成 AGENTS.md）' : 'config.inject=off：不注入'),
    coreVersion: CORE_VERSION, state,
  }
}
