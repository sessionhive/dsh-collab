#!/usr/bin/env node
/**
 * external-v038.mjs —— v0.1.0 协议闭环（dh061）
 *   schema 注册表/outgoing/close 回执/flow+handoff+takeover/打回/段头/权限
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
          prompt: async (req) => {
            const sid = String((req && req.sessionId) || '')
            const text = String((req && req.content && req.content[0] && req.content[0].text) || '')
            prompts.push({ sessionId: sid, text })
            return { accepted: true }
          },
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
    const R = await import('../lib/tools/read.js')
    const C = await import('../lib/collab.js')
    const SCH = await import('../lib/tools/schema.js')
    const E = await import('../lib/events.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    // schema 注册表
    const names = SCH.WRITE_ACTIONS.map((a) => a.name)
    const params = SCH.writeParameters()
    step('schema 注册表暴露 10+ action（含 handoff）', ['note', 'progress', 'comment', 'task', 'submit', 'verify', 'reject', 'close', 'cancel', 'reopen', 'handoff'].every((x) => names.includes(x)), { names })
    step('v2 参数在 schema 中（depends_on/write_scopes/collaborators/force/slug/group）', ['depends_on', 'write_scopes', 'collaborators', 'force', 'slug', 'group'].every((k) => !!params[k]))
    const rt = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'runtime.js'), 'utf8')
    step('runtime 由 schema 生成工具参数（单一真源）', rt.indexOf('writeParameters()') >= 0 && rt.indexOf('writeDescription()') >= 0 && rt.indexOf('READ_PARAMS') >= 0)

    const scene = (id, sid) => ({ id, name: id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-ORD'), scene('after-end', 'S-AFT'), scene('text', 'S-TXT')], groups: [] })
    const execOrder = { agent: { session: { header: { id: 'S-ORD' } } } }
    const execAfter = { agent: { session: { header: { id: 'S-AFT' } } } }
    const execText = { agent: { session: { header: { id: 'S-TXT' } } } }

    // 建单（flow 两棒）
    const t1 = await W.wbWrite({ action: 'task', to: 'after-end', task: '接力任务', write_scopes: ['x/'], flow: ['after-end', 'text'], wake: false }, execOrder)
    const o1 = C.findOrder(t1.orderId)
    step('建单含 flow/current_owner', t1.ok && /flow: \[after-end, text\]/.test(o1.text) && /current_owner: after-end/.test(o1.text))
    // outgoing（dispatcher 视角）
    const br = await R.wbRead({ action: 'board' }, execOrder)
    step('wb_read(board) 返回 outgoing（我派出的单+状态）', br.ok && Array.isArray(br.outgoing) && br.outgoing.some((o) => o.id === t1.orderId && o.state && o.assignee === 'after-end'))

    // 权限：dispatcher 不能 progress；非 current 不能 handoff
    const pDenied = await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '越界' }, execOrder)
    const hDenied = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t1.orderId, to: 'text', kind: 'next' }, execText)
    step('权限：只有 current_owner 能 progress/handoff', pDenied.ok === false && hDenied.ok === false)

    // 交接 next → text，自动唤醒
    const h1 = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t1.orderId, to: 'text', kind: 'next', note: '交给文案', refs: [process.env.WB_TEST_ROOT] }, execAfter)
    const o2 = C.findOrder(t1.orderId)
    step('handoff next：切换 current_owner + 段头 ## 交接-text + 唤醒', h1.ok && h1.current_owner === 'text' && /current_owner: text/.test(o2.text) && o2.text.indexOf('## 交接-text') >= 0 && prompts.some((p) => p.sessionId === 'S-TXT'))
    // 下一棒首个 progress：自动 takeover + 段头
    const p2 = await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '接管开工' }, execText)
    const o3 = C.findOrder(t1.orderId)
    step('下一棒首个 progress 自动 takeover + ## 接管-text', p2.ok && p2.takeover === true && o3.text.indexOf('## 接管-text') >= 0 && (await E.readEvents()).some((e) => e.order_id === t1.orderId && e.type === 'takeover'))
    // 打回 back → after-end
    const h2 = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t1.orderId, kind: 'back', note: '退回修改' }, execText)
    const o4 = C.findOrder(t1.orderId)
    step('handoff back 回上一棒（after-end）并唤醒', h2.ok && h2.to === 'after-end' && /current_owner: after-end/.test(o4.text) && o4.text.indexOf('## 交接-after-end') >= 0 && prompts.some((p) => p.sessionId === 'S-AFT'))
    // 验收段头 + close 回执 dispatcher
    await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '修正完成' }, execAfter)
    const v = await W.wbWrite({ action: 'verify', orderId: t1.orderId, note: '通过', refs: [process.env.WB_TEST_ROOT] }, execOrder)
    const hcl = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t1.orderId, to: 'text', kind: 'next', note: '交最后一棒关单' }, execAfter)
    const cl = await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, execText)
    const doneText = C.findOrder(t1.orderId).text
    const evs = await E.readEvents()
    step('单文档段头：## 派单 / ## 接管- / ## 交接- / ## 验收 / ## 终态', ['## 派单', '## 接管-after-end', '## 交接-text', '## 交接-after-end', '## 验收', '## 终态'].every((h) => doneText.indexOf(h) >= 0), { heads: ['## 派单', '## 接管-after-end', '## 交接-text', '## 交接-after-end', '## 验收', '## 终态'].filter((h) => doneText.indexOf(h) >= 0) })
    step('close 写 receipt 事件 + 唤醒 dispatcher（一行摘要+refs）', v.ok && cl.ok && evs.some((e) => e.order_id === t1.orderId && e.type === 'receipt' && e.status === 'done' && Array.isArray(e.refs)) && prompts.some((p) => p.sessionId === 'S-ORD' && /【回执】/.test(p.text)))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv038-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh061-protocol-loop')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v038-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 协议闭环分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
