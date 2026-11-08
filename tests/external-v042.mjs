#!/usr/bin/env node
/** external-v042.mjs —— v0.1.0 无角色模型（dh067） */
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
    const W = await import('../lib/tools/write.js'); const C = await import('../lib/collab.js')
    const E = await import('../lib/events.js'); const R = await import('../lib/tools/read.js')
    const SEED = await import('../lib/entry-seed.js'); const SP = await import('../lib/scene-pack.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const scene = (id, sid) => ({ id, name: id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-O'), scene('aa', 'S-A'), scene('bb', 'S-B'), scene('cc', 'S-C')], groups: [] })
    store.writeJson(path.join(P.AGENTS, 'aa', 'card.json'), { id: 'aa', name: '后端', mission: '接口实现与联调', skills: ['backend-dev'] })
    store.writeJson(path.join(P.AGENTS, 'bb', 'card.json'), { id: 'bb', name: '测试', mission: '验证并出测试报告', skills: ['qa'] })
    store.writeJson(path.join(P.AGENTS, 'cc', 'card.json'), { id: 'cc', name: '文档', mission: '写使用文档', skills: [] })
    store.writeJson(path.join(P.AGENTS, 'order', 'card.json'), { id: 'order', name: '主负责人', mission: '受理需求并协调', skills: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const eOrder = exec('S-O'), eA = exec('S-A'), eB = exec('S-B')

    // A 通用规则 & 无角色
    const ui = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('A UI 无角色下拉 / 无 cardRole', ui.indexOf('cardRole') < 0 && ui.indexOf("fieldRow('角色'") < 0)
    const skill = SP.skillTemplateFor({ id: 'aa', name: '后端', mission: '接口' })
    step('A SKILL 通用规则（归属/ack/转交/禁 close/主负责人）', /## 协作规则/.test(skill) && /判断归属/.test(skill) && /先 ack/.test(skill) && /禁止 close/.test(skill) && /主负责人/.test(skill))
    const seed = SEED.buildEntrySeed('aa')
    step('A seed 通用规则（无角色分支）', /所有场景同一套/.test(seed.text) && /判断归属/.test(seed.text) && /最后一棒转交回主负责人/.test(seed.text) && seed.text.indexOf('card.role') < 0)

    // B flow 两种形态 + owner
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: '接口实现', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['bb'], wake: false }, eOrder)
    const o1 = C.findOrder(t1.orderId)
    step('B flow=[别人]：owner 不在 flow / owner 字段兼容', t1.ok && o1.frontmatter.owner === 'order' && o1.frontmatter.dispatcher === 'order' && o1.frontmatter.flow === '[bb]' && o1.frontmatter.current_owner === 'bb')
    const t2 = await W.wbWrite({ action: 'task', to: 'aa', task: '自己+别人', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['order', 'bb'], wake: false }, eOrder)
    const p2 = await W.wbWrite({ action: 'progress', orderId: t2.orderId, line: '主负责人自己做一段' }, eOrder)
    const h2 = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t2.orderId, to: 'bb', kind: 'next', note: '转交测试' }, eOrder)
    step('B flow=[自己,别人]：main owner 先干再转交', t2.ok && p2.ok && h2.ok && C.findOrder(t2.orderId).frontmatter.current_owner === 'bb')

    // C 候选推荐 + board mission/skills
    const cand = await W.wbWrite({ action: 'task', task: '后端接口实现' }, eOrder)
    step('C task 无 assignee → 2~3 候选（按 card 打分）', cand.ok && Array.isArray(cand.candidates) && cand.candidates.length >= 2 && cand.candidates.length <= 3 && cand.candidates[0].id === 'aa', { cand })
    const bd = await R.wbRead({ action: 'board' }, eOrder)
    const row = (bd.scenes || []).find((x) => x.id === 'aa')
    step('C board 含 mission/skills', !!row && row.mission === '接口实现与联调' && Array.isArray(row.skills) && row.skills.includes('backend-dev'))

    // D 三小修
    const t3 = await W.wbWrite({ action: 'task', to: 'aa', task: '交接唤醒', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, eOrder)
    await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t3.orderId, to: 'bb', kind: 'next', note: '交接' }, eA)
    step('D handoff→下一棒补 wake 事件', (await E.readEvents()).some((e) => e.order_id === t3.orderId && e.type === 'wake' && e.reason === 'handoff'))
    const dup1 = await W.wbWrite({ action: 'task', to: 'aa', task: '重复范围测试A', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', write_scopes: ['same/'], wake: false }, eOrder)
    const dup2 = await W.wbWrite({ action: 'task', to: 'bb', task: '重复范围测试B', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', write_scopes: ['same/'], wake: false }, eOrder)
    step('D 重复提示不引用刚建的单', dup2.ok && dup2.warning && dup2.warning.indexOf(dup2.orderId) < 0 && dup2.warning.indexOf(dup1.orderId) >= 0)
    const self = await W.wbWrite({ action: 'task', to: 'aa', task: '主负责人自关测试', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, eOrder)
    await W.wbWrite({ action: 'close', orderId: self.orderId, status: 'done', note: '自关', refs: [process.env.WB_TEST_ROOT] }, eOrder)
    step('D 自关不产生 receipt to=self', !(await E.readEvents()).some((e) => e.order_id === self.orderId && e.type === 'receipt'))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv042-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh067-no-role')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v042-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('v0.1.0 无角色模型分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
