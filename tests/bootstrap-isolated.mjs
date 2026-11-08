#!/usr/bin/env node
/**
 * bootstrap-isolated.mjs —— 外部 DSH 隔离冒烟（dh032）：
 *   在临时目录造一个只有 DSH_HOME、没有 外壳\ 的环境，跑 bootstrap + registry 场景 + wb_read/wb_write + search；
 *   全程不碰本工作台；结束删临时目录。用法：node tests/bootstrap-isolated.mjs
 *   退出码 0 = 通过；报告写 工作区\证据\dh032-portability\isolated-report.json（相对当前工作台根，可缺省）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.argv.includes('--child')

function childMain() {
  const out = { ok: false, steps: [] }
  const step = (name, ok, extra) => { out.steps.push({ name, ok: !!ok, ...(extra || {}) }); return ok }
  const run = async () => {
    const P = await import('../lib/paths.js')
    step('paths: 无外壳也能解析', P.HAS_GUI === false && P.DSH_HOME && fs.existsSync(P.DSH_HOME), { DSH_HOME: P.DSH_HOME, HAS_GUI: P.HAS_GUI, ROOT: P.ROOT })
    const B = await import('../lib/bootstrap.js')
    const boot = B.ensureBootstrap()
    step('bootstrap: 建目录/缺省文件', fs.existsSync(P.AGENTS) && fs.existsSync(P.COLLAB) && fs.existsSync(P.BLACKBOARD) && fs.existsSync(P.GLOBAL_RULES) && fs.existsSync(P.CONFIG) && fs.existsSync(P.REGISTRY), { created: boot.created.length })
    const boot2 = B.ensureBootstrap()
    step('bootstrap: 幂等（已存在不覆盖）', boot2.created.length === 0)
    const store = await import('../lib/store.js')
    const reg = store.readJson(P.REGISTRY, {})
    step('bootstrap: registry 空场景', Array.isArray(reg.scenes) && reg.scenes.length === 0)
    // 直接写一条 registry 场景（模拟无外壳时 POST /scene 的落点）
    reg.scenes = [{ id: 'demo', name: '演示会话', panels: [{ panelId: 'demo-ai', type: 'harness' }], sessions: [{ panelId: 'demo-ai', sessionId: 'S-DEMO' }], skill: 'demo', memoryRoot: 'agents/demo', summary: 'agents/demo/summary.md' }]
    store.writeJson(P.REGISTRY, reg)
    const R = await import('../lib/tools/read.js')
    const W = await import('../lib/tools/write.js')
    const chk = await R.wbRead({ action: 'check' })
    step('wb_read(check) 外部环境可用（生成器缺失=degraded）', chk.ok === true, { checks: chk.checks.map((c) => ({ name: c.name, ok: c.ok, degraded: !!c.degraded })) })
    const note = await W.wbWrite({ action: 'note', scene: 'demo', text: '结论：外部 DSH 冒烟通过（来源：isolated 测试）。', refs: ['isolated-report.json'] }, { agent: { session: { header: { id: 'S-DEMO' } } } })
    step('wb_write(note) 写入暂存数据根', note.ok === true && fs.existsSync(path.join(P.AGENTS, 'demo', 'memory')), { file: note.file })
    const scene = await R.wbRead({ action: 'scene', scene: 'demo' })
    step('wb_read(scene) 读回卡片/摘要', scene.ok === true && String(scene.summary || '').length > 0)
    const sr = await R.wbRead({ action: 'search', q: '冒烟', limit: 5 })
    step('wb_read(search) grep 命中', sr.ok === true && sr.hits.length > 0, { hits: sr.hits.map((h) => h.path) })
    const sr2 = await R.wbRead({ action: 'search', scene: 'demo', limit: 3 })
    step('wb_read(search) scene 过滤', sr2.ok === true && sr2.hits.length > 0)
    const S = await import('../lib/sentinel.js'); const H = await import('../lib/health.js'); const RI = await import('../lib/rules-inject.js')
    const sp = S.scanOverdue({ minutes: 0, now: Date.now() })
    const hp = H.aggregate()
    const rp = RI.buildInject()
    step('骨架可 import（sentinel/health/rules-inject）', sp.ok === true && hp.ok === true && rp.ok === true, { healthScenes: hp.scenes, rulesBytes: hp.rulesBytes })
    // 无外壳：插件 apply + POST /scene 直写 registry（不写 scenarios json）
    const routes = []
    const ctx = { tools: { register() { } }, webServer: { register(o) { routes.push(o) } }, effect(fn) { try { fn() } catch (e) { /* ignore */ } } }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, {})
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data') fn(Buffer.from(JSON.stringify(body || {}), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await routes[0].handler(req, res)
      return out
    }
    const scRes = await call('POST', '/plugins/workbench-core/scene', { id: 'route-demo', name: '路由演示', sessionId: 'S-ROUTE', skills: ['demo'], role: 'r' })
    const regAfter = store.readJson(P.REGISTRY, {})
    const scJson = JSON.parse(scRes.body || '{}')
    step('无外壳：apply 可起 + POST /scene 直写 registry', scRes.code === 200 && regAfter.scenes.some((s) => s.id === 'route-demo') && !fs.existsSync(path.join(P.ROOT, '外壳')), { code: scRes.code, id: scJson.id, scenes: regAfter.scenes.map((s) => s.id) })
    const sr3 = await R.wbRead({ action: 'search', scene: 'route-demo', limit: 3 })
    step('无外壳：新场景可读（search scene）', sr3.ok === true, { hits: sr3.hits.length })
    out.ok = out.steps.every((s) => s.ok)
    return out
  }
  run().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String((e && e.stack) || e)); process.exit(2) })
}

if (CHILD) childMain()
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dsh-external-'))
  const home = path.join(tmp, 'dsh-home')
  fs.mkdirSync(home, { recursive: true })
  const env = { ...process.env, DSH_HOME: home, DSH_CUSTOMER_HOME: '', DSH_WORKBENCH_ROOT: tmp, DSH_SHELL_DIR: '' }
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: tmp, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 2000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status
  report.tmpDir = tmp
  const evidenceDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh032-portability')
  try { fs.mkdirSync(evidenceDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evidenceDir, 'isolated-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('隔离冒烟：' + (report.ok ? '✓ 通过' : '✗ 失败') + '（' + (report.steps || []).length + ' 步）')
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
