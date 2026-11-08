#!/usr/bin/env node
/**
 * external-v027.mjs —— v0.2.9 外部实测 5 问题分项（dh048）：
 *   ① 分组保存二次确认 ② 会话标题隐藏 ③ 看板写盘 ④ 资源路径无中文 ⑤ seed 绝对根+三步收口
 * 临时目录+子进程；用法 node tests\external-v027.mjs
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
    const workPath = path.join(process.env.WB_TEST_ROOT, 'app-workspace')
    fs.mkdirSync(workPath, { recursive: true })
    let seq = 0
    const fake = {
      list: async () => ({ items: [] }),
      create: async () => ({ sessionId: 'session-v29-' + (++seq) }),
      rename: async () => ({ ok: true }),
      prompt: async (req) => { prompts.push(req); return { accepted: true } },
    }
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') return fake
        if (name === 'workspaceRegistry') return { list: () => [{ id: 'ws-app', title: 'app 目录', path: workPath }] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const O = await import('../lib/ops.js')
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

    // ③ 看板写盘（bootstrap 已写）
    const boardFile = path.join(P.DSH_HOME, 'board', 'index.html')
    const builtin = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('内置看板写到 <dataRoot>\\board\\index.html（英文目录）', fs.existsSync(boardFile) && fs.readFileSync(boardFile, 'utf8').indexOf('var INJECTED_PORT') >= 0 && builtin.length > 0, { file: boardFile })

    // ④ 资源路径无中文（trash/temp/backups/board 均在 dataRoot 下且英文）
    const op = O.opsPaths()
    const paths = Object.values(op)
    step('ops 资源路径全英文且位于 dataRoot 下', paths.every((p) => !/[\u4e00-\u9fa5]/.test(p) && p.toLowerCase().startsWith(P.DSH_HOME.toLowerCase()) && ['trash', 'temp', 'backups', 'board'].some((n) => p.toLowerCase().indexOf('\\' + n) >= 0)), { paths })
    step('BOARD_HTML 不再引用中文目录', !/[\u4e00-\u9fa5]/.test(P.BOARD_HTML) && P.BOARD_HTML.toLowerCase().indexOf('\\board\\index.html') >= 0, { board: P.BOARD_HTML })

    // ⑤ 新建协作会话 → seed 绝对根 + 内联摘要 + 三步收口
    const sc = await call('POST', '/plugins/workbench-core/scene', { id: 'seed-scene', name: '种子场景', role: '负责种子验收', sessionMode: 'new', workspaceId: 'ws-app' })
    const scJ = JSON.parse(sc.body)
    const seed = prompts.length ? String(prompts[prompts.length - 1].content[0].text || '') : ''
    step('seed 使用绝对数据根（无相对 agents 路径）', seed.indexOf(P.DSH_HOME) >= 0 && !/`agents[\\/]/.test(seed) && !/`summary\.md/.test(seed), { seedHead: seed.slice(0, 160) })
    step('seed 含内联摘要 + 无单即收出口（v2）', /先读/.test(seed) && /无单即收/.test(seed), { hasSum: /summary 四段/.test(seed) })
    step('seed 含固定三步 + 规则（v2）', /三步：/.test(seed) && /规则：/.test(seed) && /数据根/.test(seed), { len: seed.length })
    step('seed 长度 ≤300 tokens 预算（≤1100 字符）', seed.length > 0 && seed.length <= 1100, { chars: seed.length })
    step('新建后 SKILL.md 自动生成（启动包保留）', fs.existsSync(path.join(P.DSH_HOME, 'skills', 'seed-scene', 'SKILL.md')))

    // ① / ② UI 源码
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('分组保存：提交后出「确定/取消」二次确认（取消不写）', /groupConfirm/.test(cli) && /确定保存？/.test(cli) && /onClick: doSaveGroup/.test(cli) && /onClick: cancelGroupConfirm/.test(cli))
    step('会话标题输入已移除（自动新建=名称 / 选已有=只读标题）', cli.indexOf('会话标题（默认=会话名称）') < 0 && cli.indexOf('会话标题自动 = 会话名称') >= 0 && cli.indexOf('标题（只读）') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv027-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh048-external-v029')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v027-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.2.9 外部 5 问题分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
