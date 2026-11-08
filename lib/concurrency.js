/**
 * concurrency.js —— 并发/版本检测 + stale 自动重试（dh046）。
 *   - writeTextGuarded：写前记 hash，写完校验；被并发改动 → 重读合并重试一次，再失败返回 stale（不静默覆盖）
 *   - writeJsonGuarded：写前比对 expectedHash；被外部改动 → 写 events 的 type=concurrent-change 事件并返回 concurrent 提示
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { writeAtomic, ensureDir } from './store.js'
import { logEvent } from './events.js'

export function hashText(text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text), 'utf8').digest('hex')
}

export function hashFile(file) {
  try { return hashText(fs.readFileSync(file, 'utf8')) } catch (e) { return '' }
}

function readFileText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (e) { return '' }
}

export async function logConcurrentChange(file, reason, extra = {}) {
  try { await logEvent({ type: 'concurrent-change', file: String(file), reason: String(reason || ''), ...extra }) } catch (e) { /* 事件失败不阻断 */ }
}

/**
 * 文本写 + stale 检测/自动重试一次。
 * @param {string} file
 * @param {(existing:string, attempt:number)=>string} build 基于“当前内容”生成新内容（重试时会重新调用）
 * @param {{reason?:string, retries?:number, onBeforeCommit?:(attempt:number,file:string)=>void}} opts
 * @returns {{ok:boolean, stale?:boolean, retried?:boolean, bytes?:number, reason?:string}}
 */
export async function writeTextGuarded(file, build, opts = {}) {
  const retries = Number.isInteger(opts.retries) ? opts.retries : 1
  const reason = String(opts.reason || 'wb_write')
  for (let attempt = 0; attempt <= retries; attempt++) {
    const existing = readFileText(file)
    const beforeHash = hashText(existing)
    const next = String(await build(existing, attempt))
    // 测试/极端场景钩子：build 与落盘之间被别的进程改文件
    try { if (typeof opts.onBeforeCommit === 'function') opts.onBeforeCommit(attempt, file) } catch (e) { /* ignore */ }
    const current = readFileText(file)
    if (hashText(current) !== beforeHash) continue // 被并发改动 → 重读合并重试
    ensureDir(path.dirname(file))
    writeAtomic(file, next)
    const after = readFileText(file)
    if (after === next) return { ok: true, retried: attempt > 0, bytes: Buffer.byteLength(next, 'utf8') }
  }
  await logConcurrentChange(file, reason, { stale: true })
  return { ok: false, stale: true, reason: '文件被并发改动（' + reason + '）：已重读合并重试一次仍失败，未覆盖写入；请稍后重试' }
}

/**
 * JSON 写 + 版本检测：expectedHash 不匹配（被外部改动）→ 不写、记 concurrent-change 事件、返回 concurrent 提示。
 * @returns {{ok:boolean, concurrent?:boolean, reason?:string}}
 */
export async function writeJsonGuarded(file, obj, { expectedHash, reason } = {}) {
  const cur = hashFile(file)
  if (expectedHash != null && cur !== expectedHash) {
    await logConcurrentChange(file, reason || 'json-write', { expected: String(expectedHash).slice(0, 12), actual: cur.slice(0, 12) })
    return { ok: false, concurrent: true, reason: '文件被外部改动（' + pathBase(file) + '），本次写入已取消；请刷新后重试' }
  }
  writeAtomic(file, JSON.stringify(obj, null, 2) + '\n')
  return { ok: true }
}

/** 同步版 JSON 写 + 版本检测（事件异步写，不阻塞调用方） */
export function writeJsonGuardedSync(file, obj, { expectedHash, reason } = {}) {
  const cur = hashFile(file)
  if (expectedHash != null && cur !== expectedHash) {
    try { logConcurrentChange(file, reason || 'json-write', { expected: String(expectedHash).slice(0, 12), actual: cur.slice(0, 12) }) } catch (e) { /* ignore */ }
    return { ok: false, concurrent: true, reason: '文件被外部改动（' + pathBase(file) + '），本次写入已取消；请刷新后重试' }
  }
  writeAtomic(file, JSON.stringify(obj, null, 2) + '\n')
  return { ok: true }
}

function pathBase(p) { return String(p || '').split(/[\\/]/).pop() || String(p || '') }
