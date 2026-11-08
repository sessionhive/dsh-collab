/**
 * store.js —— 落盘公共件：原子写 / 加锁追加 / 读 JSON。
 * 铁律（契约 §四）：先写临时文件再 rename；JSONL 追加本进程串行 + 跨进程 lockfile。
 */
import fs from 'node:fs'
import path from 'node:path'

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p }
export function exists(p) { try { return fs.existsSync(p) } catch (e) { return false } }
export function readText(p) { try { return fs.readFileSync(p, 'utf8') } catch (e) { return '' } }
export function readJson(p, fallback = null) {
  const t = readText(p)
  if (!t) return fallback
  try { return JSON.parse(t.replace(/^\uFEFF/, '')) } catch (e) { return fallback }
}
export function writeAtomic(p, text) {
  ensureDir(path.dirname(p))
  const tmp = p + '.tmp-' + process.pid + '-' + Date.now()
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, p)
}
export function writeJson(p, obj) { writeAtomic(p, JSON.stringify(obj, null, 2) + '\n') }

/** 本进程串行队列：同一文件的追加不交错 */
const chains = new Map()
function enqueue(key, fn) {
  const prev = chains.get(key) || Promise.resolve()
  const next = prev.then(fn, fn)
  chains.set(key, next.catch(() => { }))
  return next
}

/** 跨进程 lockfile（拿不到锁重试 ~2s；本机并发很小，失败就退化成本进程串行） */
async function withLockFile(file, fn) {
  const lock = file + '.lock'
  const t0 = Date.now()
  for (; ;) {
    try {
      const fd = fs.openSync(lock, 'wx')
      try { fs.writeSync(fd, String(process.pid)) } catch (e) { /* ignore */ }
      fs.closeSync(fd)
      break
    } catch (e) {
      if (e && e.code !== 'EEXIST') break
      if (Date.now() - t0 > 2000) break
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 40)))
    }
  }
  try { return await fn() } finally { try { fs.unlinkSync(lock) } catch (e) { /* ignore */ } }
}

export function appendLine(file, text) {
  return enqueue(file, () => withLockFile(file, async () => {
    ensureDir(path.dirname(file))
    fs.appendFileSync(file, text.endsWith('\n') ? text : text + '\n', 'utf8')
  }))
}

/** 读 JSONL（坏行跳过） */
export function readJsonl(file) {
  return readText(file).split(/\r?\n/).filter((l) => l.trim().startsWith('{')).map((l) => {
    try { return JSON.parse(l) } catch (e) { return null }
  }).filter(Boolean)
}

export function listFiles(dir, { recursive = false, limit = 500 } = {}) {
  const out = []
  const walk = (d, depth) => {
    if (out.length >= limit) return
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch (e) { return }
    for (const ent of ents) {
      if (out.length >= limit) return
      const full = path.join(d, ent.name)
      if (ent.isDirectory()) { if (recursive && depth < 4) walk(full, depth + 1) } else out.push(full)
    }
  }
  walk(dir, 0)
  return out
}

export function statInfo(p) {
  try { const st = fs.statSync(p); return { ok: true, size: st.size, mtime: Math.floor(st.mtimeMs / 1000), isDir: st.isDirectory() } } catch (e) { return { ok: false, size: 0, mtime: 0, isDir: false } }
}

export const pad2 = (n) => String(n).padStart(2, '0')
export const nowIso = () => new Date().toISOString()
export function nowLocal(d = new Date()) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
export function hm(d = new Date()) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
export function today(d = new Date()) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
export const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
