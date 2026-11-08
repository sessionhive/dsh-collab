#!/usr/bin/env node
/** external-v051.mjs —— dh076 紧急修（refs 全动作 / timing / handoff 去重） */
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
    const T = await import('../lib/timing.js'); const E = await import('../lib/events.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-A' }] }, { id: 'bb', name: 'BB', sessions: [{ sessionId: 'S-B' }] }, { id: 'order', name: 'O', sessions: [{ sessionId: 'S-O' }] }], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const ref = process.env.WB_TEST_ROOT

    // A refs 安全校验：handoff 穿越/不存在/超限
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: 'refs 全动作', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '开工' }, exec('S-A'))
    const h1 = await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'bb', kind: 'next', refs: ['../../windows/win.ini'] }, exec('S-A'))
    step('A handoff refs .. 穿越拒绝 + violations', h1.ok === false && /穿越|不可达/.test(h1.hint || '') && /PRT-001/.test(fs.readFileSync(P.VIOLATIONS_FILE, 'utf8')))
    const h2 = await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'bb', kind: 'next', refs: [path.join(process.env.WB_TEST_ROOT, '__missing__.txt')] }, exec('S-A'))
    step('A handoff refs 不存在拒绝', h2.ok === false && /不可达/.test(h2.hint || ''))
    const big = path.join(process.env.WB_TEST_ROOT, 'big.bin')
    fs.writeFileSync(big, Buffer.alloc(21 * 1024 * 1024, 1))
    const h3 = await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'bb', kind: 'next', refs: [big] }, exec('S-A'))
    step('A handoff refs 超 20MB 拒绝', h3.ok === false && /20MB/.test(h3.hint || ''))
    // submit 同样校验
    const sbad = await W.wbWrite({ action: 'submit', orderId: t1.orderId, refs: ['../x.txt'] }, exec('S-A'))
    step('A submit refs 穿越拒绝', sbad.ok === false && /穿越|不可达/.test(sbad.hint || ''))
    const hok = await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'bb', kind: 'next', refs: [ref] }, exec('S-A'))
    step('A 合法 refs handoff 通过', hok.ok === true)
    // C 重复 handoff（owner 已漂移到 bb，仍由重复调用识别）
    const hdup = await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'bb', kind: 'next', refs: [ref] }, exec('S-A'))
    step('C 同 order+to+kind 短窗口重复 → 拒绝', hdup.ok === false && hdup.duplicate === true && /重复 handoff/.test(hdup.hint || ''), { hdup })
    const vbad = await W.wbWrite({ action: 'verify', orderId: t1.orderId, refs: ['../x.txt'] }, exec('S-O'))
    step('A verify refs 穿越拒绝', vbad.ok === false && /穿越|不可达/.test(vbad.hint || ''))

    // B timing 无 delivered
    const t2 = await W.wbWrite({ action: 'task', to: 'aa', task: 'timing 无 delivered', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'progress', orderId: t2.orderId, line: '开工' }, exec('S-A'))
    const tm = T.computeTiming(C.findOrder(t2.orderId), await E.readEvents())
    step('B 无 delivered 时 start_delay/queue 用 started-dispatched', tm.durations.start_delay_ms != null && tm.durations.start_delay_ms >= 0 && tm.durations.queue_ms != null && tm.durations.queue_ms >= 0, { durations: tm.durations })
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv051-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh076-fix')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v051-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh076 紧急修分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
