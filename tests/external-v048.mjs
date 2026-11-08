#!/usr/bin/env node
/** external-v048.mjs —— dh073 数据与自检（v0.3.x 第一批） */
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
    const W = await import('../lib/tools/write.js'); const C = await import('../lib/collab.js')
    const OPS = await import('../lib/ops.js'); const MIG = await import('../lib/migrate.js')
    const R = await import('../lib/tools/read.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('最终版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const scene = (id, sid) => ({ id, name: id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-O'), scene('aa', 'S-A'), scene('bb', 'S-B')], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const ref = process.env.WB_TEST_ROOT

    // A 耗时字段
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '耗时指标', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '开工' }, exec('S-A'))
    await W.wbWrite({ action: 'submit', orderId: t1.orderId, note: '提交', refs: [ref] }, exec('S-A'))
    await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'bb', kind: 'next', note: '转测试', refs: [ref] }, exec('S-A'))
    await W.wbWrite({ action: 'verify', orderId: t1.orderId, note: '通过', refs: [ref] }, exec('S-O'))
    await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [ref] }, exec('S-B'))
    const o = C.findOrder(t1.orderId)
    const fm = o.frontmatter
    step('A frontmatter 记录 started/submit/handoff/verify/close + schemaVersion', ['started_at', 'submit_at', 'handoff_at', 'verify_at', 'close_at'].every((k) => !!fm[k]) && Number(fm.schemaVersion) >= 1, { keys: Object.keys(fm).filter((k) => /_at$|schema/.test(k)) })
    const bd = await R.wbRead({ action: 'board' }, exec('S-O'))
    const row = (bd.orders && bd.orders.open || [])[0]
    // 已关闭单不在 open；直接测 timing 模块
    const TM = await import('../lib/timing.js')
    const tm = TM.computeTiming(C.findOrder(t1.orderId), (await import('../lib/events.js')).readEvents())
    step('A derived 时长（排队/开工延迟/总时长/各棒）', tm.durations && tm.durations.total_ms >= 0 && Array.isArray(tm.sticks) && tm.sticks.length >= 2 && 'queue_ms' in tm.durations && 'start_delay_ms' in tm.durations, { durations: tm.durations, sticks: tm.sticks.length })

    // B 自检纯插件
    const sc = await OPS.selfCheck()
    const names = sc.items.map((x) => x.name)
    step('B /ops/selfcheck 纯插件（不跑外壳脚本）', sc.ok && sc.total >= 8 && names.includes('路由响应') && names.includes('dataRoot 可写') && names.includes('模板可解析') && names.includes('manifest sha') && !names.some((n) => /check-gui|宪法|check-handover/.test(n)), { names, warn: sc.warn })
    // 走路由
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const sr = await call('POST', '/plugins/workbench-core/ops/selfcheck')
    const sj = JSON.parse(sr.body)
    step('B /ops/selfcheck 路由返回逐项状态', sr.code === 200 && sj.items && sj.items.every((x) => ['ok', 'warn', 'fail'].includes(x.status)) && sj.fail === 0)

    // C schemaVersion + 迁移 + manifest
    const m1 = MIG.migrateAll(); const m2 = MIG.migrateAll()
    const cfg = store.readJson(P.CONFIG, {}), reg = store.readJson(P.REGISTRY, {})
    step('C config/registry schemaVersion + 幂等迁移', cfg.schemaVersion === 1 && reg.schemaVersion === 1 && m2.steps.every((s) => !s.changed), { m1, m2 })
    const man = MIG.verifyManifest()
    step('C manifest.json sha 校验', man.ok && fs.existsSync(path.join(P.META, 'plugin-manifest.json')), { man })

    // D 升级检测
    const pi = await call('GET', '/plugins/workbench-core/plugin-info')
    const pj = JSON.parse(pi.body)
    step('D plugin-info 升级检测字段', pi.code === 200 && typeof pj.upgradeRequired === 'boolean' && typeof pj.upgradeHint === 'string' && pj.manifest && typeof pj.manifest.ok === 'boolean', { upgradeRequired: pj.upgradeRequired })
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('D 设置页提示需重启', /需重启加载新版本/.test(cli) && /upgradeRequired/.test(cli))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv048-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh073-data-selfcheck')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v048-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh073 数据与自检分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
