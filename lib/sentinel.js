/**
 * sentinel.js —— 定时催办占位（dh032 骨架，可 import，默认不启用）。
 * 只做纯计算：给定阈值返回「该催办」的协作单候选；不启动定时器、不写盘、不唤醒。
 * 真正的定时器由壳/宿主决定；启用前必须先过唤醒预算（budget.canWake）。
 */
import { allOrders } from './collab.js'

/**
 * @param {{now?:number, minutes?:number}} opts
 * @returns {{ok:true, minutes:number, candidates:Array<{id:string, to:string, ageMinutes:number, ref:string}>}}
 */
export function scanOverdue(opts = {}) {
  const minutes = Math.max(1, Number(opts.minutes) || 20)
  const now = Number(opts.now) || Date.now()
  const out = []
  for (const o of allOrders()) {
    if (o.done) continue
    const raw = String(o.frontmatter && (o.frontmatter.dispatched_at || o.frontmatter.created_at) || '')
    const t = raw ? Date.parse(raw) : NaN
    if (!Number.isFinite(t)) continue
    const age = Math.round((now - t) / 60000)
    if (age >= minutes) out.push({ id: o.id, to: String(o.frontmatter.assignee || ''), ageMinutes: age, ref: 'collab/' + o.day + '/' + o.name + '.md' })
  }
  return { ok: true, minutes, candidates: out }
}

export default scanOverdue
