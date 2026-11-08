#!/usr/bin/env node
/**
 * external-v023.mjs —— 外部 DSH 可用性分项测试（dh042）：
 *   ① /board 内置页（无 工作区\看板）② 唤醒降级 ③ 无壳 watch registry → scene-index ④ 清理区路径 flags ⑤ 自带自检
 * 临时目录 + 子进程，不污染本工作台；结束删除。用法：node tests\external-v023.mjs
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    const IX = await import('../lib/index.js')
    const routes = []
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { routes.push(o) } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get() { return undefined },
    }
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await routes[0].handler(req, res)
      return out
    }
    // 1) /board 内置页（无 工作区\看板）
    const board = await call('GET', '/plugins/workbench-core/board')
    step('/board 200（无工作区/看板，用插件内置 HTML）', board.code === 200 && board.body.includes('会话协作看板'), { code: board.code, bytes: board.body.length })
    const bd = await call('GET', '/plugins/workbench-core/board-data')
    let bdJson = {}
    try { bdJson = JSON.parse(bd.body) } catch (e) { bdJson = {} }
    step('/board-data root = config.dataRoot', bd.code === 200 && bdJson.root === process.env.WB_TEST_DATA_ROOT, { root: bdJson.root })

    // 准备 registry 场景（无壳：直接写 registry）
    const store = await import('../lib/store.js')
    const reg = store.readJson(P.REGISTRY, {}) || { scenes: [], groups: [] }
    reg.scenes = [{ id: 'demo', name: '演示', skill: 'demo', panels: [{ panelId: 'demo-ai', type: 'harness' }], sessions: [{ panelId: 'demo-ai', sessionId: 'S-DEMO', title: '演示' }], memoryRoot: 'agents/demo', summary: 'agents/demo/summary.md' }]
    store.writeJson(P.REGISTRY, reg)
    await sleep(1600)  // 无壳 watch 启动跑

    // 2) 自带自检（无 工具\）
    const R = await import('../lib/tools/read.js')
    const chk = await R.wbRead({ action: 'check' })
    step('wb_read(check) 自带自检（mode=builtin，4 项有结果）', chk.ok === true && chk.mode === 'builtin' && chk.checks.length === 4 && chk.degraded === false, { mode: chk.mode, checks: chk.checks.map((x) => x.name + ':' + x.ok) })

    // 3) 无壳 watch registry → scene-index 重算
    const idxFile = path.join(P.META, 'scene-index.md')
    const before = fs.existsSync(idxFile) ? fs.readFileSync(idxFile, 'utf8') : ''
    reg.scenes.push({ id: 'watched', name: '外部监听场景', skill: 'watched', panels: [], sessions: [] })
    store.writeJson(P.REGISTRY, reg)
    await sleep(2600)
    const after = fs.existsSync(idxFile) ? fs.readFileSync(idxFile, 'utf8') : ''
    step('无壳 watch registry → scene-index 1s 防抖重算', after !== before && after.includes('watched'), { beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after) })

    // 4) 唤醒降级（无 host sessionController）
    const W = await import('../lib/tools/write.js')
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })
    const tr = await W.wbWrite({ action: 'task', to: 'demo', task: '外部唤醒降级测试', wake: true }, exec('S-OTHER'))
    step('唤醒不可用 → 明确降级（只落盘、不报错）', tr.ok === true && tr.wake && tr.wake.attempted === true && tr.wake.ok === false && tr.wake.degraded === true && /手动提醒/.test(tr.wake.hint || ''), { wake: tr.wake })

    // 5) 清理区路径 flags（外部无工作区 → false，UI 应隐藏）
    const ops = await import('../lib/ops.js')
    const info = ops.opsInfo()
    step('清理区路径 flags（trash/backups/temp=false）', info.paths && info.paths.trash === false && info.paths.backups === false && info.paths.temp === false, { paths: info.paths })

    // 6) 源码：UI 有隐藏/不适用提示
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('清理区保留、无「不适用」提示行（v0.2.17 删除）', cli.indexOf('dataRoot 下无 trash / backups / temp，不适用') < 0 && /hasTrash/.test(cli) && cli.indexOf('高级 · 数据清理') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv023-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh042-external-v023')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v023-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('外部 v0.2.3 分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
