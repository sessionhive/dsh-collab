#!/usr/bin/env node
/** external-v055.mjs —— dh080 学习回算 + 浅色柔和（0.1.0） */
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
    const BO = await import('../lib/board.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('F 版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-A' }] }], groups: [] })
    // A 回算 + 版本过滤
    const raw = [
      { ts: new Date().toISOString(), type: 'violation', rule_id: 'PRT-001', detail: '证据', mode: '越权写', version: '0.1.0' },
      { ts: new Date().toISOString(), type: 'violation', rule_id: 'BND-002', detail: '越权', mode: '缺证据', version: '0.1.0' },
      { ts: new Date().toISOString(), type: 'reject', rule_id: 'PRT-001', detail: '旧', mode: '缺证据', version: '0.0.9' },
    ]
    const sigPath = path.join(P.META, 'learn', 'signals.jsonl')
    fs.mkdirSync(path.dirname(sigPath), { recursive: true })
    fs.writeFileSync(sigPath, raw.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8')
    const sig = L.readSignals()
    step('A 读取按当前 classify 回算（不信任落盘 mode）', sig[0].mode === '缺证据' && sig[1].mode === '越权写')
    step('A 当前版本才进主统计，旧版本 legacy', sig[2].legacy === true && L.metrics().signals === 2 && L.metrics().legacySignals === 1 && L.metrics().topModes.every((x) => x.mode !== '缺证据' || x.count === 1))
    // B 旧调整过期
    const adj = { schemaVersion: 2, items: [{ id: 'old-adj', type: 'seed-pitfall', value: '旧', version: '0.0.9', at: new Date().toISOString(), reverted: false }] }
    store.writeJson(path.join(P.META, 'learn', 'adjustments.json'), adj)
    const ad = L.readAdjustments()
    step('B 非当前版本旧调整自动 reverted', ad.items[0].reverted === true && ad.items[0].revert_reason === 'expired-version' && ad.active.length === 0)
    // 新门槛重新评估（3 条当前缺证据 → 观察期）
    for (let i = 0; i < 3; i++) await E.logEvent({ type: 'reject', order_id: 'dh95' + i, note: '缺证据' })
    const aa = L.autoApply()
    step('B 按新门槛重新评估（先进观察期）', aa.ok && L.readObservations().items.some((x) => x.mode === '缺证据' && x.status === 'observing') && L.readAdjustments().active.length === 0)
    // C 浅色 token
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('C 浅色柔和背景/白卡/软边框', /--bg:#f5f6f8/.test(bp) && /--card:#ffffff/.test(bp) && /--line:#e6e9ef/.test(bp))
    step('C 浅色下按钮/事件标签浅底深字', /html\[data-theme="light"\] \.btn\{background:#f4f6fa/.test(bp) && /html\[data-theme="light"\] \.ev-badge\{background:#f3f5f9/.test(bp) && /color:#2456a6/.test(bp))
    // D 事件流过滤 handover
    await E.logEvent({ type: 'handover', order_id: 'dh960', from: 'S-OLD', to: 'S-NEW', note: '会话交接' })
    const bd = await BO.boardData({ full: false })
    step('D 协作单事件流不显示会话 handover', !bd.events.last.some((e) => e.type === 'handover') && !bd.orders.recent.some((o) => (o.timeline || []).some((e) => e.type === 'handover')))
    // E 学习卡两栏
    const ls = L.learnSummary()
    step('E 学习卡两栏 current/legacy', ls.legacySignals != null && Array.isArray(ls.legacyModes) && /learn-cols/.test(bp) && /历史（旧版本，仅参考）/.test(bp))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv055-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh080-fix')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v055-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh080 学习回算/浅色分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
