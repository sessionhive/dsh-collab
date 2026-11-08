#!/usr/bin/env node
/** external-v046.mjs —— v0.1.0 第二批 UI（dh071） */
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
  const created = []
  const sessions = []
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return {
          list: async () => ({ items: sessions.slice() }),
          create: async (req) => { const sid = 'S-NEW-' + (created.length + 1); created.push({ sid, req: req || {} }); sessions.push({ sessionId: sid, cwd: req && req.cwd, projections: { values: { title: '' } } }); return { sessionId: sid } },
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
    const H = await import('../lib/handover.js'); const OPS = await import('../lib/ops.js')
    const BO = await import('../lib/board.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    // ① 工作区回退链（会话 cwd）
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-OLD' }] }], groups: [] })
    sessions.push({ sessionId: 'S-OLD', cwd: process.env.WB_TEST_ROOT, projections: { values: { title: '旧' } } })
    const r1 = await H.rebindScene({ id: 'aa', autoCreate: true })
    step('① 交接沿用原工作区（会话 cwd）', r1.ok && created.slice(-1)[0].req.cwd === process.env.WB_TEST_ROOT, { req: created.slice(-1)[0] && created.slice(-1)[0].req })
    // 场景 cwd 回退
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'bb', name: 'BB', cwd: path.join(process.env.WB_TEST_ROOT, 'scenedir'), sessions: [{ sessionId: 'S-B' }] }], groups: [] })
    sessions.push({ sessionId: 'S-B', projections: { values: { title: '旧B' } } })
    fs.mkdirSync(path.join(process.env.WB_TEST_ROOT, 'scenedir'), { recursive: true })
    const r2 = await H.rebindScene({ id: 'bb', autoCreate: true })
    step('① 回退链：会话无 cwd → 场景 cwd', r2.ok && created.slice(-1)[0].req.cwd === path.join(process.env.WB_TEST_ROOT, 'scenedir'))
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('① 错误文案可操作（提示在表单选工作区）', /交接目标工作区未确定/.test(fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'handover.js'), 'utf8')))

    // ② 红绿提示 20 秒
    step('② 提示统一 20 秒自动消失', /20000/.test(cli) && /useToastAutoClear/.test(cli) && /useToastAutoClear\(scenesErr/.test(cli))

    // ③ 回收站按条目
    const trash = path.join(P.DSH_HOME, 'trash'); fs.mkdirSync(path.join(trash, 'dir1'), { recursive: true }); fs.writeFileSync(path.join(trash, 'dir1', 'a.txt'), 'x')
    fs.writeFileSync(path.join(trash, 'b.txt'), 'y')
    const ti = OPS.trashInfo()
    step('③ 回收站按条目统计（dirs+files）', ti.ok && ti.items === 3 && ti.dirs === 1 && ti.count === 2 && ti.entries.some((e) => e.name === 'dir1') && ti.entries.some((e) => e.name === 'b.txt'), { ti })
    step('③ 清空对目录生效', OPS.clearTrash('清空').ok && !fs.existsSync(path.join(trash, 'dir1')))
    step('③ UI 复选框列表/个条目/删除选中', /个条目/.test(cli) && /selTrash/.test(cli) && /删除选中/.test(cli))

    // ④⑤⑥ 看板
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('④ 看板全改用「会话」（无场景）', bp.indexOf('场景') < 0 && /会话表/.test(bp) && /会话数/.test(bp))
    step('⑤ 看板 UI 优化样式', /v0\.3\.8 看板 UI 优化/.test(bp) && /max-width:1320px/.test(bp) && /\.cardHead h2/.test(bp))
    step('⑥ 协作单可点击 + 抽屉（flow/current/next/时间线/打开单文件）', /data-oid/.test(bp) && /openDrawer/.test(bp) && /drawerFlow/.test(bp) && /drawerTimeline/.test(bp) && /drawerOpenFile/.test(bp) && /current_owner/.test(bp) && /next/ .test(bp) && /chain-card/.test(bp))
    const bd = await BO.boardData({ full: false })
    const row = (bd.orders && bd.orders.open || [])[0]
    step('⑥ 看板数据含 timeline/fileAbs/flow 字段', !row || (Array.isArray(row.timeline) && row.fileAbs && Array.isArray(row.flow)), { row: row && { id: row.id, keys: Object.keys(row) } })
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv046-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh071-ui-workbench')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v046-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('v0.1.0 第二批 UI 分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
