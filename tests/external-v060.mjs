#!/usr/bin/env node
/** external-v060.mjs —— dh086 其他设置默认关闭（0.1.0） */
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
    const B = await import('../lib/budget.js'); const OPS = await import('../lib/ops.js'); const L = await import('../lib/learn.js')
    const SEED = await import('../lib/entry-seed.js'); const E = await import('../lib/events.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    // 默认值
    step('① token 阈值提醒默认 false', B.DEFAULTS.notice.enabled === false && OPS.configInfo().token.enabled === false)
    step('② 超时自动催办默认 false', B.DEFAULTS.notice.enabled === false && B.config().notice.enabled === false)
    step('③ 学习自动应用默认 true（可显式关闭）', B.DEFAULTS.learn.autoApply === true)
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('UI 初始态 token 关 / notice 关 / 自动索引标注自动', /tokenEnabled: false/.test(cli) && /var _F = useState\(false\), noticeEnabled/.test(cli) && /自动索引/.test(cli) && /索引自动更新/.test(cli))
    // 已保存配置不破坏
    const cfg0 = store.readJson(P.CONFIG, {}) || {}
    cfg0.handover = Object.assign({}, cfg0.handover || {}, { enabled: true })
    cfg0.notice = Object.assign({}, cfg0.notice || {}, { enabled: true })
    cfg0.learn = { autoApply: true }
    store.writeJson(P.CONFIG, cfg0)
    const ci = OPS.configInfo()
    step('已保存开启项不被覆盖', ci.token.enabled === true && ci.notice.enabled === true && B.config().learn.autoApply === true)
    // 显式关闭时只观察不注入
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-A' }] }], groups: [] })
    const c1 = store.readJson(P.CONFIG, {}); c1.learn = { autoApply: false }; store.writeJson(P.CONFIG, c1)
    const sigPath = path.join(P.META, 'learn', 'signals.jsonl'); fs.mkdirSync(path.dirname(sigPath), { recursive: true })
    for (let i = 0; i < 3; i++) await E.logEvent({ type: 'reject', order_id: 'dh96' + i, note: '缺证据' })
    L.autoApply()
    const obs = L.readObservations(); for (const it of obs.items) it.first_seen = new Date(Date.now() - 8 * 86400000).toISOString(); store.writeJson(path.join(P.META, 'learn', 'observations.json'), obs)
    L.autoApply()
    step('显式关闭：只观察不注入 seed', L.readAdjustments().active.length === 0 && !/已知坑/.test(SEED.buildEntrySeed('aa').text))
    const c2 = store.readJson(P.CONFIG, {}); c2.learn = {}; store.writeJson(P.CONFIG, c2)
    L.autoApply()
    step('默认开启（未设 false）时注入', L.readAdjustments().active.length >= 1)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv060-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh086-defaults')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v060-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh086 默认关闭分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
