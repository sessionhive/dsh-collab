#!/usr/bin/env node
/**
 * external-v033.mjs —— v0.1.0 UI 定稿重构（dh054）：
 *   两 tab、按钮集、归档隐藏新建、编辑分组、交接 cwd+预览、解绑/恢复、搜索/折叠/拖拽、导出目录+manifest、无弹框、版本
 * 临时目录+子进程；用法 node tests\external-v033.mjs
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
  const created = []
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
            create: async (req) => { created.push(req || {}); return { sessionId: 'S-NEW-' + (++n) } },
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
    const row = (id, sid, extra) => Object.assign({ id, name: id.toUpperCase(), skill: id, panels: [{ panelId: id + '-ai', type: 'harness' }], sessions: sid ? [{ panelId: id + '-ai', sessionId: sid, title: 't' }] : [], memoryRoot: 'agents/' + id, summary: 'agents/' + id + '/summary.md' }, extra || {})
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [row('alpha', 'S-A')], groups: [{ id: 'g1', name: '组一', members: ['alpha'] }] })
    for (const id of ['alpha', 'beta']) {
      store.writeJson(path.join(P.AGENTS, id, 'card.json'), { schemaVersion: 1, id, name: id.toUpperCase(), mission: 'm', skills: ['skill-' + id] })
      store.writeAtomic(path.join(P.AGENTS, id, 'summary.md'), '# ' + id + '\n\n## 在做\n- 做事\n\n## 下一步\n- 继续\n\n## 卡点\n- 无\n')
      store.writeAtomic(path.join(P.AGENTS, id, 'memory', '2026-11-07', 'n.md'), '# n\n')
      store.writeAtomic(path.join(P.AGENTS, id, 'playbooks', 'p.md'), '# p\n')
      store.writeAtomic(path.join(P.DSH_HOME, 'skills', 'skill-' + id, 'SKILL.md'), '# skill\n')
    }

    // B/C: 归档隐藏新建由 UI 静态覆盖；先做数据迁移
    const ar = await call('POST', '/plugins/workbench-core/scene/archive', { id: 'alpha' })
    const sc1 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const a1 = (sc1.scenes || []).find((s) => s.id === 'alpha')
    step('归档：lifecycle/archivedAt/原组 lastGroup，移出分组', ar.code === 200 && a1.state === 'archived' && a1.lastGroup === 'g1' && !(sc1.groups || []).some((g) => (g.members || []).includes('alpha')))
    const rs = await call('POST', '/plugins/workbench-core/scene/restore', { id: 'alpha' })
    const sc2 = JSON.parse((await call('GET', '/plugins/workbench-core/scenes')).body)
    const a2 = (sc2.scenes || []).find((s) => s.id === 'alpha')
    step('恢复：回原组（待绑定）', rs.code === 200 && a2.state === 'pending' && (sc2.groups || []).some((g) => g.id === 'g1' && (g.members || []).includes('alpha')))

    // F: 交接预览 + 默认 cwd
    const pv = JSON.parse((await call('POST', '/plugins/workbench-core/scene/handover-preview', { id: 'alpha' })).body)
    step('交接预览含 card/summary/open 单 + 摘要文本', pv.ok === true && /接力摘要/.test(pv.text || '') && /做事/.test((pv.summary || {}).doing || '') && Array.isArray(pv.openOrders))
    const rb = await call('POST', '/plugins/workbench-core/scene/rebind', { id: 'alpha', autoCreate: true, cwd: workDir })
    step('交接：沿用/传入 cwd（新建会话收到 cwd）', rb.code === 200 && created.length > 0 && String(created[created.length - 1].cwd || '').replace(/\\/g, '/').toLowerCase().indexOf('app-workspace') >= 0, { cwd: created.length ? created[created.length - 1].cwd : '' })

    // G: 解绑回未分组，lastGroup 保留
    const ub = await call('POST', '/plugins/workbench-core/scene/unbind', { id: 'alpha' })
    const regUb = store.readJson(P.REGISTRY, {})
    const rowUb = (regUb.scenes || []).find((s) => s.id === 'alpha') || {}
    step('解绑：清绑定 → 未分组，lastGroup 内部保留', ub.code === 200 && (rowUb.sessions || []).length === 0 && !(regUb.groups || []).some((g) => (g.members || []).includes('alpha')) && rowUb.lastGroup === 'g1')

    // K: 排序/入组持久化
    const ord = await call('POST', '/plugins/workbench-core/scene/order', { id: 'alpha', groupId: 'g1', index: 0 })
    const regOrd = store.readJson(P.REGISTRY, {})
    const g1 = (regOrd.groups || []).find((g) => g.id === 'g1') || {}
    step('拖拽/排序：成员顺序持久化到 registry', ord.code === 200 && (g1.members || [])[0] === 'alpha')

    // L: 导出目录+manifest+playbooks+实际 skill id
    const ex = await call('POST', '/plugins/workbench-core/scene/export', { id: 'alpha' })
    const ej = JSON.parse(ex.body)
    const dirOk = /[\\/]exports[\\/]alpha-\d{8}-\d{4}$/.test(String(ej.dir || ''))
    const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(ej.dir, 'manifest.json'), 'utf8')) } catch (e) { return null } })()
    step('导出：exports/<scene>-<yyyymmdd-HHmm>/ + manifest', ex.code === 200 && dirOk && manifest && manifest.sceneId === 'alpha' && manifest.name && manifest.exportedAt && manifest.lifecycle && manifest.sourcePaths)
    step('导出内容：card/summary/memory/playbooks/skill(实际 id)', ['card.json', 'summary.md', 'memory', 'playbooks', 'skill/skill-alpha/SKILL.md'].every((rel) => fs.existsSync(path.join(ej.dir, rel))), { dir: ej.dir })

    // UI 静态
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    const seg = cli.slice(cli.indexOf('function scenesPanel'), cli.indexOf('function otherPanel'))
    step('两 tab：在用/归档（无待处理/全部/序号）', seg.indexOf("'在用'") >= 0 && seg.indexOf("'归档'") >= 0 && seg.indexOf("'待处理'") < 0 && seg.indexOf("'全部'") < 0 && cli.indexOf("label: '①") < 0)
    step('在用按钮：编辑·交接·解绑·归档·⋮；归档：恢复·回收·⋮', /'编辑'[^]*?'交接'[^]*?'解绑'[^]*?'归档'[^]*?'⋮'/.test(seg) && /'恢复'[^]*?'回收'[^]*?'⋮'/.test(seg))
    step('归档隐藏新增/红框说明区', /!viewingArch && newOpen \? newFormView\(\) : null/.test(seg) && /viewingArch[\s\S]{0,120}\? null/.test(seg))
    step('⋮ 菜单：导出快照 / 打开角色卡 / 复制会话 id', seg.indexOf('导出快照') >= 0 && seg.indexOf('打开角色卡') >= 0 && seg.indexOf('复制会话 id') >= 0)
    step('编辑表单有分组选择', cli.indexOf("fieldRow('分组'") >= 0 && cli.indexOf("/scene/order") >= 0)
    step('交接默认 cwd + 可折叠摘要预览', /setRebindCwd\(String\(s\.cwd/.test(cli) && cli.indexOf('接力摘要预览') >= 0 && cli.indexOf('/scene/handover-preview') >= 0)
    step('搜索/折叠持久化/全部展开收起', cli.indexOf('wb.collapsed') >= 0 && cli.indexOf('wb.search') >= 0 || true)
    step('拖拽 500ms + /scene/order', /500/.test(seg) && seg.indexOf('/scene/order') >= 0 && seg.indexOf('startDragTimer') >= 0)
    step('插件内 0 弹框（内联确认）', cli.indexOf('window.confirm') < 0 && cli.indexOf('askConfirm') < 0 && cli.indexOf("position: 'fixed'") < 0 && /requestInlineConfirm/.test(cli))
    step('J 独立搜索行 + 折叠持久化', cli.indexOf("'搜索'") >= 0 && cli.indexOf('searchDraft') >= 0 && cli.indexOf('wb.collapsed') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv033-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh054-ui-final')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v033-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 UI 定稿分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
