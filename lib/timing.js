/**
 * timing.js —— 协作单耗时指标（v0.3.x 第一批 dh073）
 *   事件/frontmatter → 排队、开工延迟、各棒耗时、总时长。
 */
function t(v) { const x = Date.parse(String(v || '')); return Number.isFinite(x) ? x : 0 }

export function computeTiming(order, events) {
  const fm = (order && order.frontmatter) || {}
  const evs = (events || []).filter((e) => String(e.order_id || '') === String(order.id || '')).slice().sort((a, b) => t(a.ts) - t(b.ts))
  const dispatched = t(fm.dispatched_at) || t(fm.created_at) || (evs.find((e) => e.type === 'dispatch') ? t(evs.find((e) => e.type === 'dispatch').ts) : 0)
  const delivered = t((evs.filter((e) => e.type === 'delivered').slice(-1)[0] || {}).ts)
  const ack = t((evs.find((e) => e.type === 'ack') || {}).ts)
  const firstProg = t((evs.find((e) => e.type === 'progress') || {}).ts)
  const started = t(fm.started_at) || ack || firstProg
  const submit = t(fm.submit_at) || t((evs.find((e) => e.type === 'submit') || {}).ts)
  const verify = t(fm.verify_at) || t((evs.find((e) => e.type === 'verify') || {}).ts)
  const close = t(fm.close_at) || t((evs.find((e) => e.type === 'close') || {}).ts)
  const handoffs = evs.filter((e) => e.type === 'handoff').map((e) => ({ ts: t(e.ts), from: e.from || '', to: e.to || '', kind: e.kind || '', reason: e.reason || '' }))
  const flow = String(fm.flow || '').replace(/[\[\]]/g, '').split(',').map((x) => x.trim()).filter(Boolean)
  const end = close || Date.now()
  const sticks = []
  let curStart = started || delivered || dispatched
  let curOwner = String(fm.assignee || flow[0] || '')
  for (const h of handoffs) {
    sticks.push({ owner: curOwner, started_at: curStart ? new Date(curStart).toISOString() : '', handoff_at: h.ts ? new Date(h.ts).toISOString() : '', duration_ms: curStart && h.ts ? h.ts - curStart : null, to: h.to })
    if (h.to) curOwner = h.to
    curStart = h.ts || curStart
  }
  const currentOwner = String(fm.current_owner || fm.assignee || curOwner)
  sticks.push({ owner: currentOwner, started_at: curStart ? new Date(curStart).toISOString() : '', handoff_at: close ? new Date(close).toISOString() : '', duration_ms: curStart ? end - curStart : null, to: '' })
  const ms = (a, b) => (a && b && b >= a ? b - a : null)
  return {
    dispatched_at: dispatched ? new Date(dispatched).toISOString() : String(fm.dispatched_at || ''),
    delivered_at: delivered ? new Date(delivered).toISOString() : '',
    started_at: started ? new Date(started).toISOString() : '',
    submit_at: submit ? new Date(submit).toISOString() : '',
    handoff_at: handoffs.length ? new Date(handoffs[handoffs.length - 1].ts).toISOString() : '',
    verify_at: verify ? new Date(verify).toISOString() : '',
    close_at: close ? new Date(close).toISOString() : '',
    durations: {
      queue_ms: delivered ? ms(dispatched, delivered) : ms(dispatched, started),
      start_delay_ms: delivered ? ms(delivered, started) : ms(dispatched, started),
      work_ms: ms(started, submit || end),
      submit_to_verify_ms: ms(submit, verify),
      verify_to_close_ms: ms(verify, close),
      total_ms: ms(dispatched, close || Date.now()),
    },
    sticks,
    handoff_count: handoffs.length,
    flow,
    current_owner: currentOwner,
  }
}

export default computeTiming
