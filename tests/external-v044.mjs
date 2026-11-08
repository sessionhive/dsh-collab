#!/usr/bin/env node
/** external-v044.mjs —— v0.1.0 交接标题/自动技能/技能编辑（dh069） */
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
  const sessions = []
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return {
          list: async () => ({ items: sessions.slice() }),
          create: async () => { const sid = 'S-NEW-' + (sessions.length + 1); sessions.push({ sessionId: sid, projections: { values: { title: '' } } }); return { sessionId: sid } },
          rename: async (req) => { const r = (req && req.request) || req || {}; const s = sessions.find((x) => x.sessionId === String(r.sessionId || '')); if (s && r.title) s.projections.values.title = String(r.title); return { ok: true } },
          prompt: async () => ({ accepted: true }),
        }
        if (n === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const H = await import('../lib/handover.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const scene = (id, sid) => ({ id, name: id === '后端' ? '后端' : id, sessions: [{ sessionId: sid }] })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: '后端', sessions: [{ sessionId: 'S-OLD' }] }], groups: [] })
    sessions.push({ sessionId: 'S-OLD', projections: { values: { title: '旧标题' } } })

    // A 改旧不改新
    const r1 = await H.rebindScene({ id: 'aa', autoCreate: true, cwd: process.env.WB_TEST_ROOT })
    const titles = sessions.map((s) => s.projections.values.title)
    step('A 旧会话改名 + 新会话原名', r1.ok && titles.indexOf('后端') >= 0 && titles.some((x) => /^后端（已交接 \d{2}-\d{2} \d{2}:\d{2}）$/.test(x)), { titles })
    const r2 = await H.rebindScene({ id: 'aa', autoCreate: true, cwd: process.env.WB_TEST_ROOT })
    step('A 旧会话排除冲突，新会话仍用原名', r2.ok && sessions.map((s) => s.projections.values.title).indexOf('后端') >= 0)

    // B 未选技能自动创建并绑定
    const b1 = await call('POST', '/plugins/workbench-core/scene', { id: 'newbie', name: '新人', sessionId: 'S-OLD' })
    const bj = JSON.parse(b1.body)
    const card = store.readJson(path.join(P.AGENTS, 'newbie', 'card.json'), {})
    const sf = path.join(P.DSH_HOME, 'skills', 'newbie', 'SKILL.md')
    step('B 未选技能自动建 SKILL + card.skills + 响应 skillId', b1.code === 200 && bj.skillId === 'newbie' && Array.isArray(card.skills) && card.skills.includes('newbie') && fs.existsSync(sf) && fs.readFileSync(sf, 'utf8').indexOf('## 怎么做') >= 0, { bj: { skillId: bj.skillId, skills: bj.skills } })

    // C 技能创建→编辑→保存→重进可见
    const mk = await call('POST', '/plugins/workbench-core/skill', { id: 'edit-me', text: '---\nname: edit-me\n---\n\n# edit-me\n\n## 怎么做\n\n原始内容\n' })
    const ed = await call('POST', '/plugins/workbench-core/skill', { id: 'edit-me', text: '---\nname: edit-me\n---\n\n# edit-me\n\n## 怎么做\n\n编辑后的内容\n' })
    const rd = await call('GET', '/plugins/workbench-core/skill?id=edit-me')
    const rj = JSON.parse(rd.body)
    step('C 已有技能编辑保存并重进可见', mk.code === 200 && ed.code === 200 && rj.ok && /编辑后的内容/.test(rj.text) && !/原始内容/.test(rj.text), { ed: ed.body.slice(0, 200), rd: String(rj.text || '').slice(-40) })
    // C 加固：name 别名 + BOM
    const nm = await call('POST', '/plugins/workbench-core/skill', { name: 'alias-skill', text: '\uFEFF---\nname: alias-skill\n---\n\n# alias\n\n## 怎么做\n\n内容\n' })
    const ar = JSON.parse((await call('GET', '/plugins/workbench-core/skill?id=alias-skill')).body)
    step('C /skill 支持 name 别名 + 去 BOM', nm.code === 200 && ar.ok && /## 怎么做/.test(ar.text) && ar.text.charCodeAt(0) !== 0xFEFF)
    // UI 静态：保存后重载/提示
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('C UI 保存后重载并提示', /技能已保存/.test(cli) && /loadSkills\(\)/.test(cli) && /replace\(\/\^\\uFEFF\//.test(cli))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv044-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh069-handover-skill')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v044-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('v0.1.0 交接/技能分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
