/**
 * search.js —— 轻检索（dh032）：文件名 + frontmatter 过滤 + 文本 grep。
 * 不建索引、不向量；结果 [{path, one_line, refs}]。
 * 独立可 import；仅在 wb_read(action='search') 时被调用（默认不启用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DSH_HOME, AGENTS, COLLAB, BLACKBOARD } from './paths.js'
import { readText } from './store.js'

const rel = (p) => path.relative(DSH_HOME, p).replace(/\\/g, '/')

function walk(dir, out, depth = 0) {
  if (depth > 6) return
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p, out, depth + 1) } else if (/\.(md|json|jsonl|txt)$/i.test(e.name)) out.push(p)
  }
}

function parseFrontmatter(text) {
  const m = String(text || '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return null
  const fm = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (kv) fm[kv[1]] = kv[2].trim()
  }
  return fm
}

/**
 * @param {{q?:string, scene?:string, task_type?:string, since?:string, limit?:number}} opts
 * @returns {{ok:true, query:object, hits:Array<{path:string,one_line:string,refs:string[]}>}}
 */
export function search(opts = {}) {
  const q = String(opts.query != null && opts.query !== '' ? opts.query : (opts.q || '')).trim()
  const scene = String(opts.scene || '').trim()
  const scope = String(opts.scope || '').trim()
  const taskType = String(opts.task_type || '').trim()
  const since = String(opts.since || '').trim()
  const limit = Math.max(1, Math.min(100, Number(opts.limit) || 5))
  const files = []
  const roots = []
  if (!scope || scope === 'memory') roots.push(path.join(AGENTS))
  if (scope === 'playbooks') roots.push(path.join(DSH_HOME, 'playbooks'))
  if (scope === 'blackboard') roots.push(BLACKBOARD)
  if (!scope || scope === 'collab') roots.push(COLLAB)
  for (const r of roots) walk(r, files)
  const hits = []
  for (const f of files) {
    const r = rel(f)
    if (scene && r.indexOf(scene) < 0 && r.indexOf('agents/' + scene) < 0) continue
    let text = ''
    try { text = readText(f) } catch (e) { continue }
    const fm = parseFrontmatter(text)
    if (taskType && (!fm || String(fm.task_type || '') !== taskType)) continue
    let mtime = 0
    try { mtime = fs.statSync(f).mtimeMs } catch (e) { mtime = 0 }
    const day = new Date(mtime).toISOString().slice(0, 10)
    const pathDay = (r.match(/\/(\d{4}-\d{2}-\d{2})\//) || [])[1] || ''
    const date = pathDay || day
    if (since && date < since) continue
    if (!q) {
      const firstLine = text.split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !/^---/.test(x))[0] || ''
      hits.push({ path: r, date, one_line: firstLine.slice(0, 200), refs: [r] })
      if (hits.length >= limit) break
      continue
    }
    const line = text.split(/\r?\n/).find((l) => l.toLowerCase().indexOf(q.toLowerCase()) >= 0)
    if (!line) continue
    hits.push({ path: r, date, one_line: line.trim().slice(0, 200), refs: [r] })
    if (hits.length >= limit) break
  }
  return { ok: true, query: { query: q, q, scene, scope, task_type: taskType, since, limit }, hits }
}

export default search
