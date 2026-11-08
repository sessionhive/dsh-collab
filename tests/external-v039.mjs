#!/usr/bin/env node
/**
 * external-v039.mjs —— v0.1.0 第二批：模板/角色/UI（dh062）
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
          list: async () => ({ items: [{ sessionId: 'S-EXIST', title: '已有' }] }),
          create: async () => ({ sessionId: 'S-NEW' }),
          prompt: async (req) => { prompts.push({ sessionId: String(req && req.sessionId || ''), text: String((req && req.content && req.content[0] && req.content[0].text) || '') }); return { accepted: true } },
        }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const store = await import('../lib/store.js')
    const SEED = await import('../lib/entry-seed.js')
    const W = await import('../lib/tools/write.js')
    const C = await import('../lib/collab.js')
    const D = await import('../lib/doctor.js')
    const SP = await import('../lib/scene-pack.js')
    const T = await import('../lib/templates.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    // 内置模板存在
    step('内置 seed/dispatch 模板存在', T.loadTemplate('seed.md').indexOf('先读') >= 0 && T.loadTemplate('dispatch.md').indexOf('交付物') >= 0)

    // 建 dispatcher 场景（未选技能 → 自动 SKILL）
    const sr = await call('POST', '/plugins/workbench-core/scene', { id: 'boss', name: '老板', sessionId: 'S-EXIST', role: '派单', cardRole: 'dispatcher', dispatchOnly: true })
    const sj = JSON.parse(sr.body)
    const card = store.readJson(path.join(P.AGENTS, 'boss', 'card.json'), {})
    step('无角色模型：card.role/dispatch_only 不写入（旧数据忽略）', sr.code === 200 && card.role === undefined && card.dispatch_only === undefined, { card: { role: card.role, dispatch_only: card.dispatch_only } })
    const skillFile = path.join(P.DSH_HOME, 'skills', 'boss', 'SKILL.md')
    step('未选技能自动创建非空 SKILL（含「怎么做」）', fs.existsSync(skillFile) && fs.readFileSync(skillFile, 'utf8').indexOf('## 怎么做') >= 0 && fs.readFileSync(skillFile, 'utf8').length > 80)
    const seed = SEED.buildEntrySeed('boss')
    step('seed 短模板 + 通用协作规则', seed.ok && seed.text.indexOf('先读') >= 0 && seed.text.indexOf('card.json') >= 0 && seed.text.indexOf('summary.md') >= 0 && seed.text.indexOf('三步') >= 0 && seed.text.indexOf('判断归属') >= 0 && seed.text.indexOf('## card 摘要') < 0)
    // 覆盖模板
    const overrideDir = path.join(P.DSH_HOME, 'shared', 'templates'); fs.mkdirSync(overrideDir, { recursive: true })
    fs.writeFileSync(path.join(overrideDir, 'seed.md'), 'CUSTOM-SEED <name> <id> <root> <openOrders> <hardRule>', 'utf8')
    const custom = SEED.buildEntrySeed('boss')
    step('shared/templates/seed.md 可覆盖', custom.text.indexOf('CUSTOM-SEED 老板') >= 0)
    fs.unlinkSync(path.join(overrideDir, 'seed.md'))

    // 派单精简模板 + 必填警告
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'boss', name: '老板', sessions: [{ sessionId: 'S-EXIST' }] }, { id: 'after-end', name: 'after', sessions: [{ sessionId: 'S-AFT' }] }], groups: [] })
    const execBoss = { agent: { session: { header: { id: 'S-EXIST' } } } }
    const t1 = await W.wbWrite({ action: 'task', to: 'after-end', task: '实现功能', loc: 'a.js', forbid: '不改 b', accept: 'curl 通过', evidence: 'a.js', wake: false }, execBoss)
    const o1 = C.findOrder(t1.orderId)
    step('派单文档精简模板（交付物/验收/约束/证据/流程）', t1.ok && o1.text.indexOf('【派单 ' + t1.orderId + '】') >= 0 && o1.text.indexOf('交付物：a.js') >= 0 && o1.text.indexOf('验收：curl 通过') >= 0 && o1.text.indexOf('约束：不改 b') >= 0 && o1.text.indexOf('证据：a.js') >= 0 && o1.text.indexOf('流程：') >= 0)
    const t2 = await W.wbWrite({ action: 'task', to: 'after-end', task: '空字段任务', wake: false }, execBoss)
    step('必填为空警告', t2.ok && /必填项为空/.test(t2.warning || '') && /交付物/.test(t2.warning || ''), { t2 })
    // SKILL 空文件重写
    fs.writeFileSync(skillFile, '---\nname: boss\n---\n\n# x\n\n## 怎么做\n\n', 'utf8')
    const fix = SP.ensureSceneSkill({ id: 'boss', name: '老板', mission: '派单' })
    step('SKILL 空模板 → 重写为非空', fix.ok && fs.readFileSync(skillFile, 'utf8').indexOf('1. 开场读') >= 0)
    // doctor 检查
    const doc = D.runDoctor()
    step('doctor 检查 SKILL 与通用协作规则', doc.checks.some((c) => c.name === 'SKILL 文件') && doc.checks.some((c) => c.name === '协作规则'))
    // UI 静态
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('toast 20 秒自动消失', /20000/.test(cli) && /useToastAutoClear/.test(cli))
    step('编辑脏检测（无改动禁用/无提示）', cli.indexOf('editDirty') >= 0 && cli.indexOf('无改动，无需保存') >= 0 && /disabled: !!editSaving \|\| !editDirty\(\)/.test(cli))
    step('清理区四项保留 + 暂无', cli.indexOf('事件流（events.jsonl）') >= 0 && cli.indexOf('暂无') >= 0 && cli.indexOf('hasWorkspaceItems ? h(') < 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv039-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh062-template-role-ui')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v039-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 模板/角色/UI 分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
