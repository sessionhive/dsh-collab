#!/usr/bin/env node
/** external-v049.mjs —— dh074 学习闭环 */
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
        if (n === 'workspaceRegistry') return { list: () => [], archivedSceneIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const E = await import('../lib/events.js'); const L = await import('../lib/learn.js')
    const BO = await import('../lib/board.js'); const SEED = await import('../lib/entry-seed.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('最终版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-A' }] }], groups: [] })
    { const c0 = store.readJson(P.CONFIG, {}); c0.learn = Object.assign({}, c0.learn || {}, { autoApply: true }); store.writeJson(P.CONFIG, c0) }

    // A 信号采集
    await E.logEvent({ type: 'close', order_id: 'dh001', from: 'aa', note: '完成' })
    await E.logEvent({ type: 'verify', order_id: 'dh001', from: 'order', refs: ['x'] })
    await E.logEvent({ type: 'reject', order_id: 'dh002', from: 'order', note: '证据不可达，缺证据' })
    await E.logEvent({ type: 'reject', order_id: 'dh004', from: 'order', note: '缺证据' })
    await E.logEvent({ type: 'reject', order_id: 'dh005', from: 'order', note: 'refs 不可达' })
    await E.logEvent({ type: 'handoff', order_id: 'dh002', from: 'aa', to: 'bb' })
    await E.logEvent({ type: 'stale', order_id: 'dh003', from: 'host', minutes: 5 })
    await E.logViolation({ rule: 'BND-002', path: 'agents/bb', detail: '越权写别人目录' })
    const sig = L.readSignals()
    step('A 只采异常信号（成功 close/verify/handoff 不入）', sig.some((s) => s.type === 'reject') && sig.some((s) => s.type === 'stale') && sig.some((s) => s.type === 'violation') && !sig.some((s) => ['close', 'verify', 'handoff', 'submit'].includes(s.type)), { length: sig.length, types: sig.map((s) => s.type) })
    // B 分类
    const ms = sig.map((s) => s.mode)
    step('B 失败模式分类（缺证据/越权写/超时/多跳）', ms.includes('缺证据') && ms.includes('越权写') && ms.includes('超时'), { modes: ms })

    // C 周报
    const wk = L.weeklyReport()
    step('C 周报 weekly.md（返工率/单均/stale/模式）', wk.ok && fs.existsSync(path.join(P.META, 'learn', 'weekly.md')) && /返工率/.test(fs.readFileSync(path.join(P.META, 'learn', 'weekly.md'), 'utf8')) && /失败模式/.test(fs.readFileSync(path.join(P.META, 'learn', 'weekly.md'), 'utf8')))

    // D 看板学习卡 + H KPI
    const bd = await BO.boardData({ full: false })
    step('D/H board learn + 指标', bd.learn && bd.learn.metrics && typeof bd.learn.metrics.reworkRate === 'number' && Array.isArray(bd.learn.adjustments))
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('D 看板学习卡（本周学了什么/可回退）', /aria-label="学习"/.test(bp) && /本周学了什么/.test(bp) && /data-revert/.test(bp))
    step('H KPI 返工率/单均时长/stale 率', bp.indexOf('近7天返工率') >= 0 && bp.indexOf('单均时长') >= 0 && bp.indexOf('stale 率') >= 0)

    // E 一键反馈
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const fb = await call('POST', '/plugins/workbench-core/learn/feedback', { orderId: 'dh001', verdict: 'stuck' })
    step('E 一键反馈进信号', fb.code === 200 && L.readSignals().some((s) => s.type === 'feedback' && s.verdict === 'stuck'))

    // F 自动应用（限权）+ 回退 + 版本/周上限
    const aa = await L.autoApply()
    let adj = L.readAdjustments()
    const obs0 = L.readObservations()
    step('F 先观察期（满 7 天前不注入）', aa.ok && obs0.items.length >= 1 && adj.active.length === 0 && obs0.items[0].status === 'observing')
    const ob = L.readObservations(); ob.items[0].first_seen = new Date(Date.now() - 8 * 86400000).toISOString(); store.writeJson(path.join(P.META, 'learn', 'observations.json'), ob)
    await L.autoApply()
    adj = L.readAdjustments()
    step('F 观察满 7 天且仍达标才注入 + 版本 + 每周≤3', adj.active.length >= 1 && adj.active.length <= 3 && adj.active.every((x) => !!x.version))
    step('F seed 注入已知坑指针', /已知坑/.test(SEED.buildEntrySeed('aa').text))
    const rev = L.revertAdjustment(adj.active[0].id)
    step('F 回退入口', rev.ok && L.readAdjustments().active.every((x) => x.id !== adj.active[0].id))

    // G 老化：旧大版本条目失效
    const j = L.readAdjustments(); j.items.push({ id: 'old-1', type: 'seed-pitfall', value: '旧版本坑', version: '0.2.9', at: new Date().toISOString(), reverted: false })
    store.writeJson(path.join(P.META, 'learn', 'adjustments.json'), j)
    step('G 学习条目绑定版本/旧版本失效', L.readAdjustments().active.every((x) => x.id !== 'old-1'))

    // 周报/学习卡通过路由
    const rs = await call('GET', '/plugins/workbench-core/learn/summary')
    step('D 学习卡路由', rs.code === 200 && JSON.parse(rs.body).metrics)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv049-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh074-learning')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v049-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh074 学习闭环分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
