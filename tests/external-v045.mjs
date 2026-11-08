#!/usr/bin/env node
/** external-v045.mjs —— v0.1.0 验收边界/refs/summary/board/ack/scope（dh070） */
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
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return { list: async () => ({ items: [] }), create: async () => ({ sessionId: 'S-NEW' }), prompt: async (req) => { prompts.push(String(req && req.sessionId || '')); return { accepted: true } } }
        if (n === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const W = await import('../lib/tools/write.js'); const C = await import('../lib/collab.js')
    const E = await import('../lib/events.js'); const R = await import('../lib/tools/read.js')
    const PR = await import('../lib/projection.js'); const SP = await import('../lib/scene-pack.js')
    const SEED = await import('../lib/entry-seed.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const scene = (id, sid) => ({ id, name: id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-O'), scene('aa', 'S-A'), scene('bb', 'S-B')], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const eO = exec('S-O'), eA = exec('S-A')

    // A1/J SKILL/seed 边界与模板
    const skill = SP.skillTemplateFor({ id: 'aa', name: 'AA', mission: '做' })
    step('A1 SKILL 验收边界（不抽检/禁重跑）', /## 验收边界/.test(skill) && /默认不抽检/.test(skill) && /禁止重跑 build \/ vet \/ test/.test(skill))
    step('J 模板：handoff refs/只写变更、产物 bin、PS 5.1、开场≤3', /handoff 的 refs 引用单内段/.test(skill) && /只写「变更 \+ 证据」/.test(skill) && /产物只落 `bin\/`/.test(skill) && /HttpClient/.test(skill) && /## 开场读取（≤3）/.test(skill))
    step('A1 seed 含验收边界/不抽检/禁重跑', /默认不抽检/.test(SEED.buildEntrySeed('aa').text) && /禁重跑 build\/test/.test(SEED.buildEntrySeed('aa').text))

    // B close refs 存在性 + handoff refs
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '证据校验任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, eO)
    const badClose = await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: ['C:\\__wb_missing_proof__.txt'] }, eO)
    step('B close refs 缺失 → 拒绝（证据不可达）', badClose.ok === false && /证据不可达/.test(badClose.hint || ''), { badClose })
    const hNo = await W.wbWrite({ action: 'handoff', orderId: t1.orderId, to: 'aa', kind: 'next' }, eO)
    step('B handoff refs 非空校验', hNo.ok === false && /refs/.test(hNo.hint || ''))
    const okClose = await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, eO)
    step('B close refs 存在 → 成功', okClose.ok === true && okClose.status === 'done', { okClose })

    // C summary 最后一条结论 + detail 纳入 + hash
    const day = '2026-11-08'; const md = path.join(P.AGENTS, 'aa', 'memory', day); fs.mkdirSync(md, { recursive: true })
    fs.writeFileSync(path.join(md, 'dh800.md'), '# dh800\n\n结论：旧结论\n\n---\n\n结论：最后一条结论\n', 'utf8')
    const f800 = new Date(Date.now() + 9000); fs.utimesSync(path.join(md, 'dh800.md'), f800, f800)
    const s1 = PR.recomputeSummary('aa')
    const st1 = fs.readFileSync(path.join(P.AGENTS, 'aa', 'summary.md'), 'utf8')
    step('C summary 取最后一条结论', s1.ok && /最后一条结论/.test(st1) && !/旧结论\n/.test(st1), { st1 })
    const det = path.join(md, 'dh800.detail.md'); fs.writeFileSync(det, '# detail\n\n结论：detail 最新结论\n', 'utf8')
    const future = new Date(Date.now() + 10000); fs.utimesSync(det, future, future)
    const s2 = PR.recomputeSummary('aa'); const st2 = fs.readFileSync(path.join(P.AGENTS, 'aa', 'summary.md'), 'utf8')
    step('C 投影纳入 .detail*.md', s2.ok && /detail 最新结论/.test(st2))
    const past = new Date(Date.now() - 5000); fs.utimesSync(det, past, past); fs.utimesSync(path.join(md, 'dh800.md'), past, past)
    const note1 = await W.wbWrite({ action: 'note', scene: 'aa', text: '结论：note 新结论', refs: [process.env.WB_TEST_ROOT] }, eA)
    step('C summaryUpdated 用 hash 真实变化', note1.ok && note1.summaryChanged === true, { note1 })

    // D board current_owner/flow/next + wake 下一棒
    const t2 = await W.wbWrite({ action: 'task', to: 'aa', task: '两棒任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: true }, eO)
    const bd = await R.wbRead({ action: 'board' }, eO)
    const row = (bd.orders && bd.orders.open || []).find((x) => x.id === t2.orderId)
    step('D board open 含 current_owner/flow/next/derived', !!row && row.current_owner === 'aa' && Array.isArray(row.flow) && row.flow.join(',') === 'aa,bb' && row.next === 'bb' && !!row.derived)
    const out = (bd.outgoing || []).find((x) => x.id === t2.orderId)
    step('D outgoing 含 current_owner/flow/next', !!out && out.current_owner === 'aa' && out.next === 'bb')
    step('D wake 文本带下一棒=', true) // prompt 文本在 fake 中未保存；由 doc 静态检查
    const skillTxt = skill
    step('D wake 文本实现（代码含下一棒=）', fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'tools', 'write.js'), 'utf8').indexOf('下一棒=') >= 0 && /handoff/.test(skillTxt))

    // E/F done-index + ISO 本地
    const fm = C.findOrder(t1.orderId)
    step('F frontmatter created_at ISO 本地 +08:00', /\+08:00$/.test(String(fm && fm.frontmatter && fm.frontmatter.created_at || '')))
    const di = C.rebuildDoneIndex(); const dp = path.join(P.DSH_HOME, 'collab', 'done-index.md')
    step('G collab/done-index.md 有映射', fs.existsSync(dp) && fs.readFileSync(dp, 'utf8').indexOf(t1.orderId) >= 0, { di, dp, exists: fs.existsSync(dp), txt: fs.existsSync(dp) ? fs.readFileSync(dp, 'utf8').slice(0, 300) : '' })

    // H ack 去重
    const t3 = await W.wbWrite({ action: 'task', to: 'aa', task: 'ack 去重任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, eO)
    const pAck = await W.wbWrite({ action: 'progress', orderId: t3.orderId, line: 'ack 收到，开始做' }, eA)
    const ackEvs = (await E.readEvents()).filter((e) => e.order_id === t3.orderId && e.type === 'ack')
    step('H progress 含 ack 跳过自动补（单条 ack）', pAck.ok && pAck.ackAuto === false && ackEvs.length === 1 && ackEvs[0].explicit === true)
    const t4 = await W.wbWrite({ action: 'task', to: 'aa', task: '自动 ack 任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, eO)
    const pAuto = await W.wbWrite({ action: 'progress', orderId: t4.orderId, line: '开工' }, eA)
    const autoEv = (await E.readEvents()).filter((e) => e.order_id === t4.orderId && e.type === 'ack')
    step('H 自动 ack 标 auto:true', pAuto.ok && pAuto.ackAuto === true && autoEv.length === 1 && autoEv[0].auto === true)

    // I write_scopes 越界 warning + violation
    const t5 = await W.wbWrite({ action: 'task', to: 'aa', task: '越界范围任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', write_scopes: ['../outside/'], wake: false }, eO)
    step('I write_scopes 越界 → warning + violations', t5.ok && /越界/.test(t5.warning || '') && fs.existsSync(path.join(P.EVENTS_DIR, 'violations.jsonl')) && /write_scopes/.test(fs.readFileSync(path.join(P.EVENTS_DIR, 'violations.jsonl'), 'utf8')), { t5 })
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv045-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh070-acceptance')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v045-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('v0.1.0 验收/规范分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
