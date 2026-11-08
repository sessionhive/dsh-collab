#!/usr/bin/env node
/** external-v056.mjs —— dh082 协作单详情链路视图（0.1.0） */
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
    const W = await import('../lib/tools/write.js'); const BO = await import('../lib/board.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('D 版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-A' }] }, { id: 'bb', name: 'BB', sessions: [{ sessionId: 'S-B' }] }, { id: 'order', name: 'O', sessions: [{ sessionId: 'S-O' }] }], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const ref = process.env.WB_TEST_ROOT
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '链路视图', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '开工' }, exec('S-A'))
    await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'bb', kind: 'next', note: '转测试', refs: [ref] }, exec('S-A'))
    await W.wbWrite({ action: 'verify', orderId: t1.orderId, note: '通过', refs: [ref] }, exec('S-O'))
    await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [ref] }, exec('S-B'))
    const bd = await BO.boardData({ full: false })
    const row = (bd.orders.recent || []).find((o) => o.id === t1.orderId)
    step('A board recent 含该单', !!row, { id: t1.orderId })
    step('A fileAbs 为真实 .done.md', row && /\.done\.md$/i.test(String(row.fileAbs || '')) && fs.existsSync(row.fileAbs))
    step('A flow/current_owner/next 字段', row && Array.isArray(row.flow) && row.flow.length === 2 && row.current_owner === 'bb' && 'next' in row)
    step('A events 数组含 ts/type/from/to/note/refs', row && Array.isArray(row.events) && row.events.length >= 5 && row.events.every((e) => 'ts' in e && 'type' in e && 'from' in e && 'to' in e && 'note' in e && 'refs' in e) && row.events.some((e) => e.refs.length > 0))
    step('A metrics 各棒耗时/总时长', row && row.metrics && row.metrics.durations && Array.isArray(row.metrics.sticks) && row.metrics.sticks.length >= 2 && 'total_ms' in row.metrics.durations)
    // 打开单中（非 done）也有字段
    const t2 = await W.wbWrite({ action: 'task', to: 'aa', task: '打开详情', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-O'))
    const bd2 = await BO.boardData({ full: false })
    const openRow = (bd2.orders.recent || []).find((o) => o.id === t2.orderId)
    step('A open 单也有 fileAbs/events/metrics', openRow && openRow.fileAbs && Array.isArray(openRow.events) && openRow.metrics)
    // B/C 静态抽屉
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('B 链路卡/动作/起止/耗时/refs', /chain-card/.test(bp) && /chain-role/.test(bp) && /chain-act/.test(bp) && /actionOf/.test(bp) && /chain-refs/.test(bp))
    step('B 事件时间线/空态/打开复制关闭', /id="drawerTimeline"/.test(bp) && /暂无事件/.test(bp) && /id="drawerOpenFile"/.test(bp) && /id="drawerCopy"/.test(bp) && /id="drawerClose"/.test(bp))
    step('B 使用 fileAbs 打开单文件', /setAttribute\('data-file', fileAbs\)/.test(bp) && /fileAbs/.test(bp))
    step('C 主题 token + 自适应滚动 + 浅色', /\.drawerFoot button\{border:1px solid var\(--line\);background:var\(--card2\)/.test(bp) && /width:min\(940px,94vw\)/.test(bp) && /max-height:92vh/.test(bp) && /html\[data-theme="light"\] \.chain-card/.test(bp))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv056-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh082-drawer')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v056-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh082 链路视图分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
