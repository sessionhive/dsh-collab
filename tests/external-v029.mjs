#!/usr/bin/env node
/**
 * external-v029.mjs —— v0.2.11 宿主新决策（dh050）：
 *   A 无唤醒闸  B 端口 live host/probe 归属校验/哨兵/重建  C 诊断 profile/版本对比
 *   D 归档重绑/解除绑定（仅文件模式）  E 版本 0.2.11
 * 临时目录+子进程；用法 node tests\external-v029.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expectedVersion } from './_version.mjs'

const V = expectedVersion()

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.argv.includes('--child')

async function childMain() {
  const steps = []
  const step = (name, ok, extra) => { steps.push({ name, ok: !!ok, ...(extra || {}) }); return ok }
  const prompts = []
  const servers = []
  try {
    const dataRoot = process.env.WB_TEST_DATA_ROOT
    // 两个本地 server：right root 匹配 / wrong root 不匹配
    const mkServer = (root) => new Promise((resolve) => {
      const srv = http.createServer((req, res) => {
        if (req.url && req.url.indexOf('/plugins/workbench-core/board-data') === 0) {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, root, scenes: [] }))
        } else {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true, root }))
        }
      })
      srv.listen(0, '127.0.0.1', () => resolve(srv))
    })
    const rightSrv = await mkServer(dataRoot); servers.push(rightSrv)
    const wrongSrv = await mkServer(path.join(process.env.WB_TEST_ROOT, 'other-data')); servers.push(wrongSrv)
    const rightPort = rightSrv.address().port
    const wrongPort = wrongSrv.address().port
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'webServer') return { port: wrongPort }
        if (name === 'sessionController') {
          return {
            list: async () => ({ items: [] }),
            create: async () => ({ sessionId: 'S-NEW' }),
            rename: async () => ({ ok: true }),
            prompt: async (req) => { prompts.push(req); return { accepted: true } },
          }
        }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot })
    const P = await import('../lib/paths.js')
    const store = await import('../lib/store.js')
    const EP = await import('../lib/engine-port.js')
    const D = await import('../lib/diagnostics.js')
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    // 版本
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = ' + V, pkg.version === V, { version: pkg.version })

    // A 无唤醒闸（client UI / script 源码）
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    const board = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('UI 无唤醒闸/上限（enforceWake/wakePerScenePerDay 不出现）', cli.indexOf('enforceWake') < 0 && cli.indexOf('wakePerScenePerDay') < 0)
    step('看板无唤醒预算卡/今日唤醒列', board.indexOf('唤醒预算') < 0 && board.indexOf('今日唤醒') < 0 && board.indexOf('wakesToday') < 0)
    const cf = JSON.parse((await call('GET', '/plugins/workbench-core/ops/config')).body)
    step('预算信息不再含 enforceWake（v0.2.12 取消）', !cf.budget || cf.budget.enforceWake === undefined, { budget: cf.budget })
    const cfg = store.readJson(P.CONFIG, {}) || {}
    cfg.budget = Object.assign({}, cfg.budget, { enforceWake: true, wakePerScenePerDay: 1 })
    store.writeJson(P.CONFIG, cfg)
    for (let i = 0; i < 3; i++) { const E = await import('../lib/events.js'); await E.logEvent({ type: 'wake', to: 'demo', status: 'ok' }) }
    const B = await import('../lib/budget.js')
    const cw = B.canWake('demo')
    step('代码门禁取消：超上限仍 ok（仅统计）', cw.ok === true && cw.gate === 'disabled' && cw.used >= 3, { used: cw.used, gate: cw.gate })

    // B 端口：live host（真相）优先
    const pinfo = JSON.parse((await call('GET', '/plugins/workbench-core/ops/engine-port')).body)
    step('实时 host 端口优先（webServer.port 作真相）', pinfo.enginePort === wrongPort, { port: pinfo.enginePort, hostPort: wrongPort })
    // probe 归属校验：wrong 的 root 不匹配 → 自动探测采信 config 里匹配的 right 端口
    const sv = JSON.parse((await call('POST', '/plugins/workbench-core/ops/engine-port', { port: rightPort })).body)
    step('saveEnginePort 成功并重建文件版看板', sv.ok === true && fs.existsSync(P.BOARD_HTML) && fs.readFileSync(P.BOARD_HTML, 'utf8').indexOf(String(rightPort)) >= 0, { saved: sv })
    const det = await EP.detectEnginePort()
    step('probe 校验 /board-data root 与本地 dataRoot 一致才采信', det.ok === true && det.port === rightPort && det.matchedBy === 'board-data.root', { det })
    // 哨兵：文件版赋值处已注入，比较处保留占位（未注入回退探测）
    const fileHtml = fs.readFileSync(P.BOARD_HTML, 'utf8')
    step('board-page 哨兵修复（赋值注入 / 比较残留占位）', fileHtml.indexOf("var INJECTED_PORT = '" + rightPort + "'") >= 0 && fileHtml.indexOf("INJECTED_PORT !== '__WB_ENGINE_PORT__'") >= 0)
    const s2 = JSON.parse((await call('POST', '/plugins/workbench-core/ops/engine-port', { port: 4001 })).body)
    step('再存端口自动重建文件版', s2.ok === true && fs.readFileSync(P.BOARD_HTML, 'utf8').indexOf('4001') >= 0, { s2 })

    // C 诊断
    const profArg = process.env.WB_TEST_PROFILE_ARG
    const pi = JSON.parse((await call('GET', '/plugins/workbench-core/plugin-info')).body)
    step('plugin-info profile 从 argv/ctx 推导（外部 profiles\\desktop）', /profiles[\\/]desktop$/i.test(String(pi.profile || '')), { profile: pi.profile, arg: profArg })
    step('engine.version 读不到 → unknown(原因)', pi.engine && pi.engine.version === 'unknown' && /读不到/.test(pi.engine.versionReason || ''), { engine: pi.engine })
    const doctor = JSON.parse((await call('GET', '/plugins/workbench-core/doctor')).body)
    const vc = (doctor.checks || []).find((c) => c.name.indexOf('版本一致性') >= 0)
    step('doctor 增加运行 vs 磁盘版本对比项', !!vc && /运行 /.test(vc.detail) && /磁盘 /.test(vc.detail), { detail: vc && vc.detail })

    // D 归档 + 重绑 + 解除绑定/仅文件模式
    const reg = { schemaVersion: 1, scenes: [{ id: 'demo', name: '归档场景', skill: 'demo', panels: [{ panelId: 'demo-ai', type: 'harness' }], sessions: [{ panelId: 'demo-ai', sessionId: 'S-OLD', title: '旧' }], memoryRoot: 'agents/demo', summary: 'agents/demo/summary.md' }], groups: [] }
    store.writeJson(P.REGISTRY, reg)
    store.writeJson(path.join(P.AGENTS, 'demo', 'card.json'), { schemaVersion: 1, id: 'demo', name: '归档场景', mission: '负责归档' })
    store.writeAtomic(path.join(P.AGENTS, 'demo', 'summary.md'), '# 归档场景\n\n## 在做\n- 测试\n\n## 下一步\n- 接力\n\n## 卡点\n- 无\n')
    // 手动标记归档 → 场景徽标数据
    await call('POST', '/plugins/workbench-core/sessions/archive', { sessionId: 'S-OLD', archived: true })
    const scenes1 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const demo1 = (scenes1.scenes || []).find((s) => s.id === 'demo') || {}
    step('归档检测（手动标记兜底）+ 徽标数据', (demo1.sessionArchived === true || demo1.archived === true) && (cli.indexOf('会话已归档') >= 0 || cli.indexOf('原组：') >= 0))
    // 解除绑定（仅文件模式）
    const ub = await call('POST', '/plugins/workbench-core/scene/unbind', { id: 'demo' })
    const reg2 = store.readJson(P.REGISTRY, {})
    const sc2 = (reg2.scenes || []).find((s) => s.id === 'demo') || {}
    step('解除绑定（仅文件模式）：无会话但 card/summary 保留', ub.code === 200 && (sc2.sessions || []).length === 0 && fs.existsSync(path.join(P.AGENTS, 'demo', 'card.json')) && fs.existsSync(path.join(P.AGENTS, 'demo', 'summary.md')))
    // 重新绑定自动新建
    const workDir = path.join(process.env.WB_TEST_ROOT, 'app-workspace'); fs.mkdirSync(workDir, { recursive: true })
    const cfg2 = store.readJson(P.CONFIG, {}) || {}; cfg2.defaultCwd = workDir; store.writeJson(P.CONFIG, cfg2)
    const rb = await call('POST', '/plugins/workbench-core/scene/rebind', { id: 'demo', autoCreate: true })
    const rbJ = JSON.parse(rb.body)
    const seed = prompts.length ? String(prompts[prompts.length - 1].content[0].text || '') : ''
    step('解除绑定后重新绑定成功（接力 seed 三步）', rb.code === 200 && rbJ.newSessionId === 'S-NEW' && /收口三步/.test(seed) && /回执 3 行内/.test(seed), { new: rbJ.newSessionId })
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  } finally {
    for (const s of servers) { try { s.close() } catch (e) { /* ignore */ } }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv029-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const profDir = path.join(extRoot, 'profiles', 'desktop'); fs.mkdirSync(profDir, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData, WB_TEST_PROFILE_ARG: profDir }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME; delete env.DSH_PROFILE
  const r = spawnSync(process.execPath, [SELF, '--child', profDir], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 3000), stderr: String(r.stderr || '').slice(0, 3000) } }
  report.exitCode = r.status
  report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh050-external-v0211')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v029-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.2.11 外部定稿分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
