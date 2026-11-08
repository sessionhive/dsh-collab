#!/usr/bin/env node
/**
 * external-v024.mjs —— v0.2.4 外部实测三问题分项测试（dh043）：
 *   ① 工作区选择：/workspaces（host 优先/ storages 兜底）+ 新建会话 cwd=工作区
 *   ② seed 非空：创建后发最短开场消息（fake host prompt 断言被调用）
 *   ③ 分组：改名/删除后 registry 正确、成员回未分组、场景不丢
 *   ④ 新建选组：新场景进组
 * 临时目录+子进程；用法 node tests\external-v024.mjs
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
  const calls = { create: [], prompt: [], rename: [] }
  try {
    const workPath = path.join(process.env.WB_TEST_ROOT, 'real-workspace')
    fs.mkdirSync(workPath, { recursive: true })
    const defaultCwdPath = path.join(process.env.WB_TEST_ROOT, 'default-cwd')
    fs.mkdirSync(defaultCwdPath, { recursive: true })
    let seq = 0
    const fake = {
      list: async () => ({ items: [] }),
      create: async (req) => { calls.create.push(req); return { sessionId: 'session-fake-' + (++seq) } },
      rename: async (req) => { calls.rename.push(req); return { ok: true } },
      prompt: async (req) => { calls.prompt.push(req); return { accepted: true } },
    }
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') return fake
        if (name === 'workspaceRegistry') return { list: () => [{ id: 'ws-real', title: '真实工作区', path: workPath }], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const P = await import('../lib/paths.js')
    const store = await import('../lib/store.js')

    // ① /workspaces（host 优先）
    const ws = await call('GET', '/plugins/workbench-core/workspaces')
    const wsJson = JSON.parse(ws.body)
    step('GET /workspaces 返回 host 工作区', ws.code === 200 && wsJson.source === 'host' && wsJson.workspaces.some((w) => w.id === 'ws-real' && w.path === workPath), { source: wsJson.source, workspaces: wsJson.workspaces })

    // 先建一个分组（整表覆盖）
    await call('POST', '/plugins/workbench-core/groups', { groups: [{ id: 'g1', name: '组一', note: '', members: [] }] })

    // ② 新建协作会话：工作区 cwd + seed + 分组
    const sc = await call('POST', '/plugins/workbench-core/scene', { id: 'ws-scene', name: '工作区场景', sessionMode: 'new', workspaceId: 'ws-real', groupId: 'g1', role: 'r' })
    const scJ = JSON.parse(sc.body)
    const auto = scJ.autoSession || {}
    step('新建会话 cwd=选中工作区（不是 ROOT\\工作区）', sc.code === 200 && auto.ok === true && auto.cwd === workPath && calls.create.some((r) => r.cwd === workPath || r.workspaceId === 'ws-real'), { cwd: auto.cwd, createReq: calls.create[0] })
    step('创建后 seed 非空（host prompt 被调用一次）', auto.seeded === true && auto.seedMethod === 'entry-seed' && calls.prompt.length === 1 && String(calls.prompt[0].content[0].text || '').length > 0, { seeded: auto.seeded, seedMethod: auto.seedMethod, prompts: calls.prompt.length })
    const reg1 = store.readJson(P.REGISTRY, {})
    const g1 = (reg1.groups || []).find((g) => g.id === 'g1')
    step('新建时选组 → 场景进入该组成员', !!g1 && g1.members.includes('ws-scene'), { members: g1 && g1.members })

    // ③ 分组改名
    const rn = await call('POST', '/plugins/workbench-core/groups', { action: 'rename', id: 'g1', name: '组一改' })
    const reg2 = store.readJson(P.REGISTRY, {})
    const g2 = (reg2.groups || []).find((g) => g.id === 'g1')
    step('分组改名后 registry 正确', rn.code === 200 && !!g2 && g2.name === '组一改');

    // ③ 分组删除：成员回未分组、场景不丢
    const del = await call('POST', '/plugins/workbench-core/groups', { action: 'delete', id: 'g1' })
    const reg3 = store.readJson(P.REGISTRY, {})
    const groupsNow = (reg3.groups || [])
    const sceneStill = (reg3.scenes || []).some((s) => s.id === 'ws-scene')
    const groupsModule = await import('../lib/groups.js')
    const gv = groupsModule.readGroups()
    step('删除分组：组消失、成员回未分组、场景不丢', del.code === 200 && groupsNow.length === 0 && sceneStill && !gv.sceneGroup['ws-scene'], { groups: groupsNow.length, sceneStill, sceneGroup: gv.sceneGroup })

    // config.defaultCwd 兜底（不选工作区）
    const cfg = store.readJson(P.CONFIG, {}) || {}
    cfg.defaultCwd = defaultCwdPath
    store.writeJson(P.CONFIG, cfg)
    const sc2 = await call('POST', '/plugins/workbench-core/scene', { id: 'default-cwd-scene', name: '默认cwd场景', sessionMode: 'new' })
    const sc2J = JSON.parse(sc2.body)
    step('未选工作区 → config.defaultCwd 兜底', sc2.code === 200 && sc2J.autoSession && sc2J.autoSession.cwd === defaultCwdPath && sc2J.autoSession.cwdSource === 'config.defaultCwd', { cwd: sc2J.autoSession && sc2J.autoSession.cwd, source: sc2J.autoSession && sc2J.autoSession.cwdSource })

    // ④ UI 源码：工作区/分组 dropdown、改名/删除按钮
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('UI 新建表单有目录/分组下拉', cli.indexOf('目录（自动新建时）') >= 0 && cli.indexOf('分组（可选）') >= 0)
    step('UI 组头有「改名/删除」', cli.indexOf('renameGroupUi') >= 0 && cli.indexOf('deleteGroupUi') >= 0 && cli.indexOf("'改名'") >= 0 && cli.indexOf("'删除'") >= 0)
    return { ok: steps.every((s) => s.ok), steps, calls: { create: calls.create, prompts: calls.prompt, renameCount: calls.rename.length } }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv024-'))
  const dataHome = path.join(tmp, 'custom-dsh')
  fs.mkdirSync(dataHome, { recursive: true })
  const env = { ...process.env, WB_TEST_DATA_ROOT: dataHome, WB_TEST_ROOT: tmp }
  delete env.DSH_HOME
  delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: tmp, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 3000), stderr: String(r.stderr || '').slice(0, 3000) } }
  report.exitCode = r.status
  report.dataRoot = dataHome
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh043-external-v024')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v024-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('外部 v0.2.4 分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
