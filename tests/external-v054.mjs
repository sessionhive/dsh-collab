#!/usr/bin/env node
/** external-v054.mjs —— dh079 学习机制优化（0.1.0） */
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
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return { list: async () => ({ items: [] }), create: async () => ({ sessionId: 'S-NEW' }), prompt: async () => ({ accepted: true }) }
        if (n === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const L = await import('../lib/learn.js'); const E = await import('../lib/events.js')
    const W = await import('../lib/tools/write.js'); const C = await import('../lib/collab.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('F 版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-A' }] }, { id: 'bb', name: 'BB', sessions: [{ sessionId: 'S-B' }] }, { id: 'order', name: 'O', sessions: [{ sessionId: 'S-O' }] }], groups: [] })
    { const c0 = store.readJson(P.CONFIG, {}); c0.learn = Object.assign({}, c0.learn || {}, { autoApply: true }); store.writeJson(P.CONFIG, c0) }
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })

    // A 多跳按单
    const fakeOrders = [{ id: 'dh001', frontmatter: { flow: '[aa, bb, order]' } }, { id: 'dh002', frontmatter: { flow: '[aa]' } }]
    const ev2 = [{ type: 'handoff', order_id: 'dh001' }, { type: 'handoff', order_id: 'dh001' }]
    const mh2 = L.multiHopStats(ev2, fakeOrders)
    const ev3 = ev2.concat([{ type: 'handoff', order_id: 'dh001' }, { type: 'handoff', order_id: 'dh001' }])
    const mh3 = L.multiHopStats(ev3, fakeOrders)
    step('A 正常三棒（2 次 handoff）不判多跳', mh2.length === 0, { mh2 })
    step('A 超出 flow.length−1 才计多跳', mh3.length === 1 && mh3[0].id === 'dh001' && mh3[0].excess === 2, { mh3 })

    // D 分类 rule_id 优先 + 成功 close/verify 不入信号
    const cases = [['PRT-001', '缺证据'], ['BND-002', '越权写'], ['INV-005', '越权写'], ['PRT-012', '身份错'], ['PRT-002', '交接']]
    const cls = cases.every(([rule, want]) => L.classify({ type: 'violation', rule_id: rule, detail: 'x' }) === want)
    step('D rule_id 优先映射', cls && L.classify({ type: 'stale', detail: '无动作' }) === '超时')
    await E.logEvent({ type: 'close', order_id: 'dh900', from: 'aa', note: 'done' })
    await E.logEvent({ type: 'verify', order_id: 'dh900', from: 'order', refs: [process.env.WB_TEST_ROOT] })
    await E.logEvent({ type: 'close', order_id: 'dh901', from: 'aa', note: 'ok' })
    step('D 成功 close/verify 不入信号', !L.readSignals().some((s) => s.type === 'close' || s.type === 'verify'))

    // B 门槛/观察期：缺证据 3 + 超时 3（各 50%）
    for (const oid of ['dh910', 'dh911', 'dh912']) await L.recordSignal({ type: 'reject', order_id: oid, rule_id: 'PRT-001', detail: '缺证据' })
    for (const oid of ['dh920', 'dh921', 'dh922']) await L.recordSignal({ type: 'stale', order_id: oid, detail: '超时' })
    const a0 = L.autoApply()
    const obs0 = L.readObservations()
    const obsEv = obs0.items.find((x) => x.mode === '缺证据')
    const obsStale = obs0.items.find((x) => x.mode === '超时')
    step('B 样本≥3 且占比≥30% 才进观察期', a0.ok && !!obsEv && !!obsStale && obsEv.status === 'observing')
    step('B 观察期内不注入 seed', L.readAdjustments().active.length === 0 && !/已知坑/.test((await import('../lib/entry-seed.js')).buildEntrySeed('aa').text))
    step('B template-hint 未接入标「未应用」', obsStale && obsStale.type === 'template-hint' && obsStale.status === 'not-applied' && /未应用/.test(obsStale.uiNote || ''))
    for (const it of obs0.items) it.first_seen = new Date(Date.now() - 8 * 86400000).toISOString()
    store.writeJson(path.join(P.META, 'learn', 'observations.json'), obs0)
    L.autoApply()
    const obs1 = L.readObservations(); const adj = L.readAdjustments()
    step('B 观察满 7 天且仍达标才真正注入', adj.active.length >= 1 && adj.active.length <= 3 && obs1.items.find((x) => x.mode === '缺证据').status === 'applied' && obs1.items.find((x) => x.mode === '超时').status === 'not-applied')
    step('B seed 注入已知坑', /已知坑/.test((await import('../lib/entry-seed.js')).buildEntrySeed('aa').text))

    // C 效果对照 + 命中率
    const wk = L.weeklyReport()
    const wt = fs.readFileSync(path.join(P.META, 'learn', 'weekly.md'), 'utf8')
    step('C 周报调整前/后 2 周对照', /效果对照（调整前 2 周 vs 调整后 2 周）/.test(wt) && /返工率/.test(wt) && /多跳率/.test(wt))
    const ptr = path.join(process.env.WB_TEST_ROOT, 'evidence.md'); fs.writeFileSync(ptr, 'x')
    const aj = L.readAdjustments(); aj.items.push({ id: 'adj-hit', type: 'seed-pitfall', value: '已知坑：见 ' + ptr, pointer: ptr, version: pkg.version, at: new Date().toISOString(), reverted: false })
    store.writeJson(path.join(P.META, 'learn', 'adjustments.json'), aj)
    const hit = await L.recordInjectionHit('dh930', 'note', '结论见 ' + ptr, [ptr])
    step('C 实装 injectionHitRate（命中记录）', !!hit && L.readHits().length >= 1 && typeof L.metrics().injectionHitRate === 'number')
    L.weeklyReport()
    step('C 周报含注入命中率', /注入命中率/.test(fs.readFileSync(path.join(P.META, 'learn', 'weekly.md'), 'utf8')))

    // E 窗口/分母
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '窗口指标', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, exec('S-A'))
    const m7 = L.metrics(7)
    const future = L.metricsWindow(Date.now() + 86400000, Date.now() + 2 * 86400000)
    step('E avgDurationMs 限 7 天窗口', m7.avgDurationMs != null && m7.avgDurationMs >= 0 && future.avgDurationMs === null)
    step('E 分母用单数不用事件数', m7.orders === 1 && m7.reworkRate <= 1 && m7.staleRate <= 1)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv054-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh079-learn')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v054-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh079 学习机制优化分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
