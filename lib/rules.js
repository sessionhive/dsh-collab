/**
 * rules.js —— 读基础宪法（只读）+ 可执行校验器（契约 §四）。
 * 违规返回 { ok:false, rule, hint }；不抛异常（工具层转成提示）。
 */
import path from 'node:path'
import { CONSTITUTION, REGISTRY, AGENTS } from './paths.js'
import { readText, readJson, listFiles } from './store.js'

/** 读 constitution\current\*.md → [{id, section, title, body}] */
export function readRules() {
  const out = []
  let files = []
  try { files = listFiles(CONSTITUTION, { limit: 200 }).filter((f) => /^(INV|BND|PRT)-\d+\.md$/.test(path.basename(f))).sort() } catch (e) { files = [] }
  for (const f of files) {
    const t = readText(f)
    const fm = t.match(/^---\n([\s\S]*?)\n---\n/)
    const get = (k) => (fm ? (fm[1].match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '' : '')
    const body = t.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^#\s+.+\n+/, '').trim()
    out.push({ id: get('id') || path.basename(f, '.md'), section: Number(get('section') || 0), title: get('title') || '', body })
  }
  return out
}

export function ruleText(id) {
  const r = readRules().find((x) => x.id === id)
  return r ? r.body.slice(0, 300) : ''
}

export function registry() { return readJson(REGISTRY, {}) || {} }
export function scenes() { const j = registry(); return Array.isArray(j.scenes) ? j.scenes : [] }
export function sceneIds() { return scenes().map((s) => String(s.id)) }

/** 场景解析：id / name / 任一会话 id 都能命中 */
export function findScene(key) {
  const k = String(key || '').trim()
  if (!k) return null
  for (const s of scenes()) {
    if (String(s.id) === k || String(s.name) === k) return s
    const ss = Array.isArray(s.sessions) ? s.sessions : []
    if (ss.some((x) => x && String(x.sessionId) === k)) return s
  }
  return null
}

export function sessionIdOf(exec) {
  try { return String(exec && exec.agent && exec.agent.session && exec.agent.session.header && exec.agent.session.header.id || '') } catch (e) { return '' }
}

/** 调用方场景（按会话 id 反查；解析不到返回 null） */
export function callerScene(exec) {
  const sid = sessionIdOf(exec)
  if (!sid) return null
  return findScene(sid)
}

const SENSITIVE = [
  /(api[_-]?key|secret|password|passwd|token)\s*[:=：]\s*["']?[A-Za-z0-9_\-]{12,}/i,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
]

function byteLen(s) { return Buffer.byteLength(String(s || ''), 'utf8') }

/**
 * wb_write(note) 校验：refs 非空 / ≤20 行 & ≤2KB / 只写自己场景目录 / 敏感词。
 * @returns {{ok:true, scene:object} | {ok:false, rule:string, hint:string}}
 */
export function validateNote({ scene, text, refs, exec }) {
  const sc = findScene(scene)
  if (!sc) return { ok: false, rule: 'BND-002', hint: '场景未注册（_meta\\registry.json 里没有）：' + scene + '；只能写已注册场景的数据' }
  const caller = callerScene(exec)
  if (caller && String(caller.id) !== String(sc.id)) {
    return { ok: false, rule: 'BND-002', hint: '只能写自己场景的目录：调用方是 ' + caller.id + '，目标是 ' + sc.id }
  }
  const list = (Array.isArray(refs) ? refs : []).map((x) => String(x || '').trim()).filter(Boolean)
  if (!list.length) return { ok: false, rule: 'INV-001', hint: '结论必须带来源：refs 不能为空（文件路径 / 命令输出 / 链接）' }
  const t = String(text == null ? '' : text)
  if (!t.trim()) return { ok: false, rule: 'INV-001', hint: 'text 不能为空（结论要写清楚）' }
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).length
  if (lines > 20) return { ok: false, rule: 'PRT-004', hint: '单条记忆 ≤20 行（当前 ' + lines + ' 行）' }
  const bytes = byteLen(t)
  if (bytes > 2048) return { ok: false, rule: 'PRT-004', hint: '单条记忆 ≤2KB（当前 ' + bytes + ' 字节）' }
  for (const re of SENSITIVE) {
    if (re.test(t)) return { ok: false, rule: 'BND-005', hint: '文本里疑似密钥/账号/私钥，禁止写入记忆（只写路径引用）' }
  }
  return { ok: true, scene: sc, refs: list }
}

/** 校验协作单写权限：记录 ∈ assignee ∪ collaborators；终态 ∈ {assignee, dispatcher} */
export function canWriteOrder(order, author, { close = false } = {}) {
  if (!order) return { ok: false, rule: 'PRT-005', hint: '找不到协作单' }
  const fm = order.frontmatter || {}
  const assignee = String(fm.assignee || '')
  const dispatcher = String(fm.dispatcher || '')
  const collabs = String(fm.collaborators || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
  const me = String(author || '').trim()
  if (!me) return { ok: false, rule: 'PRT-005', hint: 'author 不能为空（谁在写）' }
  if (close) {
    const current = String(fm.current_owner || assignee)
    if (me !== assignee && me !== dispatcher && me !== current && me !== 'host') return { ok: false, rule: 'PRT-005', hint: '终态/取消只能由 assignee、dispatcher、current_owner 或 host 写：' + assignee + ' / ' + dispatcher + ' / ' + current }
    return { ok: true }
  }
  if (me !== assignee && collabs.indexOf(me) < 0) return { ok: false, rule: 'PRT-005', hint: '记录只能由 assignee 或 collaborators 写：' + [assignee, ...collabs].join(' / ') }
  return { ok: true }
}

export function sceneMemoryDir(sceneId) { return path.join(AGENTS, sceneId, 'memory') }
