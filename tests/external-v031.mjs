#!/usr/bin/env node
/**
 * external-v031.mjs —— v0.2.13 会话协作生命周期（dh052）：
 *   三态 active/pending/archived、筛选/折叠、恢复回原组、删除进 trash、导出目录、看板计数、无弹框、版本
 * 临时目录+子进程；用法 node tests\external-v031.mjs
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
    const workDir = path.join(process.env.WB_TEST_ROOT, 'app-workspace'); fs.mkdirSync(workDir, { recursive: true })
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') {
          let n = 0
          return {
            list: async () => ({ items: [] }),
            create: async () => ({ sessionId: 'S-NEW-' + (++n) }),
            rename: async () => ({ ok: true }),
            prompt: async () => ({ accepted: true }),
          }
        }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
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
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = ' + V, pkg.version === V, { version: pkg.version })
    const cfg = store.readJson(P.CONFIG, {}) || {}; cfg.defaultCwd = workDir; store.writeJson(P.CONFIG, cfg)

    const writeScene = (id, sid, lifecycle, archivedAt, lastGroup) => {
      const row = { id, name: id.toUpperCase(), skill: id, panels: [{ panelId: id + '-ai', type: 'harness' }], sessions: sid ? [{ panelId: id + '-ai', sessionId: sid, title: 's' }] : [], memoryRoot: 'agents/' + id, summary: 'agents/' + id + '/summary.md' }
      if (lifecycle) row.lifecycle = lifecycle
      if (archivedAt) row.archivedAt = archivedAt
      if (lastGroup) row.lastGroup = lastGroup
      return row
    }
    const base = { schemaVersion: 1, scenes: [writeScene('demo', 'S-ACT', null, null, null), writeScene('old', null, 'archived', '2025-01-01T00:00:00.000Z', 'g1')], groups: [{ id: 'g1', name: '组一', members: ['demo'] }] }
    store.writeJson(P.REGISTRY, base)
    for (const id of ['demo', 'old', 'exp']) {
      store.writeJson(path.join(P.AGENTS, id, 'card.json'), { schemaVersion: 1, id, name: id.toUpperCase(), mission: 'm' })
      store.writeAtomic(path.join(P.AGENTS, id, 'summary.md'), '# ' + id + '\n\n## 在做\n- x\n')
      store.writeAtomic(path.join(P.AGENTS, id, 'memory', '2026-11-06', 'n.md'), '# n\n')
      store.writeAtomic(path.join(P.DSH_HOME, 'skills', id, 'SKILL.md'), '# ' + id + '\n')
    }

    const scenes0 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const byId = {}; (scenes0.scenes || []).forEach((s) => { byId[s.id] = s })
    step('三态：active/pending/archived 推导', byId.demo.state === 'active' && byId.old.state === 'archived' && (scenes0.lifecycle || {}).active === 1 && (scenes0.lifecycle || {}).archived === 1, { states: Object.fromEntries(Object.entries(byId).map(([k, v]) => [k, v.state])) })

    // 解绑 → pending，记录 lastGroup
    const ub = await call('POST', '/plugins/workbench-core/scene/unbind', { id: 'demo' })
    const sc1 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const d1 = (sc1.scenes || []).find((s) => s.id === 'demo')
    step('解绑 → 待处理（清绑定 + 移出分组 + lastGroup 记录）', ub.code === 200 && d1.state === 'pending' && !(sc1.groups || []).some((g) => (g.members || []).includes('demo')), { state: d1.state })

    // 重新绑定（自动新建）→ active + 回原组
    const rb = await call('POST', '/plugins/workbench-core/scene/rebind', { id: 'demo', autoCreate: true })
    const sc2 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const d2 = (sc2.scenes || []).find((s) => s.id === 'demo')
    step('重新绑定 → 在用（新建会话 + 回 lastGroup）', rb.code === 200 && d2.state === 'active' && (sc2.groups || []).some((g) => g.id === 'g1' && (g.members || []).includes('demo')), { state: d2.state })

    // 归档 → archived + lastGroup + 移出分组
    const ar = await call('POST', '/plugins/workbench-core/scene/archive', { id: 'demo' })
    const sc3 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const d3 = (sc3.scenes || []).find((s) => s.id === 'demo')
    step('归档 → 已归档（lifecycle + archivedAt + lastGroup，移出分组）', ar.code === 200 && d3.state === 'archived' && d3.archivedAt && d3.lastGroup === 'g1' && !(sc3.groups || []).some((g) => (g.members || []).includes('demo')), { state: d3.state, lastGroup: d3.lastGroup })

    // 恢复 → pending + 回原组
    const rs = await call('POST', '/plugins/workbench-core/scene/restore', { id: 'demo' })
    const sc4 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const d4 = (sc4.scenes || []).find((s) => s.id === 'demo')
    step('恢复 → 回原组（待处理）', rs.code === 200 && d4.state === 'pending' && (sc4.groups || []).some((g) => g.id === 'g1' && (g.members || []).includes('demo')), { state: d4.state })

    // 删除到 trash（agents 一起）
    const del = await call('POST', '/plugins/workbench-core/scene/delete', { id: 'demo', confirm: true })
    const dj = JSON.parse(del.body)
    step('删除 → dataRoot/trash（agents 一起移入，registry 移除）', del.code === 200 && dj.dest && dj.dest.toLowerCase().indexOf(path.join(P.DSH_HOME, 'trash').toLowerCase()) === 0 && fs.existsSync(path.join(dj.dest, 'agents-demo')) && !fs.existsSync(path.join(P.AGENTS, 'demo', 'card.json')))

    // 导出快照
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [writeScene('exp', 'S-EXP')], groups: [] })
    const ex = await call('POST', '/plugins/workbench-core/scene/export', { id: 'exp' })
    const ej = JSON.parse(ex.body)
    const has = (rel) => fs.existsSync(path.join(ej.dir || '', rel))
    step('导出快照 → dataRoot/exports/<scene>-<yyyymmdd-HHmm>/（card/summary/memory/skill）', ex.code === 200 && ej.dir && ej.dir.toLowerCase().indexOf(path.join(P.DSH_HOME, 'exports').toLowerCase()) === 0 && /-\d{8}-\d{4}$/.test(ej.dir) && has('card.json') && has('summary.md') && has('memory') && has('skill/exp/SKILL.md'), { dir: ej.dir })

    // 看板计数/可清理（补一个 30 天前归档场景）
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [writeScene('exp', 'S-EXP'), writeScene('old', null, 'archived', '2025-01-01T00:00:00.000Z', 'g1')], groups: [] })
    const bd = JSON.parse((await call('GET', '/plugins/workbench-core/board-data')).body)
    step('看板 lifecycle 计数 + 归档>30 天可清理数', bd.lifecycle && bd.lifecycle.active >= 1 && bd.lifecycle.oldArchived >= 1, { lifecycle: bd.lifecycle })
    const board = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    step('看板保留可清理标签', board.indexOf('可清理') >= 0)

    // UI 静态：筛选/折叠/无弹框/内联删除
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('UI 两 tab（在用/归档）+ 归档隐藏新建', cli.indexOf("'在用'") >= 0 && cli.indexOf("'归档'") >= 0 && cli.indexOf("'待处理'") < 0 && cli.indexOf('viewingArch') >= 0)
    step('插件内 0 弹框（内联确认删除）', cli.indexOf('window.confirm') < 0 && cli.indexOf('askConfirm') < 0 && cli.indexOf("position: 'fixed'") < 0 && /doDeleteScene/.test(cli) && /requestInlineConfirm/.test(cli))
    step('搜索/拖拽入口存在', cli.indexOf('scenesQuery') >= 0 && cli.indexOf('startDragTimer') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv031-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh052-lifecycle')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v031-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.2.13 生命周期分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
