#!/usr/bin/env node
/**
 * workbench-core 契约测试（沙箱跑，不碰真实数据）
 *   node 插件\workbench-core\tests\run.mjs
 *
 * 做法：在 工作区\_临时\wb-core-test-<pid>\ 里搭一个假工作台（外壳/引擎数据/.dsh），
 * 通过 DSH_WORKBENCH_ROOT + DSH_SHELL_DIR 指过去，再动态 import 插件 lib；
 * 逐条跑派单 dh026 / 契约 §八 的拒绝与通过用例。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const REAL = 'D:\\ChengXu\\Ai\\Workbench'
const SB = path.join(REAL, '工作区', '_临时', 'wb-core-test-' + process.pid)
const DSH = path.join(SB, '引擎数据', '.dsh')
const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') })()

function mk(p) { fs.mkdirSync(p, { recursive: true }) }
function w(p, t) { mk(path.dirname(p)); fs.writeFileSync(p, t, 'utf8') }
function wj(p, o) { w(p, JSON.stringify(o, null, 2) + '\n') }
function rd(p) { try { return fs.readFileSync(p, 'utf8') } catch (e) { return '' } }

// ---- 沙箱骨架 ----
fs.rmSync(SB, { recursive: true, force: true })
mk(path.join(SB, '外壳', 'scenarios'))
mk(path.join(SB, '工具', 'gen'))
mk(path.join(DSH, '_meta'))
mk(path.join(DSH, 'agents'))
mk(path.join(DSH, 'collab'))
mk(path.join(DSH, 'events'))
mk(path.join(DSH, 'blackboard'))
mk(path.join(DSH, 'shared', 'env'))
mk(path.join(DSH, 'constitution', 'current'))
mk(path.join(DSH, 'storages'))   // paths.js 用 storages 判定 DSH_HOME，沙箱要有
wj(path.join(DSH, 'events', 'counter.json'), { last_order_seq: 10 })
w(path.join(DSH, 'events', 'events.jsonl'), '')
w(path.join(DSH, 'events', 'dispatch.jsonl'), '')
w(path.join(DSH, 'events', 'violations.jsonl'), '')
wj(path.join(DSH, '_meta', 'config.json'), { budget: { wakePerScenePerDay: 3 }, handover: { warnContextTokens: 60000, contextThresholdTokens: 120000 } })
wj(path.join(DSH, '_meta', 'registry.json'), {
  scenes: [
    { id: 'demo', name: '演示', panels: [{ panelId: 'demo-ai', type: 'harness' }], sessions: [{ panelId: 'demo-ai', sessionId: 'S-DEMO', title: '演示' }], skill: 'demo', memoryRoot: 'agents/demo', summary: 'agents/demo/summary.md' },
    { id: 'other', name: '另一个', panels: [{ panelId: 'other-ai', type: 'harness' }], sessions: [{ panelId: 'other-ai', sessionId: 'S-OTHER', title: '另一个' }], skill: 'other' },
    { id: 'third', name: '第三方', panels: [{ panelId: 'third-ai', type: 'harness' }], sessions: [{ panelId: 'third-ai', sessionId: 'S-THIRD', title: '第三方' }], skill: 'third' },
  ],
  projects: [],
})
w(path.join(DSH, 'constitution', 'current', 'INV-001.md'), '---\nid: INV-001\nsection: 6\ntitle: 写结论必须带来源\n---\n\n# INV-001\n\n写任何结论必须附来源（文件路径、命令输出或链接）；无来源不得写入。\n')
w(path.join(DSH, 'constitution', 'current', 'PRT-004.md'), '---\nid: PRT-004\nsection: 2\ntitle: 只记实质工作\n---\n\n# PRT-004\n\n只记实质工作；单文件 ≤2KB。\n')
wj(path.join(DSH, 'agents', 'demo', 'card.json'), { schemaVersion: 1, id: 'demo', name: '演示' })
w(path.join(DSH, 'agents', 'demo', 'summary.md'), '# 演示 · 当前状态\n\n## 在做\n- 空闲\n')
wj(path.join(SB, '外壳', 'scenarios', 'demo.json'), { id: 'demo', name: '演示', panels: [] })
w(path.join(SB, '工具', 'gen', 'gen-index.mjs'), 'process.exit(0)\n')

process.env.DSH_WORKBENCH_ROOT = SB
process.env.DSH_SHELL_DIR = path.join(SB, '外壳')
process.env.DSH_CUSTOMER_HOME = ''
process.env.DSH_HOME = ''

const results = []
function check(name, cond, extra = '') { results.push({ name, ok: !!cond, extra: String(extra || '').slice(0, 200) }); console.log((cond ? '✓ ' : '✗ ') + name + (extra ? '  · ' + String(extra).slice(0, 160) : '')) }

const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })

const { wbRead } = await import('../lib/tools/read.js')
const { wbWrite } = await import('../lib/tools/write.js')
const { canWake } = await import('../lib/budget.js')
const { findOrder, allOrders, markInterruptedBySession, deriveStatus } = await import('../lib/collab.js')
const { logEvent } = await import('../lib/events.js')
const { writeGroups } = await import('../lib/groups.js')

try {
  // 1) note：空 refs → INV-001 + violations
  let r = await wbWrite({ action: 'note', scene: 'demo', text: '结论：测试', refs: [] }, exec('S-DEMO'))
  check('note 空 refs 拒绝 INV-001', r.ok === false && r.rule === 'INV-001', JSON.stringify(r))
  check('violations.jsonl 已记录', rd(path.join(DSH, 'events', 'violations.jsonl')).includes('INV-001'))

  // 2) note：超 2KB → PRT-004
  r = await wbWrite({ action: 'note', scene: 'demo', text: '结论：' + 'x'.repeat(2600), refs: [path.join(REAL, '说明', '多AI协作.md')] }, exec('S-DEMO'))
  check('note 超 2KB 拒绝 PRT-004', r.ok === false && r.rule === 'PRT-004', JSON.stringify(r))

  // 3) note：写别人场景 → BND-002（调用方 S-DEMO 属于 demo）
  r = await wbWrite({ action: 'note', scene: 'other', text: '结论：越界', refs: [path.join(REAL, '说明', '多AI协作.md')] }, exec('S-DEMO'))
  check('note 只能写自己场景 BND-002', r.ok === false && r.rule === 'BND-002', JSON.stringify(r))

  // 4) note：合法写入 → 文件 + summary 投影 ≤2KB
  const ref = path.join(REAL, '说明', '多AI协作.md')
  r = await wbWrite({ action: 'note', scene: 'demo', orderId: 'dh999', text: '结论：沙箱写入成功（测试用）\n下一步：无', refs: [ref] }, exec('S-DEMO'))
  const noteFile = path.join(DSH, 'agents', 'demo', 'memory', today, 'dh999.md')
  const sum = rd(path.join(DSH, 'agents', 'demo', 'summary.md'))
  check('note 合法写入（文件存在）', r.ok === true && fs.existsSync(noteFile), JSON.stringify(r))
  check('note 后 summary 自动投影且 ≤2KB', sum.includes('沙箱写入成功') && Buffer.byteLength(sum, 'utf8') <= 2048, 'bytes=' + Buffer.byteLength(sum, 'utf8'))

  // 5) task：建单五件套 + dispatch 事件
  r = await wbWrite({ action: 'task', to: 'demo', task: '沙箱任务 A', loc: '插件\\workbench-core', forbid: '引擎\\', accept: '测试通过' }, exec('S-OTHER'))
  const ord = r.ok ? findOrder(r.orderId) : null
  check('task 建单成功', r.ok === true && !!ord, JSON.stringify(r))
  check('协作单五件套齐全（v0.1.0 模板）', !!ord && /【派单 /.test(ord.text) && /交付物：/.test(ord.text) && /验收：/.test(ord.text) && /约束：/.test(ord.text) && /证据：/.test(ord.text) && /流程：/.test(ord.text))
  check('dispatch 事件已落', rd(path.join(DSH, 'events', 'dispatch.jsonl')).includes(r.orderId || '___'))

  // 6) task：同任务二次派单 → v2 硬拒绝（同 task_hash）
  const r2 = await wbWrite({ action: 'task', to: 'demo', task: '沙箱任务 A', loc: 'x', forbid: 'y', accept: 'z' }, exec('S-OTHER'))
  check('同任务二次派单硬拒绝（task_hash）', r2.ok === false && r2.duplicate === true && r2.existing === r.orderId, r2.hint || '')

  // 6.5) 分组：task 协作单自动标注「分组」（dh027）
  const gw = writeGroups([{ id: 'g1', name: '测试组', note: '', members: ['demo'] }])
  check('分组保存（成员=场景）', gw.ok === true && gw.sceneGroup.demo === 'g1')
  const rg = await wbWrite({ action: 'task', to: 'demo', task: '沙箱分组任务', loc: 'x', forbid: 'y', accept: 'z' }, exec('S-OTHER'))
  const gord = rg.ok ? findOrder(rg.orderId) : null
  check('task 协作单带「分组」标注', !!gord && gord.text.indexOf('**分组**：测试组（g1）') >= 0, gord ? 'ok' : JSON.stringify(rg))

  // 6.6) dh035：blocked 不关单 → reopen → cancel 权限/原因/.cancelled.md → interrupted 标记
  const rb0 = await wbWrite({ action: 'task', to: 'demo', task: '沙箱阻塞任务', loc: 'x', forbid: 'y', accept: 'z' }, exec('S-OTHER'))
  const bid = rb0.orderId
  let rbl = await wbWrite({ action: 'close', orderId: bid, status: 'blocked', note: '等接口' }, exec('S-DEMO'))
  let bo = findOrder(bid)
  check('blocked：不写终态、保持 open + 追加阻塞记录', rbl.ok === true && rbl.status === 'blocked' && !!bo && bo.state === 'open' && bo.text.indexOf('阻塞：等接口') >= 0 && deriveStatus(bo) === 'blocked', JSON.stringify(rbl))
  check('blocked：文件仍是 .md（非 .done/.cancelled）', !!bo && /\.md$/.test(bo.file) && !bo.done)
  const rre = await wbWrite({ action: 'reopen', orderId: bid, note: '接口好了' }, exec('S-DEMO'))
  bo = findOrder(bid)
  check('reopen：blocked → open（记录+事件）', rre.ok === true && !!bo && deriveStatus(bo) === 'open' && bo.text.indexOf('恢复：接口好了') >= 0, JSON.stringify({ rre, status: bo && deriveStatus(bo), tail: bo && bo.text.slice(-160) }))
  let rcn = await wbWrite({ action: 'cancel', orderId: bid }, exec('S-DEMO'))
  check('cancel：缺原因拒绝', rcn.ok === false, JSON.stringify(rcn))
  rcn = await wbWrite({ action: 'cancel', orderId: bid, note: '不做了' }, exec('S-THIRD'))
  check('cancel：非 dispatcher/assignee/host 拒绝', rcn.ok === false && rcn.rule === 'PRT-005', JSON.stringify(rcn))
  rcn = await wbWrite({ action: 'cancel', orderId: bid, note: '需求取消' }, exec('S-DEMO'))
  bo = findOrder(bid)
  check('cancel：assignee 通过 + .cancelled.md', rcn.ok === true && rcn.status === 'cancelled' && !!bo && bo.state === 'cancelled' && /\.cancelled\.md$/.test(bo.file), JSON.stringify(rcn))
  check('cancel：receipt(cancelled) 事件已落', rd(path.join(DSH, 'events', 'events.jsonl')).includes('"status":"cancelled"'))
  const rint0 = await wbWrite({ action: 'task', to: 'demo', task: '沙箱中断任务', loc: 'x', forbid: 'y', accept: 'z' }, exec('S-OTHER'))
  const iid = rint0.orderId
  const intRes = await markInterruptedBySession('S-DEMO', '中断测试')
  const io = findOrder(iid)
  check('interrupted：会话中断标记 open 单', intRes.ok === true && intRes.marked.indexOf(iid) >= 0 && !!io && io.text.indexOf('中断：') >= 0 && deriveStatus(io) === 'interrupted', JSON.stringify({ intRes, status: io && deriveStatus(io) }))
  check('interrupted：events.jsonl 有 interrupted 事件', rd(path.join(DSH, 'events', 'events.jsonl')).includes('"type":"interrupted"'))

  // 7) record：非成员拒绝；assignee 通过
  const oid = r.orderId
  let rr = await wbWrite({ action: 'record', orderId: oid, line: '越界记录' }, exec('S-THIRD'))
  // S-THIRD 不属于 dispatcher/assignee/collaborators ⇒ 拒绝
  check('record 非成员拒绝 PRT-005', rr.ok === false && rr.rule === 'PRT-005', JSON.stringify(rr))
  rr = await wbWrite({ action: 'record', orderId: oid, line: '接单（沙箱）' }, exec('S-DEMO'))
  check('record assignee 通过', rr.ok === true, JSON.stringify(rr))

  // 8) close：非 assignee/dispatcher 拒绝；证据缺失拒绝；assignee 通过 → .done.md + receipt
  let rc = await wbWrite({ action: 'close', orderId: oid, status: 'done', note: '结论：完成', refs: [ref] }, exec('S-THIRD'))
  check('close 非 assignee/dispatcher 拒绝', rc.ok === false && rc.rule === 'PRT-005', JSON.stringify(rc))
  rc = await wbWrite({ action: 'close', orderId: oid, status: 'done', note: '结论：完成', refs: [] }, exec('S-DEMO'))
  check('close 缺证据拒绝 PRT-001', rc.ok === false && rc.rule === 'PRT-001', JSON.stringify(rc))
  rc = await wbWrite({ action: 'close', orderId: oid, status: 'done', note: '结论：沙箱完成', refs: [ref] }, exec('S-DEMO'))
  check('close assignee 通过 + .done.md', rc.ok === true && !!findOrder(oid) && findOrder(oid).done, JSON.stringify(rc))
  check('close 事件已落（v2 close）', rd(path.join(DSH, 'events', 'events.jsonl')).includes('"type":"close"'))

  // 9) 唤醒闸已取消（v0.2.11）：保留统计，不再拒绝
  for (let i = 0; i < 3; i++) await logEvent({ type: 'wake', to: 'demo', status: 'ok' })
  const b1 = canWake('demo')
  check('唤醒闸取消：仅统计（used>=3 仍 ok）', b1.ok === true && b1.used >= 3 && b1.gate === 'disabled', JSON.stringify(b1))
  check('唤醒闸取消：无 limit 门禁', b1.limit === null)

  // 10) read：scene / order / board
  const rs = await wbRead({ action: 'scene', scene: 'demo' })
  check('wb_read(scene) 返回 card/summary/memory', rs.ok === true && rs.summary.length > 0 && Array.isArray(rs.memory))
  const ro = await wbRead({ action: 'order', id: oid })
  check('wb_read(order) 返回全文+事件', ro.ok === true && ro.text.includes('沙箱完成') && ro.events.length > 0)
  const rb = await wbRead({ action: 'board' })
  check('wb_read(board) 返回看板字段', rb.ok === true && Array.isArray(rb.scenes) && rb.orders && rb.events)
  const rsearch = await wbRead({ action: 'search', q: '沙箱', limit: 5 })
  check('wb_read(search) grep 命中 + [{path,one_line,refs}]', rsearch.ok === true && rsearch.hits.length > 0 && rsearch.hits.every((h) => h.path && h.one_line && Array.isArray(h.refs)))
  const rsearch2 = await wbRead({ action: 'search', q: '不存在的关键词zzz', limit: 5 })
  check('wb_read(search) 无命中返回空数组', rsearch2.ok === true && rsearch2.hits.length === 0)

  // 11) 敏感词 → BND-005
  const rsens = await wbWrite({ action: 'note', scene: 'demo', text: '结论：配置 api_key: sk-abcdefghijklmnopqrstu', refs: [ref] }, exec('S-DEMO'))
  check('敏感词拒绝 BND-005', rsens.ok === false && rsens.rule === 'BND-005', JSON.stringify(rsens))
} finally {
  const bad = results.filter((x) => !x.ok)
  console.log('\n' + (bad.length ? '✗ ' + bad.length + ' 条失败 / ' : '✓ 全部通过 / ') + results.length + ' 条')
  fs.writeFileSync(path.join(SB, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8')
  try { fs.rmSync(SB, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(bad.length ? 1 : 0)
}
