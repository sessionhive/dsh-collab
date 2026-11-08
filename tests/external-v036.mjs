#!/usr/bin/env node
/**
 * external-v036.mjs —— v0.1.0 协议 v2 核心（dh058）
 *   v2 frontmatter/task_hash/硬拒绝、状态机事件、权限矩阵、stale、无 legacy 兼容
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.argv.includes('--child')

async function childMain() {
  const steps = []
  const step = (name, ok, extra) => { steps.push({ name, ok: !!ok, ...(extra || {}) }); return ok }
  try {
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') return { list: async () => ({ items: [] }), create: async () => ({ sessionId: 'S-NEW' }), prompt: async () => ({ accepted: true }) }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const store = await import('../lib/store.js')
    const W = await import('../lib/tools/write.js')
    const C = await import('../lib/collab.js')
    const S = await import('../lib/sessions.js')
    const E = await import('../lib/events.js')
    S.configureSessions(ctx)
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    const scene = (id, sid) => ({ id, name: id, panels: [], sessions: [{ panelId: id + '-ai', sessionId: sid }], memoryRoot: 'agents/' + id })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-ORD'), scene('after-end', 'S-AFT'), scene('text', 'S-TXT')], groups: [] })
    const execOrder = { agent: { session: { header: { id: 'S-ORD' } } } }
    const execAfter = { agent: { session: { header: { id: 'S-AFT' } } } }
    const execText = { agent: { session: { header: { id: 'S-TXT' } } } }

    // 建单：v2 frontmatter + hash
    const t1 = await W.wbWrite({ action: 'task', to: 'after-end', task: '实现登录 API', loc: 'go-api/', forbid: '-', accept: 'curl 通过', write_scopes: ['go-api/'], collaborators: ['text'], wake: true }, execOrder)
    step('建单 v2：protocol/task_hash/depends_on/write_scopes/created_at', t1.ok && t1.task_hash && t1.orderId, { t1 })
    const o1 = C.findOrder(t1.orderId)
    step('v2 frontmatter 字段齐全', o1 && o1.frontmatter.protocol === 'v2' && o1.frontmatter.task_hash && o1.frontmatter.created_at && o1.frontmatter.dispatched_at && 'depends_on' in o1.frontmatter && 'write_scopes' in o1.frontmatter)
    // 同 hash 硬拒绝
    const t2 = await W.wbWrite({ action: 'task', to: 'after-end', task: '实现登录 API', write_scopes: ['go-api/'], wake: false }, execOrder)
    step('同 task_hash 未关闭 → 硬拒绝（提示 comment/collaborators）', t2.ok === false && t2.duplicate === true && t2.existing === t1.orderId && /comment/.test(t2.hint) && /collaborators/.test(t2.hint))
    // 不同 scope 允许
    const t3 = await W.wbWrite({ action: 'task', to: 'after-end', task: '实现登录 API', write_scopes: ['other/'], wake: false }, execOrder)
    step('同文本不同 write_scopes 允许', t3.ok === true && t3.orderId !== t1.orderId)

    // delivered（wake 成功自动）
    const evs0 = (await E.readEvents()).filter((e) => e.order_id === t1.orderId)
    step('delivered 自动事件（prompt 成功）', evs0.some((e) => e.type === 'delivered') && evs0.some((e) => e.type === 'dispatch'))

    // progress：assignee 自动 ack
    const p1 = await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '完成路由' }, execAfter)
    const evs1 = (await E.readEvents()).filter((e) => e.order_id === t1.orderId)
    step('progress 成功 + 首次自动补 ack', p1.ok && p1.ackAuto === true && evs1.some((e) => e.type === 'ack') && evs1.some((e) => e.type === 'progress'))
    // comment：collaborator / dispatcher 可
    const c1 = await W.wbWrite({ action: 'comment', orderId: t1.orderId, text: '补充说明' }, execText)
    step('comment 协作者可用（事件 comment）', c1.ok && (await E.readEvents()).some((e) => e.order_id === t1.orderId && e.type === 'comment'))
    // submit：assignee 可、dispatcher 不可
    const sBad = await W.wbWrite({ action: 'submit', orderId: t1.orderId, refs: ['a.js'] }, execOrder)
    const s1 = await W.wbWrite({ action: 'submit', orderId: t1.orderId, note: '提交', refs: [process.env.WB_TEST_ROOT] }, execAfter)
    step('submit 仅 assignee/collaborators（dispatcher 拒绝）', sBad.ok === false && s1.ok === true)
    // verify：dispatcher 可、assignee 不可
    const vBad = await W.wbWrite({ action: 'verify', orderId: t1.orderId, refs: ['x'] }, execAfter)
    const v1 = await W.wbWrite({ action: 'verify', orderId: t1.orderId, note: '通过', refs: [process.env.WB_TEST_ROOT] }, execOrder)
    step('verify 仅 dispatcher（assignee 拒绝）', vBad.ok === false && v1.ok === true)
    const oAfterVerify = C.deriveStatus(C.findOrder(t1.orderId))
    step('状态机 verify → verified', oAfterVerify === 'verified', { state: oAfterVerify })
    // close：assignee 可；done 后缀
    const hcl = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t1.orderId, to: 'text', kind: 'next', note: '交给 text 关单' }, execAfter)
    const cl = await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, execText)
    step('close 成功 + .done.md + close 事件', cl.ok && /\.done\.md$/.test(cl.file) && (await E.readEvents()).some((e) => e.order_id === t1.orderId && e.type === 'close'))

    // stale：delivered 后 >10 分钟无动作
    const t4 = await W.wbWrite({ action: 'task', to: 'after-end', task: 'stale 测试任务', wake: true }, execOrder)
    const m = await C.runCollabMaintenance(Date.now() + 11 * 60000)
    step('stale 可触发（delivered>10min 无动作）', t4.ok && m.stale.indexOf(t4.orderId) >= 0 && (await E.readEvents()).some((e) => e.order_id === t4.orderId && e.type === 'stale'))

    // 无 legacy 兼容：旧单原样留档，不解析不统计
    const legacyDay = path.join(P.COLLAB, '2026-11-07'); fs.mkdirSync(legacyDay, { recursive: true })
    fs.writeFileSync(path.join(legacyDay, 'dh999-legacy.md'), '---\norder_id: dh999\ndispatcher: order\nassignee: after-end\n---\n\n## 派单\n\n**任务**：旧单\n', 'utf8')
    step('旧单（无 protocol:v2）不解析/不统计', C.findOrder('dh999') === null && !C.allOrders().some((o) => o.id === 'dh999'))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv036-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 4000), stderr: String(r.stderr || '').slice(0, 3000) } }
  report.exitCode = r.status
  report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh058-protocol-v2')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v036-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 协议 v2 核心分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
