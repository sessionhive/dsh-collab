#!/usr/bin/env node
/**
 * external-v028.mjs —— v0.2.10 定稿 4+1（dh049）：
 *   ① 0 原生弹窗 ② 端口注入/自定义 ③ 阈值徽标/闸状态 ④ 归档检测/重绑/orphaned ⑤ 版本 0.2.10
 * 临时目录+子进程；用法 node tests\external-v028.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  try {
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') {
          return {
            list: async () => ({ items: [{ sessionId: 'S-OLD', contextTokens: 70000 }, { sessionId: 'S-NEW', contextTokens: 1000 }] }),
            create: async () => ({ sessionId: 'S-NEW' }),
            rename: async () => ({ ok: true }),
            prompt: async (req) => { prompts.push(req); return { accepted: true } },
          }
        }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: ['S-OLD'] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const store = await import('../lib/store.js')
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
    // 默认 cwd（自动新建接力会话需要）
    const workDir = path.join(process.env.WB_TEST_ROOT, 'app-workspace'); fs.mkdirSync(workDir, { recursive: true })
    const cfg0 = store.readJson(P.CONFIG, {}) || {}
    cfg0.defaultCwd = workDir
    store.writeJson(P.CONFIG, cfg0)

    // ② 端口：保存自定义 → 文件版注入
    const sp = await call('POST', '/plugins/workbench-core/ops/engine-port', { port: 3999 })
    const ep = await call('GET', '/plugins/workbench-core/ops/engine-port')
    const epJ = JSON.parse(ep.body)
    step('自定义引擎端口写入 config 并回读', sp.code === 200 && epJ.enginePort === 3999, { port: epJ.enginePort })
    const B = await import('../lib/board.js')
    const bfile = B.ensureBoardPage(3999)
    const html = fs.readFileSync(P.BOARD_HTML, 'utf8')
    step('文件版看板注入实际端口（赋值已注入）', bfile.ok === true && html.indexOf('var INJECTED_PORT = \'3999\'') >= 0, { file: P.BOARD_HTML })

    // 准备场景/订单/记忆
    const reg = { schemaVersion: 1, scenes: [{ id: 'demo', name: '归档场景', skill: 'demo', panels: [{ panelId: 'demo-ai', type: 'harness' }], sessions: [{ panelId: 'demo-ai', sessionId: 'S-OLD', title: '旧会话' }], memoryRoot: 'agents/demo', summary: 'agents/demo/summary.md' }], groups: [] }
    store.writeJson(P.REGISTRY, reg)
    store.writeJson(path.join(P.AGENTS, 'demo', 'card.json'), { schemaVersion: 1, id: 'demo', name: '归档场景', mission: '负责归档测试', skills: ['demo'] })
    store.writeAtomic(path.join(P.AGENTS, 'demo', 'summary.md'), '# 归档场景\n\n## 在做\n- 测试重绑\n\n## 下一步\n- 完成接力\n\n## 卡点\n- 无\n')
    store.writeAtomic(path.join(P.AGENTS, 'demo', 'memory', '2026-11-06', 'dh900.md'), '# dh900\n\n- 旧记忆\n')
    const W = await import('../lib/tools/write.js')
    const tr = await W.wbWrite({ action: 'task', to: 'demo', task: '归档场景孤儿单测试', wake: false }, { agent: { session: { header: { id: 'S-HOST' } } } })
    // ③ 阈值/归档：board-data
    const bd = await call('GET', '/plugins/workbench-core/board-data')
    const bdJ = JSON.parse(bd.body)
    const demo = (bdJ.scenes || []).find((s) => s.id === 'demo') || {}
    const ord = (bdJ.orders.open || []).find((o) => o.id === tr.orderId) || {}
    step('board-data 返回上下文压力（host 有 contextTokens）', demo.contextTokens === 70000 && demo.pressure === 'warn', { contextTokens: demo.contextTokens, pressure: demo.pressure })
    step('board-data 无唤醒闸字段（v0.2.12 起取消）', bdJ.budget && bdJ.budget.enforceWake === undefined && bdJ.budget.warnContextTokens >= 1)
    step('归档会话被检测（场景徽标数据）', demo.archived === true && demo.sessionId === 'S-OLD', { archived: demo.archived })
    step('归档 assignee 的在途单标 orphaned（不取消）', ord.orphaned === true && ord.status === 'orphaned' && ord.state !== 'done')
    // 阈值可配置：调低 warn 阈值 → fail
    const cfg = store.readJson(P.CONFIG, {}) || {}
    cfg.handover = Object.assign({}, cfg.handover, { warnContextTokens: 1000, contextThresholdTokens: 5000 })
    store.writeJson(P.CONFIG, cfg)
    const bd2 = JSON.parse((await call('GET', '/plugins/workbench-core/board-data')).body)
    const demo2 = (bd2.scenes || []).find((s) => s.id === 'demo') || {}
    step('阈值 ≥ warn/contextThreshold 分别标黄/红', demo2.pressure === 'fail' && demo2.contextTokens === 70000, { pressure: demo2.pressure })

    // ④ orphaned 事件
    await call('GET', '/plugins/workbench-core/orphaned')
    const evText = store.readText(P.EVENTS_FILE)
    step('orphaned 记录+事件（type=orphaned）', /"type":"orphaned"/.test(evText), { has: /"type":"orphaned"/.test(evText) })

    // ④ 重绑：自动新建 + 接力摘要 + handover 事件 + 更新 registry
    const rb = await call('POST', '/plugins/workbench-core/scene/rebind', { id: 'demo', autoCreate: true })
    const rbJ = JSON.parse(rb.body)
    const reg2 = store.readJson(P.REGISTRY, {})
    const sc2 = (reg2.scenes || []).find((s) => s.id === 'demo') || {}
    const sessNew = sc2.sessions && sc2.sessions[0] ? sc2.sessions[0].sessionId : ''
    const jsonl = store.readText(path.join(P.DSH_HOME, 'sessions.jsonl'))
    const seed = prompts.length ? String(prompts[prompts.length - 1].content[0].text || '') : ''
    step('重新绑定：自动新建 + 更新 registry 会话', rb.code === 200 && rbJ.newSessionId === 'S-NEW' && sessNew === 'S-NEW', { sessNew, new: rbJ.newSessionId })
    step('sessions.jsonl 写 handover(old→new, reason=archived)', /"type":"handover"/.test(jsonl) && /"from":"S-OLD"/.test(jsonl) && /"to":"S-NEW"/.test(jsonl) && /"reason":"archived"/.test(jsonl))
    step('接力 seed 含摘要+三步收口（绝对路径）', seed.indexOf(P.DSH_HOME) >= 0 && /接力摘要|## 在做/.test(seed) && /收口三步/.test(seed) && /回执 3 行内/.test(seed), { seedHead: seed.slice(0, 160) })

    // ④ 手动标记/取消
    const ma = await call('POST', '/plugins/workbench-core/sessions/archive', { sessionId: 'S-NEW', archived: true })
    const ses = JSON.parse((await call('GET', '/plugins/workbench-core/sessions')).body)
    const row = (ses.sessions || []).find((x) => x.sessionId === 'S-NEW') || {}
    const um = await call('POST', '/plugins/workbench-core/sessions/archive', { sessionId: 'S-NEW', archived: false })
    step('手动标记/取消归档生效', ma.code === 200 && row.archived === true && um.code === 200)

    // ① 0 原生弹窗（client）
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('插件内 0 处弹层/原生弹窗（内联确认）', cli.indexOf('window.confirm') < 0 && cli.indexOf('window.alert') < 0 && cli.indexOf('askConfirm') < 0 && cli.indexOf("position: 'fixed'") < 0 && /requestInlineConfirm/.test(cli) && /runInlineConfirm/.test(cli))
    step('看板/场景阈值与归档 UI 文案存在', cli.indexOf('上下文偏高') >= 0 && cli.indexOf('建议换会话') >= 0 && (cli.indexOf('会话已归档') >= 0 || cli.indexOf('原组：') >= 0) && cli.indexOf('交接') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv028-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 3000), stderr: String(r.stderr || '').slice(0, 3000) } }
  report.exitCode = r.status
  report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh049-external-v0210')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v028-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.2.10 外部定稿分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
