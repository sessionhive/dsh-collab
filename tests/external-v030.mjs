#!/usr/bin/env node
/**
 * external-v030.mjs —— v0.2.12 极简 UI/无弹层/清唤醒/复验（dh051）：
 *   A 场景卡极简 B 0 弹层（全内联确认） C 两个看板无唤醒 D source=host / PORT_OK E 版本 0.2.12
 * 临时目录+子进程；用法 node tests\external-v030.mjs
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
  try {
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'webServer') return { port: 3999 }
        if (name === 'sessionController') return { list: async () => ({ items: [] }) }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const call = async (method, p) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = ' + V, pkg.version === V, { version: pkg.version })

    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    const board = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    // 工作区看板用真实路径读取（测试运行在工作台外，直接读工作台路径）
    let ws = ''
    try { ws = fs.readFileSync('D:/ChengXu/Ai/Workbench/工作区/看板/index.html', 'utf8') } catch (e) { ws = '' }

    // A 场景卡极简
    const seg = cli.slice(cli.indexOf('function sceneRow'), cli.indexOf('function otherPanel'))
    step('场景卡无「技能」「分组」徽标', seg.indexOf("'技能 '") < 0 && seg.indexOf('S.tagGroup') < 0)
    step('场景卡无子行详情（会话/在途单/今日唤醒）', seg.indexOf('· 会话 ') < 0 && seg.indexOf('· 在途单 ') < 0 && seg.indexOf('今日唤醒') < 0)
    step('归档/未绑定徽标 + 交接/解绑按钮', (seg.indexOf('未绑定') >= 0 || seg.indexOf('会话已归档') >= 0) && seg.indexOf('交接') >= 0 && seg.indexOf('解绑') >= 0)

    // B 0 弹层（全内联确认）
    step('插件内 0 原生弹窗/0 弹层', cli.indexOf('window.confirm') < 0 && cli.indexOf('window.alert') < 0 && cli.indexOf('askConfirm') < 0 && cli.indexOf("position: 'fixed'") < 0 && cli.indexOf('aria-modal') < 0)
    const inlineCount = (cli.match(/requestInlineConfirm\(/g) || []).length
    step('全部确认走内联（requestInlineConfirm ≥ 8 处）', inlineCount >= 8, { count: inlineCount })

    // C 两个看板无唤醒
    step('插件看板无唤醒预算/今日唤醒', board.indexOf('唤醒预算') < 0 && board.indexOf('今日唤醒') < 0 && board.indexOf('wakesToday') < 0)
    step('工作区看板无唤醒预算/今日唤醒', ws.length > 0 && ws.indexOf('唤醒预算') < 0 && ws.indexOf('今日唤醒') < 0)
    const bd = JSON.parse((await call('GET', '/plugins/workbench-core/board-data')).body)
    step('board-data 不再返回唤醒统计/enforceWake', bd.budget && bd.budget.enforceWake === undefined && bd.budget.wakes === undefined && (bd.scenes || []).every((s) => s.wakesToday === undefined))

    // D source=host / PORT_OK
    const ep = JSON.parse((await call('GET', '/plugins/workbench-core/ops/engine-port')).body)
    step('engine-port source=host（实时值）', ep.source === 'host' && ep.enginePort === 3999 && ep.hostPort === 3999, { ep })
    const B = await import('../lib/board.js')
    const html = B.boardHtml()
    const placeholders = (html.match(/__WB_ENGINE_PORT__/g) || []).length
    step('boardHtml HTTP 版只替换赋值占位（哨兵残留=1）', html.indexOf("var INJECTED_PORT = '3999'") >= 0 && placeholders === 1, { placeholders })
    step('未注入 builtin 的赋值/比较都为占位（PORT_OK=false）', (board.match(/__WB_ENGINE_PORT__/g) || []).length >= 2)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv030-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh051-ui-v0212')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v030-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.2.12 极简/无弹层/清唤醒分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
