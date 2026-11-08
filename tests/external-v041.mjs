#!/usr/bin/env node
/**
 * external-v041.mjs —— v0.1.0 模拟测试修复（dh065）
 *   flow 自动推导 / SKILL role / close 自动接力 / stale 3min 重唤醒 / seed 流程行
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
  const prompts = []
  try {
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') return {
          list: async () => ({ items: [] }),
          create: async () => ({ sessionId: 'S-NEW' }),
          prompt: async (req) => { prompts.push({ sessionId: String(req && req.sessionId || ''), text: String((req && req.content && req.content[0] && req.content[0].text) || '') }); return { accepted: true } },
        }
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
    const E = await import('../lib/events.js')
    const SEED = await import('../lib/entry-seed.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const scene = (id, sid) => ({ id, name: id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-ORD'), scene('aa', 'S-A'), scene('bb', 'S-B'), scene('cc', 'S-C')], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const eOrder = exec('S-ORD'), eA = exec('S-A'), eB = exec('S-B')

    // A flow 自动推导
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '自动流程任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', collaborators: ['bb', 'cc'], wake: false }, eOrder)
    const o1 = C.findOrder(t1.orderId)
    step('A 有 collaborators 未给 flow → 自动 flow=[assignee,...] + 提示', t1.ok && t1.flowAuto === true && /本单流程：aa → bb → cc → 回 order/.test(t1.flowHint || '') && o1.frontmatter.flow === '[aa, bb, cc]' && /完成后 handoff/.test(t1.flowHint || ''))

    // B SKILL role 三套
    const mk = async (id, sid, role) => { const r = await call('POST', '/plugins/workbench-core/scene', { id, name: id, sessionId: sid, cardRole: role, role: id }); return { r, card: store.readJson(path.join(P.AGENTS, id, 'card.json'), {}), skill: (() => { try { return fs.readFileSync(path.join(P.DSH_HOME, 'skills', id, 'SKILL.md'), 'utf8') } catch (e) { return '' } })() } }
    const mkImpl = await mk('dev2', 'S-ORD', 'implementer')
    const mkTest = await mk('qa2', 'S-ORD', 'tester')
    const mkDisp = await mk('boss2', 'S-ORD', 'dispatcher')
    step('B card.role 忽略 + SKILL 通用规则', mkImpl.r.code === 200 && mkImpl.card.role === undefined && /## 协作规则/.test(mkImpl.skill) && /先 ack/.test(mkImpl.skill) && /禁止 close/.test(mkImpl.skill))
    step('B tester 无角色分支（同一套通用规则）', mkTest.card.role === undefined && /## 协作规则/.test(mkTest.skill) && /最后一棒：转交回主负责人/.test(mkTest.skill) && !/验证后 handoff 回 dispatcher/.test(mkTest.skill))
    step('B dispatcher 无角色分支（同一套通用规则）', mkDisp.card.role === undefined && /## 协作规则/.test(mkDisp.skill) && /主负责人/.test(mkDisp.skill) && !/先查成员/.test(mkDisp.skill))
    step('E seed 有本单流程/不是最后一棒不要 close', /不是最后一棒不要 close/.test(SEED.buildEntrySeed('aa').text) && /本单流程/.test(SEED.buildEntrySeed('aa').text))

    // C close 自动接力
    const t2 = await W.wbWrite({ action: 'task', to: 'aa', task: '接力关闭任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, eOrder)
    const c1 = await W.wbWrite({ action: 'close', orderId: t2.orderId, status: 'done', note: 'aa 完成', refs: [process.env.WB_TEST_ROOT] }, eA)
    const o2 = C.findOrder(t2.orderId)
    step('C 非最后一棒 close → 不关单 + 自动 handoff + warning', c1.ok && c1.relayed === true && c1.to === 'bb' && /不是最后一棒/.test(c1.warning || '') && !o2.done && /current_owner: bb/.test(o2.text) && /## 交接-bb/.test(o2.text) && prompts.some((p) => p.sessionId === 'S-B'))
    const c2 = await W.wbWrite({ action: 'close', orderId: t2.orderId, status: 'done', note: 'bb 完成', refs: [process.env.WB_TEST_ROOT] }, eB)
    step('C 最后一棒 close → 终结 + receipt', c2.ok && c2.relayed !== true && C.findOrder(t2.orderId).done && (await E.readEvents()).some((e) => e.order_id === t2.orderId && e.type === 'receipt'), { c2 })

    // D stale 3 分钟 + 重唤醒一次 + 再次通知
    const t3 = await W.wbWrite({ action: 'task', to: 'aa', task: 'stale 任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', wake: true }, eOrder)
    step('D 建单已 delivered', t3.ok && (await E.readEvents()).some((e) => e.order_id === t3.orderId && e.type === 'delivered'))
    const m1 = await C.runCollabMaintenance(Date.now() + 4 * 60000)
    const ev1 = await E.readEvents()
    step('D 3 分钟无 ack → stale + 重唤醒一次', m1.stale.includes(t3.orderId) && ev1.some((e) => e.order_id === t3.orderId && e.type === 'stale' && e.retry === 0) && ev1.some((e) => e.order_id === t3.orderId && e.type === 'wake' && e.reason === 'stale-retry') && prompts.some((p) => /重唤醒/.test(p.text)))
    const m2 = await C.runCollabMaintenance(Date.now() + 7 * 60000)
    step('D 重唤醒后仍无响应 → 再次通知', (await E.readEvents()).some((e) => e.order_id === t3.orderId && e.type === 'stale' && e.retry === 2) && prompts.some((p) => /再次通知/.test(p.text)), { m2 })
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv041-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh065-sim-fixes')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v041-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 模拟修复分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
