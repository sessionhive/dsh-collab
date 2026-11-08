/**
 * memory-index.js —— memory/INDEX.md 自动生成（v0.3.0 第二批）
 *   日期倒序；≤120 行；超出按月折叠（旧月份只留计数）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { AGENTS } from './paths.js'
import { ensureDir, readText, exists } from './store.js'

export function migrateNoteNames() {
  // D：一次性幂等改名 note-YYYY-MM-DD.md → note.md（目标已存在则跳过）
  let renamed = 0
  let agents = []
  try { agents = fs.readdirSync(AGENTS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch (e) { return { ok: false, renamed: 0 } }
  for (const id of agents) {
    const mem = path.join(AGENTS, id, 'memory')
    let days = []
    try { days = fs.readdirSync(mem, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) } catch (e) { continue }
    for (const day of days) {
      const dir = path.join(mem, day)
      let files = []
      try { files = fs.readdirSync(dir) } catch (e) { continue }
      for (const f of files) {
        if (!/^note-\d{4}-\d{2}-\d{2}(\.detail)?\.md$/i.test(f)) continue
        const target = path.join(dir, 'note' + (/\.detail\.md$/i.test(f) ? '.detail.md' : '.md'))
        if (fs.existsSync(target)) continue
        try { fs.renameSync(path.join(dir, f), target); renamed++ } catch (e) { /* ignore */ }
      }
    }
  }
  return { ok: true, renamed }
}

function walk(dir, out) {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.md$/i.test(e.name)) out.push(p)
  }
}

function oneLineOf(file) {
  const t = readText(file)
  const segs = String(t).split(/^\s*---\s*$/m).map((x) => x.trim()).filter(Boolean)
  const last = segs.length ? segs[segs.length - 1] : String(t)
  const lines = last.split(/\r?\n/).map((x) => x.trim())
  const concl = lines.filter((x) => /^(结论|summary)[:：]/.test(x)).pop()
  const line = concl ? concl.replace(/^(结论|summary)[:：]\s*/, '') : (lines.find((x) => x && !/^#/.test(x) && !/^---/.test(x) && !/^(来源|证据|路径|auto:|时间)[:：]/.test(x)) || '')
  return line.slice(0, 80)
}

export function rebuildMemoryIndex(sceneId) {
  const id = String(sceneId || '').trim()
  if (!id) return { ok: false, hint: 'sceneId 不能为空' }
  const root = path.join(AGENTS, id, 'memory')
  if (!exists(root)) return { ok: true, file: '', lines: 0, skipped: 'no-memory' }
  const files = []
  walk(root, files)
  // H：增量重建——INDEX 比所有 memory 文件新则跳过
  try {
    const idxFile = path.join(root, 'INDEX.md')
    if (fs.existsSync(idxFile)) {
      const idxM = fs.statSync(idxFile).mtimeMs
      const newest = files.reduce((mx, f) => { try { return Math.max(mx, fs.statSync(f).mtimeMs) } catch (e) { return mx } }, 0)
      if (newest <= idxM) return { ok: true, file: idxFile, skipped: 'fresh', lines: 0, total: files.length }
    }
  } catch (e) { /* ignore */ }
  const rows = files.map((f) => {
    let mtime = 0
    try { mtime = fs.statSync(f).mtime } catch (e) { mtime = new Date() }
    const hhmm = String(mtime.getHours()).padStart(2, '0') + ':' + String(mtime.getMinutes()).padStart(2, '0')
    const base = path.basename(f)
    const om = base.match(/(dh\d+)/i)
    const id = om ? om[1].toLowerCase() : 'note'
    const type = /\.detail/i.test(base) ? '细节' : (om ? '协作' : '记录')
    const evidence = (readText(f).match(/^(?:- )?(?:来源|证据|路径)[:：]\s*(.+)$/m) || [])[1] || ''
    return { file: f, day: (f.replace(/\\/g, '/').match(/\/(\d{4}-\d{2}-\d{2})\//) || [])[1] || '', rel: path.relative(AGENTS, f).replace(/\\/g, '/'), one: oneLineOf(f), hhmm, id, type, evidence: evidence.trim().slice(0, 80) }
  })
  rows.sort((a, b) => (b.day + b.rel).localeCompare(a.day + a.rel))
  const out = ['# 记忆索引（自动生成）', '']
  let used = 2
  let i = 0
  while (i < rows.length && used < 118) {
    const day = rows[i].day || '未分日期'
    out.push('## ' + day)
    used++
    while (i < rows.length && (rows[i].day || '未分日期') === day && used < 118) {
      out.push('- ' + rows[i].hhmm + ' ' + rows[i].id + ' · ' + rows[i].type + ' · ' + rows[i].one + (rows[i].evidence ? '（' + rows[i].evidence + '）' : ''))
      used++; i++
    }
  }
  if (i < rows.length) {
    const months = {}
    for (; i < rows.length; i++) { const m = (rows[i].day || '').slice(0, 7) || '未知'; months[m] = (months[m] || 0) + 1 }
    out.push('', '## 按月折叠（更早）')
    for (const m of Object.keys(months).sort().reverse()) out.push('- ' + m + ' · ' + months[m] + ' 条')
  }
  const file = path.join(root, 'INDEX.md')
  ensureDir(root)
  try { fs.writeFileSync(file, out.join('\n') + '\n', 'utf8'); return { ok: true, file, lines: out.length, total: rows.length } } catch (e) { return { ok: false, hint: String((e && e.message) || e) } }
}

export default rebuildMemoryIndex
