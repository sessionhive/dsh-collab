#!/usr/bin/env node
/**
 * external-v040.mjs —— v0.1.0 E2E：编辑感知/技能/一单 flow 三棒/回执/文件名/board/拖拽/UI
 */
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
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') return {
          list: async () => ({ items: [] }),
          create: async () => ({ sessionId: 'S-NEW' }),
          prompt: async (req) => {
            const sid = String((req && req.sessionId) || '')
            const text = String((req && req.content && req.content[0] && req.content[0].text) || '')
            prompts.push({ sessionId: sid, text })
            return { accepted: true }
          },
        }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const store = await import('../lib/store.js')
    const W = await import('../lib/tools/write.js')
    const R = await import('../lib/tools/read.js')
    const C = await import('../lib/collab.js')
    const E = await import('../lib/events.js')
    const AI = await import('../lib/agents-inject.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const scene = (id, sid) => ({ id, name: id.toUpperCase(), sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [scene('order', 'S-ORD'), scene('aa', 'S-A'), scene('bb', 'S-B'), scene('cc', 'S-C'), scene('after-end', 'S-AFT')], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const eOrder = exec('S-ORD'), eA = exec('S-A'), eB = exec('S-B'), eC = exec('S-C')

    // A 编辑感知：保存不发消息、card_version++、工具提示、AGENTS 版本行
    const before = prompts.length
    const ed = await call('POST', '/plugins/workbench-core/scene', { id: 'aa', name: 'A2', sessionId: 'S-A', role: '新职责', confirm: true })
    const card = store.readJson(path.join(P.AGENTS, 'aa', 'card.json'), {})
    step('编辑保存不发消息 + card_version++', ed.code === 200 && prompts.length === before && Number(card.card_version) >= 1, { prompts: prompts.length - before, v: card.card_version, ed: ed.body.slice(0, 300) })
    const r1 = await R.wbRead({ action: 'check' }, eA)
    const r2 = await R.wbRead({ action: 'check' }, eA)
    const CV = await import('../lib/card-version.js')
    const notice1 = CV.consumeConfigNotice(eA), notice2 = CV.consumeConfigNotice(eA)
    const rtSrc = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'runtime.js'), 'utf8')
    step('下次 wb_read 带 configNotice（只一次）', /配置已更新/.test(notice1) && !notice2 && /重读 card\+summary/.test(notice1) && rtSrc.indexOf('consumeConfigNotice(exec)') >= 0, { notice1 })
    const sec = AI.buildSection()
    step('AGENTS 托管段含场景身份/card v/更新时间', /场景身份：/.test(sec) && /card v\d+/.test(sec) && /更新 /.test(sec))

    // B/C SKILL 角色硬规则 + 自动创建
    const sr = await call('POST', '/plugins/workbench-core/scene', { id: 'dev', name: '开发', sessionId: 'S-A', cardRole: 'implementer', role: '开发' })
    const devSkill = path.join(P.DSH_HOME, 'skills', 'dev', 'SKILL.md')
    step('自动创建 SKILL + 通用协作规则（ack/转交/禁 close）', sr.code === 200 && fs.existsSync(devSkill) && /## 协作规则/.test(fs.readFileSync(devSkill, 'utf8')) && /先 ack/.test(fs.readFileSync(devSkill, 'utf8')) && /禁止 close/.test(fs.readFileSync(devSkill, 'utf8')))
    const boss = await call('POST', '/plugins/workbench-core/scene', { id: 'boss2', name: '老板2', sessionId: 'S-ORD', cardRole: 'dispatcher', role: '派单' })
    const bossSkill = path.join(P.DSH_HOME, 'skills', 'boss2', 'SKILL.md')
    step('SKILL 无角色分支（同一套通用规则）', boss.code === 200 && /## 协作规则/.test(fs.readFileSync(bossSkill, 'utf8')) && /判断归属/.test(fs.readFileSync(bossSkill, 'utf8')) && /主负责人/.test(fs.readFileSync(bossSkill, 'utf8')))

    // D/E 一单 flow 三棒 + 回执 + 文件名
    const t = await W.wbWrite({ action: 'task', to: 'aa', task: '实现+测试+文档（一单）', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', write_scopes: ['flow/'], flow: ['aa', 'bb', 'cc'], wake: false }, eOrder)
    const o = C.findOrder(t.orderId)
    step('一单 flow 三棒建单（文件名无双后缀）', t.ok && /^dh\d+-aa\.md$/.test(path.basename(o.file)) && o.frontmatter.flow === '[aa, bb, cc]')
    await W.wbWrite({ action: 'progress', orderId: t.orderId, line: 'a开工' }, eA)
    const h1 = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t.orderId, to: 'bb', kind: 'next', note: '给B' }, eA)
    await W.wbWrite({ action: 'progress', orderId: t.orderId, line: 'b开工' }, eB)
    const h2 = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t.orderId, to: 'cc', kind: 'next', note: '给C' }, eB)
    await W.wbWrite({ action: 'progress', orderId: t.orderId, line: 'c开工' }, eC)
    const h3 = await W.wbWrite({ action: 'handoff', refs: [process.env.WB_TEST_ROOT], orderId: t.orderId, to: 'order', kind: 'next', note: '回派单方' }, eC)
    step('flow 三棒 handoff 自动唤醒下一棒', h1.ok && h2.ok && h3.ok && ['S-B', 'S-C', 'S-ORD'].every((sid) => prompts.some((p) => p.sessionId === sid)))
    const cl = await W.wbWrite({ action: 'close', orderId: t.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, eOrder)
    const doneText = C.findOrder(t.orderId).text
    step('三棒段头 + 自关无 receipt', cl.ok && ['## 派单', '## 接管-aa', '## 接管-bb', '## 接管-cc', '## 交接-bb', '## 交接-cc', '## 交接-order', '## 终态'].every((x) => doneText.indexOf(x) >= 0) && !(await E.readEvents()).some((e) => e.order_id === t.orderId && e.type === 'receipt'))
    const split = await W.wbWrite({ action: 'task', to: 'aa', task: '测试任务拆分', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', wake: false }, eOrder)
    step('测试/文档/联调未给 flow → 不拆单警告', split.ok && /未给 flow/.test(split.warning || '') && /flow 接力/.test(split.warning || ''))
    const ov1 = await W.wbWrite({ action: 'task', to: 'aa', task: '重叠A', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', write_scopes: ['same/'], wake: false }, eOrder)
    const ov2 = await W.wbWrite({ action: 'task', to: 'bb', task: '重叠B', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', write_scopes: ['same/'], wake: false }, eOrder)
    step('5 分钟内同 dispatcher 重叠 scope → 警告（force 可强制）', ov1.ok && ov2.ok && /5 分钟内/.test(ov2.warning || '') && /force/.test(ov2.warning || ''))
    const ov3 = await W.wbWrite({ action: 'task', to: 'cc', task: '重叠C-force', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', write_scopes: ['same/'], wake: false, force: true }, eOrder)
    step('force 强制不警告', ov3.ok && !/5 分钟内/.test(ov3.warning || ''))
    // board 摘要
    const bd = await R.wbRead({ action: 'board' }, eOrder)
    const row = (bd.orders && bd.orders.open || []).find((x) => x.id === split.orderId)
    step('board 任务摘要读 ## 派单 首行', !!row && /测试任务拆分/.test(row.task || ''), { row })

    // UI 静态
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('技能 UI 无新技能 id 输入/缺失自动创建提示', cli.indexOf('新技能 id') < 0 && cli.indexOf('将自动创建') >= 0)
    step('⋮ 三项（导出/打开角色卡/复制 id）+ 降级', cli.indexOf('导出快照') >= 0 && cli.indexOf('打开角色卡') >= 0 && cli.indexOf('复制会话 id') >= 0 && cli.indexOf('openRoleCard') >= 0)
    step('清理区四项保留 + 暂无（不整块隐藏）', cli.indexOf('事件流（events.jsonl）') >= 0 && cli.indexOf('暂无') >= 0 && cli.indexOf('hasWorkspaceItems ? h(') < 0)
    step('拖拽 ghost/组高亮/插入线', cli.indexOf('ghost:') >= 0 && cli.indexOf('dragOverGroup') >= 0 && cli.indexOf('insertLine') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv040-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 4000), stderr: String(r.stderr || '').slice(0, 3000) } }
  report.exitCode = r.status
  report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh063-ui-hardening')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v040-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 E2E 分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
