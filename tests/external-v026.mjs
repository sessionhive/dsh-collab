#!/usr/bin/env node
/**
 * external-v026.mjs —— v0.2.7 稳定性分项测试（dh046）：
 *   ① GET /doctor 逐项结果 + 不可写工作区被拦截提示
 *   ② writeTextGuarded stale 自动重试一次（不静默覆盖）
 *   ③ registry/config 并发改动 → concurrent-change 事件 + 提示
 *   ④ UI 无宪法入口（「打开宪法文件」按钮已移除）+ doctor 卡片
 * 临时目录+子进程；用法 node tests\external-v026.mjs
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
    const store = await import('../lib/store.js')
    const C = await import('../lib/concurrency.js')
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    // ① doctor 正常
    const doc = await call('GET', '/plugins/workbench-core/doctor')
    const dj = JSON.parse(doc.body)
    const names = (dj.checks || []).map((c) => c.name)
    step('GET /doctor 200 + 逐项结果（dataRoot/工作区/目录/config/版本/注入）', doc.code === 200 && dj.ok === true && ['dataRoot', '工作区 cwd', '必需目录', 'config.json', 'registry.json', '插件版本', '注入状态'].every((n) => names.includes(n)) && dj.version === V, { version: dj.version, checks: dj.checks.map((c) => c.name + ':' + c.status) })
    // ① 不可写目标：defaultCwd 指向一个文件
    const fakeCwd = path.join(process.env.WB_TEST_ROOT, 'not-a-dir.txt')
    fs.writeFileSync(fakeCwd, 'x', 'utf8')
    const cfg = store.readJson(P.CONFIG, {}) || {}
    cfg.defaultCwd = fakeCwd
    store.writeJson(P.CONFIG, cfg)
    const scBad = await call('POST', '/plugins/workbench-core/scene', { id: 'bad-cwd', name: '坏cwd', sessionMode: 'new' })
    let scJ = {}
    try { scJ = JSON.parse(scBad.body) } catch (e) { scJ = {} }
    step('不可写工作区被拦截（PRT-015 明确提示换一个）', scBad.code === 400 && scJ.rule === 'PRT-015' && /不可写/.test(scJ.hint || '') && /换一个工作区/.test(scJ.hint || ''), { hint: (scJ.hint || '').slice(0, 120) })
    const doc2 = await call('GET', '/plugins/workbench-core/doctor')
    const dj2 = JSON.parse(doc2.body)
    const cwdCheck = (dj2.checks || []).find((c) => c.name === '工作区 cwd')
    step('doctor 不可写时该项为 fail/warn', !!cwdCheck && cwdCheck.status !== 'ok', { status: cwdCheck && cwdCheck.status })
    cfg.defaultCwd = ''
    store.writeJson(P.CONFIG, cfg)

    // ② stale 自动重试一次
    const f = path.join(process.env.WB_TEST_ROOT, 'stale.txt')
    fs.writeFileSync(f, 'A', 'utf8')
    let hooked = 0
    const w = await C.writeTextGuarded(f, (existing) => existing + 'B', { reason: 'test-stale', onBeforeCommit: (attempt) => { if (attempt === 0) { hooked++; fs.writeFileSync(f, 'X' + fs.readFileSync(f, 'utf8'), 'utf8') } } })
    const finalText = fs.readFileSync(f, 'utf8')
    step('stale 自动重试一次成功（重读合并、不静默覆盖）', w.ok === true && w.retried === true && hooked === 1 && finalText === 'XAB', { retried: w.retried, final: finalText })
    const f2 = path.join(process.env.WB_TEST_ROOT, 'stale2.txt')
    fs.writeFileSync(f2, 'A', 'utf8')
    const w2 = await C.writeTextGuarded(f2, (existing) => existing + 'B', { reason: 'test-stale-fail', onBeforeCommit: () => { fs.writeFileSync(f2, 'Y' + fs.readFileSync(f2, 'utf8'), 'utf8') } })
    step('两次都被改 → 返回 stale+原因（不覆盖）', w2.ok === false && w2.stale === true && /并发改动/.test(w2.reason || '') && /未覆盖/.test(w2.reason || ''), { reason: w2.reason })

    // ③ registry/config 并发检测
    const rh = C.hashFile(P.REGISTRY)
    fs.writeFileSync(P.REGISTRY, fs.readFileSync(P.REGISTRY, 'utf8') + '\n\n', 'utf8')
    const rw = C.writeJsonGuardedSync(P.REGISTRY, { scenes: [], groups: [] }, { expectedHash: rh, reason: 'test-registry' })
    step('registry 被外部改动 → 取消写入 + concurrent 提示', rw.ok === false && rw.concurrent === true && /外部改动/.test(rw.reason || ''), { reason: rw.reason })
    const ch = C.hashFile(P.CONFIG)
    fs.writeFileSync(P.CONFIG, fs.readFileSync(P.CONFIG, 'utf8') + '\n\n', 'utf8')
    const ops = await import('../lib/ops.js')
    const bw = ops.saveBudget({ wakePerScenePerDay: 9 }, { expectedHash: ch })
    step('config 被外部改动 → 保存返回 concurrent 提示', bw.ok === false && bw.concurrent === true && /外部改动/.test(bw.hint || ''), { hint: bw.hint })
    const evText = store.readText(P.EVENTS_FILE)
    const concurrentCount = (evText.match(/"type":"concurrent-change"/g) || []).length
    step('并发改动写入 events（type=concurrent-change）', concurrentCount >= 2, { count: concurrentCount })

    // ④ UI 无宪法入口 + doctor 卡片
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('区域①无「打开宪法文件」等宪法入口', cli.indexOf('打开宪法文件') < 0 && cli.indexOf('宪法说明') < 0 && cli.indexOf('openFile(\'constitution') < 0 && cli.indexOf('openFile(\'constitutionDoc') < 0)
    step('其他设置有 doctor 结果卡', cli.indexOf('启动预检') >= 0 && cli.indexOf('loadDoctor') >= 0 && cli.indexOf('/doctor') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv026-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh046-stability')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v026-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.2.7 稳定性分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
