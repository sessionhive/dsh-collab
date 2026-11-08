#!/usr/bin/env node
/**
 * config-dataroot.mjs —— 验证 cordis config.dataRoot 优先级（dh041）
 * 在子进程里：清掉 DSH_HOME/DSH_CUSTOMER_HOME，apply(ctx, {dataRoot}) → 插件数据根必须 = config 值，
 * bootstrap 建在该目录；/board-data 的 root 也指向它。临时目录，结束删除。
 * 用法：node tests\config-dataroot.mjs
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
  try {
    const IX = await import('../lib/index.js')
    const routes = []
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { routes.push(o) } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get() { return undefined },
    }
    const dataRoot = process.env.WB_TEST_DATA_ROOT
    await IX.apply(ctx, { dataRoot })
    const P = await import('../lib/paths.js')
    step('paths.DSH_HOME = config.dataRoot（无 DSH_HOME env）', P.DSH_HOME === dataRoot, { DSH_HOME: P.DSH_HOME, dataRoot, envDshHome: process.env.DSH_HOME || '' })
    step('bootstrap 建在 config.dataRoot', fs.existsSync(path.join(dataRoot, '_meta', 'config.json')) && fs.existsSync(path.join(dataRoot, 'events')))
    // 走 HTTP handler 读 board-data.root
    const out = { code: 0, body: '' }
    const req = { method: 'GET', url: '/plugins/workbench-core/board-data', on(ev, fn) { if (ev === 'end') fn() }, destroy() { } }
    const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
    await routes[0].handler(req, res)
    let j = null
    try { j = JSON.parse(out.body) } catch (e) { j = null }
    step('/board-data root 指向 config.dataRoot', out.code === 200 && j && j.ok && j.root === dataRoot, { code: out.code, root: j && j.root })
    const S = await import('../lib/sessions.js')
    const lr = await S.listSessions()
    step('无 host sessionController → unbound=[] + 明确原因', lr.ok === false && Array.isArray(lr.items) && /sessionController|手填/.test(lr.reason || ''), { reason: lr.reason })
    const R = await import('../lib/tools/read.js')
    const chk = await R.wbRead({ action: 'check' })
    step('wb_read(check) 外部无工具层 → 自带自检/清晰说明', chk.ok === true && (chk.mode === 'builtin' || /外部环境无工具层/.test(chk.degradedReason || '')), { mode: chk.mode, degradedReason: chk.degradedReason, hint: chk.hint })
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dataroot-'))
  const dataHome = path.join(tmp, 'custom-dsh')
  fs.mkdirSync(dataHome, { recursive: true })
  const env = { ...process.env, WB_TEST_DATA_ROOT: dataHome }
  delete env.DSH_HOME
  delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: tmp, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 3000), stderr: String(r.stderr || '').slice(0, 3000) } }
  report.exitCode = r.status
  report.dataRoot = dataHome
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh041-external')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'config-dataroot-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('config.dataRoot 验证：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
