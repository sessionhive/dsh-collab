#!/usr/bin/env node
/**
 * external-v034.mjs —— v0.1.0 UI 细节 9 项（dh055）：
 *   搜索独立行、无展开收起、⋮ 浮窗、隐藏 doctor/端口/路径、保存+边缘状态、事件流勾选清理、版本
 * 临时目录+子进程；用法 node tests\external-v034.mjs
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
      get() { return undefined },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const E = await import('../lib/events.js')
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = ' + V, pkg.version === V, { version: pkg.version })

    // ⑨ 事件流：recent 列表 + 勾选清理进 trash
    for (let i = 0; i < 12; i++) await E.logEvent({ type: i % 2 ? 'wake' : 'record', from: 'gui-remould', to: 'command', text: '事件-' + i })
    const ev1 = JSON.parse((await call('GET', '/plugins/workbench-core/ops/events')).body)
    step('事件流返回最近列表（时间/类型/摘要）', Array.isArray(ev1.recent) && ev1.recent.length >= 12 && ev1.recent[0].line > 0 && ev1.recent[0].ts && ev1.recent[0].type && ev1.recent[0].summary, { n: ev1.recent && ev1.recent.length })
    const targetLines = [ev1.recent[0].line, ev1.recent[1].line]
    const del = JSON.parse((await call('POST', '/plugins/workbench-core/ops/events/delete', { lines: targetLines, confirm: true })).body)
    const ev2 = JSON.parse((await call('GET', '/plugins/workbench-core/ops/events')).body)
    step('勾选清理：选中行进回收站（行数减少+backup）', del.ok && del.removed === 2 && ev2.lines === ev1.lines - 2 && del.backup && fs.existsSync(path.join(P.DSH_HOME, del.backup)), { del: del.removed, before: ev1.lines, after: ev2.lines })

    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    // ① 搜索独立行（tab 行之后）
    const tabPos = cli.indexOf("t[0] === 'active' ? activeCount")
    const searchPos = cli.indexOf("placeholder: '按场景名/组名搜索'")
    step('搜索独立行在 tab 下方（输入框+搜索按钮）', tabPos >= 0 && searchPos > tabPos && cli.indexOf("}, '搜索')") >= 0 && cli.indexOf('🔍') < 0)
    // ② 无展开/收起
    step('无「展开/收起」按钮', cli.indexOf('全部展开') < 0 && cli.indexOf('全部收起') < 0)
    // ③ ⋮ 浮窗
    step('⋮ 小浮窗（absolute + data-wb-menu + Esc/外部关闭）', /menu: \{[^}]*position: 'absolute'/.test(cli) && cli.indexOf('data-wb-menu') >= 0 && cli.indexOf("e.key === 'Escape'") >= 0 && /closest\('\[data-wb-menu\]'\)/.test(cli))
    // ④ doctor 标题
    step('「启动预检」去掉（doctor）', cli.indexOf('启动预检（doctor）') < 0 && cli.indexOf("'启动预检'") >= 0)
    // ⑤ 端口当前行 / ⑥ 行为预算写入行 / ⑧ 路径提示
    step('隐藏端口「当前：」/「写入 _meta」/「配置：_meta」提示', cli.indexOf('当前：') < 0 && cli.indexOf('写入 _meta') < 0 && cli.indexOf('配置：_meta') < 0)
    // ⑦ 保存按钮 + 边缘状态
    step('Token 阈值按钮「保存」+ 右侧状态小字', /onClick: saveToken, style: S\.(btnMini|btn) \}, '保存'/.test(cli) && /budgetMsg \? h\('span'/.test(cli))
    // ⑨ UI 勾选列表
    step('事件流分区保留（v0.1.0 F）', cli.indexOf('事件流（events.jsonl）') >= 0 && cli.indexOf('暂无') >= 0 && cli.indexOf('数据目录 / 插件版本') < 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv034-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh055-ui-detail')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v034-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 UI 细节分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
