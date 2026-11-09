/**
 * projection.js —— summary.md 自动投影（契约 §五）+ registry 索引重生成。
 * 规则固定：在做=最近 1 条结论；下一步=最近含「下一步/待办/TODO」的行；
 *          卡点=最近含「卡住/blocked/等」的行；指针=日期 + memory 路径；空则「空闲」。
 */
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { AGENTS, ROOT, TOOLS } from './paths.js'
import { readText, writeAtomic, listFiles, today, nowLocal, statInfo } from './store.js'
import { findScene } from './rules.js'

const MAX_SUMMARY = 2048

function noteFiles(sceneId) {
  const dir = path.join(AGENTS, sceneId, 'memory')
  return listFiles(dir, { recursive: true, limit: 300 })
    .filter((f) => /\.md$/i.test(f) && path.basename(f).toLowerCase() !== 'index.md' && !/\.errors\.md$/i.test(f))
    .sort((a, b) => { const d = statInfo(b).mtime - statInfo(a).mtime; return d !== 0 ? d : String(b).localeCompare(String(a)) })   // 最近写入优先；同 mtime 按路径倒序（日期新优先）
}

function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }

/**
 * 重算某场景 summary.md。
 * @returns {{ok:boolean, file?:string, bytes?:number, sections?:object, error?:string}}
 */
export function recomputeSummary(sceneId) {
  const sc = findScene(sceneId)
  if (!sc) return { ok: false, error: '场景未注册：' + sceneId }
  const files = noteFiles(sc.id).slice(0, 10)
  const conclusions = []
  const nexts = []
  const blocks = []
  for (const f of files) {
    const rel = path.relative(ROOT, f).split(path.sep).join('\\')
    const text = readText(f)
    // C：按 --- 分段，只看最后一段（最新一条结论）；detail 文件也纳入
    const segments = String(text).split(/^\s*---\s*$/m).map((x) => x.trim()).filter(Boolean)
    const body = segments.length ? segments[segments.length - 1] : String(text)
    const lines = body.split(/\r?\n/)
    let fileConclusion = null
    for (const ln of lines) {
      const s = ln.replace(/^[-*>#\s]+/, '').replace(/\*\*/g, '').trim()
      if (!s) continue
      if (/^(结论|summary)[:：]/.test(s)) fileConclusion = clip(s.replace(/^(结论|summary)[:：]\s*/, ''), 180)
      else if (/^(下一步|待办|TODO)[:：]?/i.test(s) && !nexts.length) nexts.push({ s: clip(s.replace(/^(下一步|待办|TODO)[:：]?\s*/i, ''), 160), rel })
      else if (/^(卡点|卡住|blocked|阻塞|等待)[:：]?/i.test(s) && !blocks.length) blocks.push({ s: clip(s.replace(/^(卡点|卡住|blocked|阻塞|等待)[:：]?\s*/i, ''), 160), rel })
    }
    if (!fileConclusion) {
      const first = lines.map((l) => l.trim()).find((l) => l && !/^#/.test(l) && !/^---/.test(l) && !/^(来源|证据|路径|auto:|时间)[:：]/.test(l))
      if (first) fileConclusion = clip(first.replace(/^[-*]\s*/, ''), 180)
    }
    if (fileConclusion) conclusions.push({ s: fileConclusion, rel })
  }
  const date = today()
  const doing = conclusions[0] ? conclusions[0].s : '空闲'
  const next = nexts.length ? nexts[0].s : '（无）'
  const block = blocks.length ? blocks[0].s : '无'
  const memRel = 'agents\\' + sc.id + '\\memory\\' + date + '\\'
  let md = [
    '# ' + (sc.name || sc.id) + ' · 当前状态（' + date + '）',
    '',
    '## 在做',
    '- ' + doing,
    '',
    '## 下一步',
    '- ' + next,
    '',
    '## 卡点',
    '- ' + block,
    '',
    '## 指针',
    '- 最后更新：' + nowLocal(),
    '- 详情：`' + memRel + '`',
    '',
  ].join('\n')
  if (Buffer.byteLength(md, 'utf8') > MAX_SUMMARY) md = md.slice(0, MAX_SUMMARY - 40) + '\n…（超 2KB 已截断）\n'
  const file = path.join(AGENTS, sc.id, 'summary.md')
  writeAtomic(file, md)
  return { ok: true, file, bytes: Buffer.byteLength(md, 'utf8'), sections: { doing, next, block }, sources: conclusions.slice(0, 3).map((x) => x.rel) }
}

/** 跑工具\gen\gen-index.mjs（registry → scene-index 等）；失败不抛 */
export function runGenIndex() {
  const gen = path.join(TOOLS, 'gen', 'gen-index.mjs')
  try {
    const r = spawnSync(process.execPath, [gen], { cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true })
    return { ok: r.status === 0, code: r.status, out: String((r.stdout || '') + (r.stderr || '')).slice(0, 800) }
  } catch (e) {
    return { ok: false, code: -1, out: String((e && e.message) || e) }
  }
}

/** 场景 json 变更后：先把 scenarios 同步进 registry，再生成 scene-index（PRT-013 一致）。
 *  外部 DSH（无 工具\gen 生成器）时跳过，registry 本身就是真源。 */
export function runRegistrySync() {
  const genDir = path.join(TOOLS, 'gen')
  if (!fs.existsSync(path.join(genDir, 'sync-registry.mjs'))) {
    return { ok: true, skipped: true, steps: [{ file: 'gen', ok: true, skipped: true, out: '外部环境无 工具\\gen，跳过生成器（registry 即真源）' }] }
  }
  const steps = []
  for (const f of ['sync-registry.mjs', 'gen-index.mjs']) {
    const p = path.join(genDir, f)
    try {
      const r = spawnSync(process.execPath, [p], { cwd: ROOT, encoding: 'utf8', timeout: 60000, windowsHide: true })
      steps.push({ file: f, ok: r.status === 0, code: r.status, out: String((r.stdout || '') + (r.stderr || '')).slice(0, 500) })
      if (r.status !== 0) return { ok: false, steps }
    } catch (e) {
      steps.push({ file: f, ok: false, error: String((e && e.message) || e) })
      return { ok: false, steps }
    }
  }
  return { ok: true, steps }
}
