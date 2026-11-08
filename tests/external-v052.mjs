#!/usr/bin/env node
/** external-v052.mjs —— dh077 宿主验收反馈 + 复盘（0.1.0） */
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
  const sessions = []
  const cwdRoot = process.env.WB_TEST_ROOT
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return {
          list: async () => ({ items: sessions.slice() }),
          create: async () => { const sid = 'S-NEW-' + (sessions.length + 1); sessions.push({ sessionId: sid, cwd: cwdRoot, projections: { values: { title: '' } } }); return { sessionId: sid } },
          rename: async (req) => { const r = (req && req.request) || req || {}; const s = sessions.find((x) => x.sessionId === String(r.sessionId || '')); if (s && r.title) s.projections.values.title = String(r.title); return { ok: true } },
          prompt: async () => ({ accepted: true }),
        }
        if (n === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const H = await import('../lib/handover.js'); const W = await import('../lib/tools/write.js')
    const BO = await import('../lib/board.js'); const OPS = await import('../lib/ops.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('F 版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const scene = (id, sid) => ({ id, name: id === 'aa' ? 'AA' : id, sessions: [{ sessionId: sid, cwd: cwdRoot }] })
    // A 交接命名：历史残留同名 app 会话不应导致 AA 2
    sessions.push({ sessionId: 'S-OLD', cwd: cwdRoot, projections: { values: { title: 'AA' } } })
    sessions.push({ sessionId: 'S-STRAY', cwd: cwdRoot, projections: { values: { title: 'AA' } } })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-OLD', cwd: cwdRoot }] }], groups: [] })
    const r1 = await H.rebindScene({ id: 'aa', autoCreate: true })
    const titles1 = sessions.map((s) => s.projections.values.title)
    step('A 只与 registry 绑定会话去重（残留同名不误判）', r1.ok && titles1.indexOf('AA') >= 0 && titles1.indexOf('AA 2') < 0, { titles1 })
    // 其它场景绑定同名 → 加序号
    sessions.push({ sessionId: 'S-BB', cwd: cwdRoot, projections: { values: { title: 'AA' } } })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-NEW-' + (sessions.length - 1), cwd: cwdRoot }] }, { id: 'bb', name: 'BB', sessions: [{ sessionId: 'S-BB', cwd: cwdRoot }] }], groups: [] })
    const r2 = await H.rebindScene({ id: 'aa', autoCreate: true })
    step('A 其它场景绑定同名时加序号', r2.ok && sessions.some((s) => s.projections.values.title === 'AA 2'), { titles: sessions.map((s) => s.projections.values.title) })

    // B 看板：全部单/中文标签/面板
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-O'), scene('aa', 'S-A'), scene('bb', 'S-B')], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '全部单 1', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-O'))
    const t2 = await W.wbWrite({ action: 'task', to: 'aa', task: '全部单 2', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [cwdRoot] }, exec('S-A'))
    const bd = await BO.boardData({ full: false })
    step('B① 全部协作单近 20 倒序（open/done/cancelled）', bd.orders && Array.isArray(bd.orders.recent) && bd.orders.recent.length >= 2 && bd.orders.recent.some((o) => o.state === 'done') && bd.orders.recent.some((o) => o.state === 'open'))
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('B② 事件类型中文标签 + 原文 tooltip', /dispatch: '派单'/.test(bp) && /delivered: '送达'/.test(bp) && /ack: '接单'/.test(bp) && /progress: '进度'/.test(bp) && /submit: '提交'/.test(bp) && /handoff: '转交'/.test(bp) && /verify: '验收'/.test(bp) && /close: '关单'/.test(bp) && /comment: '说明'/.test(bp) && /receipt: '回执'/.test(bp) && /title="' \+ esc\(type\)/.test(bp))
    step('B③ 协作单面板 + 抽屉/在途保留', /aria-label="协作单"/.test(bp) && /orderAllRows/.test(bp) && /drawerRefs/.test(bp) && /aria-label="协作在途"/.test(bp))

    // C 清理区：去路径括号 + 右键菜单
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('C① 清理区标签去路径括号', !/回收站（dataRoot/.test(cli) && !/备份（dataRoot/.test(cli) && !/临时（dataRoot/.test(cli))
    step('C② 右键菜单 打开目录/文件 + open-item 路由', /onContextMenu/.test(cli) && /打开所在目录/.test(cli) && /open-item/.test(cli) && /export function openItem/.test(fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'ops.js'), 'utf8')))
    const badItem = OPS.openItem('trash', '../../evil', 'file')
    step('C③ openItem 拒绝穿越', badItem.ok === false)

    // D refs 相对路径按场景工作区解析
    fs.writeFileSync(path.join(cwdRoot, 'rel.txt'), 'ok', 'utf8')
    sessions.push({ sessionId: 'S-A', cwd: cwdRoot, projections: { values: { title: 'AA' } } })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-O'), scene('aa', 'S-A'), scene('bb', 'S-B')], groups: [] })
    const t3 = await W.wbWrite({ action: 'task', to: 'aa', task: '相对 refs', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'progress', orderId: t3.orderId, line: '开工' }, exec('S-A'))
    const h1 = await W.wbWrite({ action: 'handoff', orderId: t3.orderId, to: 'bb', kind: 'next', refs: ['rel.txt'] }, exec('S-A'))
    step('D① 相对路径按场景 cwd 解析后通过', h1.ok === true)
    const h2 = await W.wbWrite({ action: 'handoff', orderId: t3.orderId, to: 'bb', kind: 'next', refs: ['nope-rel.txt'] }, exec('S-A'))
    step('D② 不可达错误给出绝对路径', h2.ok === false && h2.hint.indexOf(path.join(cwdRoot, 'nope-rel.txt')) >= 0)

    // E 证据 UTF-8 + summary 投影
    const sp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'scene-pack.js'), 'utf8')
    const sd = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'templates', 'seed.md'), 'utf8')
    step('E① SKILL/seed 提示 UTF-8', /UTF-8/.test(sp) && /UTF-8/.test(sd))
    step('E② handoff 同步 summary 投影', fs.existsSync(path.join(P.AGENTS, 'bb', 'summary.md')))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv052-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh077-fix')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v052-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh077 验收反馈修复分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
