#!/usr/bin/env node
/** external-v047.mjs —— v0.1.0 定稿细节（dh072） */
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
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return {
          list: async () => ({ items: sessions.slice() }),
          create: async () => { const sid = 'S-NEW-' + (sessions.length + 1); sessions.push({ sessionId: sid, cwd: process.env.WB_TEST_ROOT, projections: { values: { title: '' } } }); return { sessionId: sid } },
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
    const C = await import('../lib/collab.js'); const OPS = await import('../lib/ops.js')
    const MI = await import('../lib/memory-index.js'); const PR = await import('../lib/projection.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const scene = (id, sid) => ({ id, name: id === 'aa' ? 'AA' : id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-O'), scene('aa', 'S-A'), scene('bb', 'S-B')], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })

    // A 交接命名顺序
    sessions.push({ sessionId: 'S-OLD', cwd: process.env.WB_TEST_ROOT, projections: { values: { title: 'AA' } } })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-OLD' }] }], groups: [] })
    const r1 = await H.rebindScene({ id: 'aa', autoCreate: true })
    const titles = sessions.map((s) => s.projections.values.title)
    step('A 先改旧会话→新会话原名（不出现「AA 2」）', r1.ok && titles.indexOf('AA') >= 0 && titles.some((x) => /^AA（已交接 \d{2}-\d{2} \d{2}:\d{2}）$/.test(x)) && titles.indexOf('AA 2') < 0, { titles })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-O'), scene('aa', 'S-A'), scene('bb', 'S-B')], groups: [] })

    // B 回收站：近10/复选框/删除选中/一键清空
    const trash = path.join(P.DSH_HOME, 'trash'); fs.mkdirSync(path.join(trash, 'dirX'), { recursive: true }); fs.writeFileSync(path.join(trash, 'dirX', 'a.txt'), 'x'); fs.writeFileSync(path.join(trash, 'f1.txt'), 'y')
    const d1 = OPS.deleteTrash(['dirX'])
    step('B 删除选中（目录生效）', d1.ok && d1.removed === 1 && !fs.existsSync(path.join(trash, 'dirX')))
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('B UI 复选框/近10/删除选中/一键清空/内联确认', /selTrash/.test(cli) && /slice\(0, 10\)/.test(cli) && /删除选中/.test(cli) && /一键清空/.test(cli) && /requestInlineConfirm\('清空回收站/.test(cli))

    // C 看板 v2
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('C 看板两栏 70/30', /class="dash"/.test(bp) && /grid-template-columns:minmax\(0,7fr\) minmax\(320px,3fr\)/.test(bp))
    step('C 会话表可开抽屉（summary/最近单/交接）', /data-sid/.test(bp) && /openSceneDrawer/.test(bp) && /最近单/.test(bp) && /交接记录/.test(bp))
    step('C 在途单 flow 步骤条（✓/●/○）+ current/next', /order-flow/.test(bp) && /✓/.test(bp) && /●/.test(bp) && /○/.test(bp) && /current_owner=/.test(bp) && /next=/.test(bp))
    step('C 右栏事件筛选+黑板/规则折叠', /eventFilter/.test(bp) && /<details class="card fold"/.test(bp) && /data-type/.test(bp))
    step('C KPI 4 张（会话数/在途/今日完成/事件违规）', ['会话数', '在途单', '今日完成', '今日事件/违规'].every((x) => bp.indexOf("statCard('" + x) >= 0))
    const bd = await (await import('../lib/board.js')).boardData({ full: false })
    step('C 看板数据会话含 recentOrders/handover', Array.isArray((bd.scenes || [])[0]?.recentOrders) && Array.isArray((bd.scenes || [])[0]?.handover))

    // D 记忆命名 + 迁移 + E INDEX
    const day = '2026-11-08'; const mem = path.join(P.AGENTS, 'aa', 'memory', day); fs.mkdirSync(mem, { recursive: true })
    fs.writeFileSync(path.join(mem, 'note-2026-11-08.md'), '# old\n\n结论：旧命名\n\n来源：lib/a.js\n', 'utf8')
    const mig = MI.migrateNoteNames()
    step('D 启动幂等改名 note-日期.md → note.md', mig.ok && fs.existsSync(path.join(mem, 'note.md')) && !fs.existsSync(path.join(mem, 'note-2026-11-08.md')))
    const n1 = await W.wbWrite({ action: 'note', scene: 'aa', text: '结论：新命名结论', refs: [process.env.WB_TEST_ROOT] }, exec('S-A'))
    step('D 新写入 note.md（无日期）', n1.ok && /memory\\2026-11-08\\note\.md$/.test(n1.file) && !/note-2026/.test(n1.file))
    const idx = MI.rebuildMemoryIndex('aa')
    const idxTxt = fs.readFileSync(path.join(P.AGENTS, 'aa', 'memory', 'INDEX.md'), 'utf8')
    step('E INDEX 时间线格式 ## 日期 + - HH:mm dhNNN · 类型 · 一句话（证据）', idx.ok && /## 2026-11-08/.test(idxTxt) && /- \d{2}:\d{2} (note|dh\d+) · (记录|协作|细节) · .+（.+）/.test(idxTxt), { idxTxt: idxTxt.slice(0, 300) })

    // F 单号每日重置 + done-index
    const yday = new Date(Date.now() - 86400000); const ymd = yday.getFullYear() + '-' + String(yday.getMonth() + 1).padStart(2, '0') + '-' + String(yday.getDate()).padStart(2, '0')
    const ydir = path.join(P.DSH_HOME, 'collab', ymd); fs.mkdirSync(ydir, { recursive: true })
    fs.writeFileSync(path.join(ydir, 'dh900-' + 'aa' + '.md'), '---\nprotocol: v2\norder_id: dh900\n---\n', 'utf8')
    step('F 单号每日重置（昨日 dh900 不影响今日）', C.nextId() === 'dh001')
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '今日第一单', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-O'))
    const t2 = await W.wbWrite({ action: 'task', to: 'bb', task: '今日第二单', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['bb'], wake: false }, exec('S-O'))
    step('F 今日单号 001/002', t1.orderId === 'dh001' && t2.orderId === 'dh002', { ids: [t1.orderId, t2.orderId] })
    await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, exec('S-O'))
    const di = fs.readFileSync(path.join(P.DSH_HOME, 'collab', 'done-index.md'), 'utf8')
    step('F done-index 日期分段+六列', /## \d{4}-\d{2}-\d{2}/.test(di) && /\| 时间 \| 单号 \| 标题 \| 负责人 \| 状态 \| 路径 \|/.test(di) && /dh001/.test(di))
    step('F SKILL/seed 跨日引用格式', /YYYY-MM-DD\/dhNNN/.test((await import('../lib/scene-pack.js')).skillTemplateFor({ id: 'aa', name: 'AA' })) && /YYYY-MM-DD\/dhNNN/.test((await import('../lib/entry-seed.js')).buildEntrySeed('aa').text))

    // G 单文档去重
    const g1 = await W.wbWrite({ action: 'task', to: 'aa', task: '去重测试', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, exec('S-O'))
    await W.wbWrite({ action: 'handoff', orderId: g1.orderId, to: 'bb', kind: 'next', note: '只写变更', refs: [process.env.WB_TEST_ROOT] }, exec('S-A'))
    const gtxt = C.findOrder(g1.orderId).text
    step('G handoff 记录只写变更+refs', /交接 → bb · 只写变更 · .*WB_TEST|交接 → bb · 只写变更 · .*ext/.test(gtxt))
    await W.wbWrite({ action: 'close', orderId: g1.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, exec('S-B'))
    step('G 终态记录含证据目录', /关单：done · .*证据：/.test(C.findOrder(g1.orderId).text))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv047-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh072-core')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v047-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('v0.1.0 定稿细节分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
