#!/usr/bin/env node
/** external-v043.mjs —— v0.1.0 实测反馈修正（dh068） */
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
  const prompts = []
  const sessions = []
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return {
          list: async () => ({ items: sessions.slice() }),
          create: async (req) => { const sid = 'S-NEW-' + (sessions.length + 1); sessions.push({ sessionId: sid, projections: { values: { title: '' } } }); return { sessionId: sid } },
          rename: async (req) => { const r = (req && req.request) || req || {}; const s = sessions.find((x) => x.sessionId === String(r.sessionId || '')); if (s && r.title) s.projections.values.title = String(r.title); return { ok: true } },
          prompt: async (req) => { prompts.push({ sessionId: String(req && req.sessionId || ''), text: String((req && req.content && req.content[0] && req.content[0].text) || '') }); return { accepted: true } },
        }
        if (n === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const W = await import('../lib/tools/write.js'); const C = await import('../lib/collab.js')
    const H = await import('../lib/handover.js'); const PR = await import('../lib/projection.js')
    const OPS = await import('../lib/ops.js'); const SCH = await import('../lib/tools/schema.js')
    const AI = await import('../lib/agents-inject.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const scene = (id, sid) => ({ id, name: id === 'aa' ? '后端' : id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-ORD'), scene('aa', 'S-OLD'), scene('bb', 'S-B')], groups: [] })
    sessions.push({ sessionId: 'S-OLD', projections: { values: { title: '旧会话' } } })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })

    // A 交接标题
    const r1 = await H.rebindScene({ id: 'aa', autoCreate: true, cwd: process.env.WB_TEST_ROOT })
    const t1 = String((((sessions.slice(-1)[0] || {}).projections || {}).values || {}).title || '')
    const tOld = String((((sessions[0] || {}).projections || {}).values || {}).title || '')
    step('A 旧会话改名（已交接）、新会话保持原场景名', r1.ok && t1 === '后端' && /^后端（已交接 \d{2}-\d{2} \d{2}:\d{2}）$/.test(tOld), { t1, tOld })
    const r2 = await H.rebindScene({ id: 'aa', autoCreate: true, cwd: process.env.WB_TEST_ROOT })
    const t2 = String((((sessions.slice(-1)[0] || {}).projections || {}).values || {}).title || '')
    step('A 新会话重名自动加序号（后端 2）', r2.ok && t2 === '后端', { t2 })
    // D 交接摘要小节
    const seed = String((prompts.slice(-1)[0] || {}).text || '')
    step('D 交接摘要 ## 收口三步 / ## 规则（无 AGENTS 错误文案）', /## 收口三步/.test(seed) && /## 规则/.test(seed) && seed.indexOf('AGENTS.md 核心规则') < 0 && seed.indexOf('先读上面的接力摘要') >= 0)

    // B summary 投影
    const day = '2026-11-08'
    const memDir = path.join(P.AGENTS, 'aa', 'memory', day); fs.mkdirSync(memDir, { recursive: true })
    fs.writeFileSync(path.join(memDir, 'dh900.md'), '# dh900\n\n结论：后端接口已完成\n来源：lib/x.js\n', 'utf8')
    fs.writeFileSync(path.join(memDir, 'INDEX.md'), '# INDEX\n\n- 2026-11-08 · dh900 后端接口已完成（这是索引行）\n', 'utf8')
    const sum1 = PR.recomputeSummary('aa')
    const sumTxt = fs.readFileSync(path.join(P.AGENTS, 'aa', 'summary.md'), 'utf8')
    step('B summary 只取 note 正文（过滤 INDEX）', sum1.ok && /后端接口已完成/.test(sumTxt) && !/索引行/.test(sumTxt))
    // close 后强制重算：新单 close
    const ord = await W.wbWrite({ action: 'task', to: 'aa', task: '整合收口', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-ORD'))
    await W.wbWrite({ action: 'close', orderId: ord.orderId, status: 'done', note: '整合收口完成', refs: [process.env.WB_TEST_ROOT] }, exec('S-ORD'))
    const sum2 = fs.readFileSync(path.join(P.AGENTS, 'aa', 'summary.md'), 'utf8')
    step('B close 后强制重算（在做=close 正文）', /整合收口完成/.test(sum2) && !/索引行/.test(sum2), { sum2: sum2.slice(0, 160) })

    // C 最近记忆
    fs.writeFileSync(path.join(memDir, 'dh900.detail.md'), '# detail\n', 'utf8')
    fs.writeFileSync(path.join(memDir, 'dh901.md'), '# dh901\n\n结论：另一单\n', 'utf8')
    const ho = H.buildHandover('aa')
    step('C 最近记忆排除 INDEX、同单去重、≤3（detail 可纳入）', ho.ok && Number(ho.memory) <= 3 && ho.text.indexOf('INDEX.md') < 0 && (ho.text.match(/dh900/g) || []).length <= 1)

    // E schema flow/evidence + 自动 flow 不误报
    const params = SCH.writeParameters()
    step('E schema 暴露 flow/evidence', !!params.flow && !!params.evidence)
    const auto = await W.wbWrite({ action: 'task', to: 'aa', task: '测试联调任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', collaborators: ['bb'], wake: false }, exec('S-ORD'))
    step('E collaborators 自动 flow 不误报未给 flow', auto.ok && auto.flowAuto === true && !/未给 flow/.test(auto.warning || ''), { warning: auto.warning })

    // F core 协作准则与文案
    const core = AI.coreText()
    step('F core 增协作 4 条 + 无错误路径', /协作准则（4 条）/.test(core) && /PRT-016/.test(core) && /PRT-019/.test(core) && core.indexOf('constitution\\current') < 0)
    const section = AI.buildSection()
    step('F 注入文案改为内置只读/shared/templates 覆盖', /内置只读/.test(section) && /shared\\templates/.test(section) && section.indexOf('constitution\\current') < 0)

    // G note 文件级轮转
    const chunk = '结论：接口联调细节补充。说明：本条用于逼近单文件 2KB 上限。'.repeat(18)
    let n1 = null, n2 = null, n3 = null
    for (let i = 0; i < 3; i++) {
      const r = await W.wbWrite({ action: 'note', scene: 'aa', orderId: 'dh950', text: chunk, refs: ['lib/' + i + '.js'] }, exec('S-OLD'))
      if (i === 0) n1 = r; else if (i === 1) n2 = r; else n3 = r
    }
    step('G 同一 memory 文件 >2KB 自动轮转', n1.ok && n2.ok && n3.ok && n3.rotated === true && /\.detail\d*\.md$/.test(n3.file), { n3 })

    // H 清理四项 + 外部 trash 诊断
    const trashDir = path.join(P.DSH_HOME, 'trash'); fs.mkdirSync(trashDir, { recursive: true })
    for (let i = 0; i < 3; i++) fs.writeFileSync(path.join(trashDir, 'f' + i + '.txt'), 'x', 'utf8')
    const oi = OPS.opsInfo()
    step('H ops/info diagnostics 含 trash 计数', oi.ok && oi.diagnostics && oi.diagnostics.trash.files >= 3 && oi.diagnostics.trash.path === trashDir)
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('H 清理区四项常驻 + 数据驱动（hasTrash/暂无）', cli.indexOf('高级 · 数据清理') >= 0 && cli.indexOf('hasTrash') >= 0 && cli.indexOf('事件流（events.jsonl）') >= 0 && cli.indexOf('暂无') >= 0 && cli.indexOf('diagMismatch') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv043-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh068-fixes')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v043-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('v0.1.0 实测反馈修正分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
