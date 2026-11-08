#!/usr/bin/env node
/**
 * external-v025.mjs —— v0.2.5 核心宪法注入分项测试（dh044）：
 *   ① 注入幂等/标记保留/用户内容保留 ② 壳模式不注入 ③ 启动包 SKILL+seed ④ 预览（含保存后刷新）
 * 临时目录+子进程；用法 node tests\external-v025.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const MODE = process.argv[2] === '--child-shell' ? 'shell' : (process.argv[2] === '--child' ? 'external' : '')

async function childMain(mode) {
  const steps = []
  const step = (name, ok, extra) => { steps.push({ name, ok: !!ok, ...(extra || {}) }); return ok }
  try {
    const prompts = []
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') {
          return {
            list: async () => ({ items: [] }),
            create: async () => ({ sessionId: 'S-CORE-1' }),
            rename: async () => ({ ok: true }),
            prompt: async (req) => { prompts.push(req); return { accepted: true } },
          }
        }
        if (name === 'workspaceRegistry') return { list: () => [{ id: 'ws1', title: '工作区', path: process.env.WB_TEST_ROOT }] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const A = await import('../lib/agents-inject.js')
    const AG = path.join(P.DSH_HOME, 'AGENTS.md')
    const readAg = () => fs.existsSync(AG) ? fs.readFileSync(AG, 'utf8') : ''
    const beginCount = (t) => (t.match(/<!-- wb-core:begin -->/g) || []).length
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    if (mode === 'shell') {
      const t = readAg()
      step('壳模式默认不注入（AGENTS.md 无托管段）', beginCount(t) === 0 && !/wb-core:begin/.test(t), { hasFile: fs.existsSync(AG), bytes: t.length })
      return { ok: steps.every((s) => s.ok), steps }
    }

    // 外部：apply 后已注入，且保留用户内容
    let t = readAg()
    step('外部启动注入 AGENTS.md 托管段（含核心宪法）', beginCount(t) === 1 && /核心宪法/.test(t) && /INV-001|记忆写回|只写自己目录/.test(t) && /已注册场景/.test(t), { bytes: t.length })
    step('用户原有内容保留在标记外', t.indexOf('# 用户内容') >= 0 && t.indexOf('- 保留我') >= 0)
    step('写入前备份 AGENTS.md.bak', fs.existsSync(AG + '.bak') && fs.readFileSync(AG + '.bak', 'utf8').indexOf('# 用户内容') >= 0)

    // 幂等：再次 apply 两次，不叠加
    A.injectAgents('test-idempotent')
    A.injectAgents('test-idempotent-2')
    t = readAg()
    step('重复 apply 幂等（标记/内容不叠加）', beginCount(t) === 1 && (t.match(/核心宪法（插件注入/g) || []).length === 1, { beginCount: beginCount(t) })

    // off：移除托管段、保留用户内容
    const cfgFile = P.CONFIG
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    cfg.inject = 'off'
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8')
    A.injectAgents('test-off')
    t = readAg()
    step('config.inject=off → 移除托管段、用户内容保留', beginCount(t) === 0 && t.indexOf('# 用户内容') >= 0)
    cfg.inject = 'on'
    fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8')
    A.injectAgents('test-on')
    step('config.inject=on → 重新注入', beginCount(readAg()) === 1)

    // 启动包：新建协作会话 → SKILL + seed
    const sc = await call('POST', '/plugins/workbench-core/scene', { id: 'core-scene', name: '核心场景', role: '负责核心注入验收', sessionMode: 'new', workspaceId: 'ws1' })
    const scJ = JSON.parse(sc.body)
    const skillFile = path.join(P.DSH_HOME, 'skills', 'core-scene', 'SKILL.md')
    const skill = fs.existsSync(skillFile) ? fs.readFileSync(skillFile, 'utf8') : ''
    step('新建协作会话自动生成 SKILL.md（四段 + 你是…）', sc.code === 200 && fs.existsSync(skillFile) && /你是 核心场景，负责 负责核心注入验收/.test(skill) && ['## 什么时候用', '## 怎么做', '## 交付标准', '## 注意'].every((h) => skill.includes(h)), { bytes: skill.length })
    const seedText = prompts.length ? String(prompts[prompts.length - 1].content[0].text || '') : ''
    step('开场 seed 含 card/summary + 记忆写回规则（v2 entry seed）', prompts.length === 1 && /card\.json/.test(seedText) && /summary\.md/.test(seedText) && /记忆写回/.test(seedText) && /先读/.test(seedText), { seed: seedText.slice(0, 160) })
    step('返回 autoSession.seeded=true（entry-seed）', scJ.autoSession && scJ.autoSession.seeded === true && scJ.autoSession.seedMethod === 'entry-seed')

    // 预览 + 保存全局规则后刷新（v0.2.6：预览只展示 global-rules，不输出内置规则正文）
    const coreSrc = fileURLToPath(new URL('../lib/constitution/core.md', import.meta.url))
    const coreBefore = fs.readFileSync(coreSrc, 'utf8')
    const coreTerms = ['<!-- wb-core:begin', '工作台核心宪法', '场景主权：每个场景只写自己']
    const pv1 = await call('GET', '/plugins/workbench-core/inject/preview')
    const pv1J = JSON.parse(pv1.body)
    step('注入预览只返回全局规则+内置规则条数（无内置规则正文）', pv1.code === 200 && pv1J.injected === true && pv1J.mode === 'on' && typeof pv1J.coreCount === 'number' && pv1J.coreCount > 0 && !('current' in pv1J) && !('section' in pv1J) && coreTerms.every((t) => String(pv1J.preview || '').indexOf(t) < 0), { coreCount: pv1J.coreCount, bytes: (pv1J.preview || '').length, keys: Object.keys(pv1J) })
    step('预览标注内置规则不展示/不可改', /内置规则：\d+ 条/.test(pv1J.preview || '') && /不可修改|不在此展示|不展示/.test(pv1J.preview || ''))
    await call('POST', '/plugins/workbench-core/global-rules', { text: '# 全局规则\n\n- NEW-RULE-XYZ\n' })
    const pv2 = await call('GET', '/plugins/workbench-core/inject/preview')
    const pv2J = JSON.parse(pv2.body)
    step('保存全局规则后预览刷新（含新规则、仍无内置规则正文）', /NEW-RULE-XYZ/.test(pv2J.preview || '') && coreTerms.every((t) => String(pv2J.preview || '').indexOf(t) < 0), { has: /NEW-RULE-XYZ/.test(pv2J.preview || '') })
    const coreAfter = fs.readFileSync(coreSrc, 'utf8')
    step('区域①保存只改 global-rules（内置规则源文件不变）', coreBefore === coreAfter)
    return { ok: steps.every((s) => s.ok), steps, prompts: prompts.length }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

function runChild(mode, env, cwd) {
  const arg = mode === 'shell' ? '--child-shell' : '--child'
  const r = spawnSync(process.execPath, [SELF, arg], { env, cwd, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  try { return JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { return { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 3000), stderr: String(r.stderr || '').slice(0, 3000) } }
}

if (MODE) {
  childMain(MODE).then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv025-'))
  // 外部：无 外壳；用户已有 AGENTS.md
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  fs.writeFileSync(path.join(extData, 'AGENTS.md'), '# 用户内容\n\n- 保留我\n', 'utf8')
  const envExt = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete envExt.DSH_HOME; delete envExt.DSH_CUSTOMER_HOME
  const ext = runChild('external', envExt, extRoot)
  // 壳：有 外壳/scenarios；数据根单独
  const shellRoot = path.join(tmp, 'shell'); fs.mkdirSync(path.join(shellRoot, '外壳', 'scenarios'), { recursive: true })
  const shellData = path.join(shellRoot, 'data'); fs.mkdirSync(shellData, { recursive: true })
  fs.writeFileSync(path.join(shellData, 'AGENTS.md'), '# 壳模式用户内容\n', 'utf8')
  const envShell = { ...process.env, WB_TEST_ROOT: shellRoot, WB_TEST_DATA_ROOT: shellData }
  delete envShell.DSH_HOME; delete envShell.DSH_CUSTOMER_HOME
  const shell = runChild('shell', envShell, shellRoot)
  const report = {
    ok: ext.ok && shell.ok,
    external: ext,
    shell,
    dataRoots: { external: extData, shell: shellData },
  }
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh044-inject')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v025-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('内置基础规则注入分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (ext.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  for (const s of (shell.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
