#!/usr/bin/env node
/**
 * external-v037.mjs —— v0.1.0 第二批：入场与记忆闭环（dh059）
 *   seed / 时间线 / 关单自动补写回 / INDEX / search / 指针 / depends_on / 瘦身
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
  const prompts = []
  try {
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get(name) {
        if (name === 'sessionController') return {
          list: async () => ({ items: [{ sessionId: 'S-EXIST', title: '已有会话' }] }),
          create: async () => ({ sessionId: 'S-NEW' }),
          prompt: async (req) => {
            const sid = String((req && req.sessionId) || '')
            const text = String((req && req.content && req.content[0] && req.content[0].text) || (req && req.text) || '')
            prompts.push({ sessionId: sid, text })
            return { accepted: true }
          },
        }
        if (name === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js')
    const store = await import('../lib/store.js')
    const W = await import('../lib/tools/write.js')
    const C = await import('../lib/collab.js')
    const T = await import('../lib/timeline.js')
    const R = await import('../lib/search.js')
    const E = await import('../lib/events.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })

    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    // 建场景 / 选已有会话：强制 entry seed
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [], groups: [] })
    const sr = await call('POST', '/plugins/workbench-core/scene', { id: 's1', name: '场景一', sessionId: 'S-EXIST', role: '职责测试' })
    const sj = JSON.parse(sr.body)
    const seedPrompt = prompts.filter((p) => p.sessionId === 'S-EXIST').slice(-1)[0] || { text: '' }
    const seedText = String(seedPrompt.text || '')
    step('绑定已有会话收到入场 seed（card/summary/open/规则/忽略角色）', sr.code === 200 && seedText.indexOf('你是「') >= 0 && seedText.indexOf('忽略运行时角色') >= 0 && seedText.indexOf('数据根') >= 0 && seedText.indexOf('先读') >= 0 && seedText.indexOf('card.json') >= 0 && seedText.indexOf('summary.md') >= 0 && seedText.indexOf('无单即收') >= 0 && seedText.indexOf('规则：') >= 0, { text: seedText.slice(0, 160) })
    step('sessions.jsonl 有 entry', T.readSessionTimeline('s1').some((e) => e.event === 'entry' && /\+08:00$/.test(e.ts)), { events: T.readSessionTimeline('s1').map((e) => e.event) })

    const execOrder = { agent: { session: { header: { id: 'S-EXIST' } } } }
    // 准备接受单场景 s2
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 's1', name: '场景一', sessions: [{ sessionId: 'S-EXIST' }] }, { id: 's2', name: '场景二', sessions: [{ sessionId: 'S-2' }] }], groups: [] })
    const t1 = await W.wbWrite({ action: 'task', to: 's2', task: '实现记忆检索功能', wake: false }, execOrder)
    const exec2 = { agent: { session: { header: { id: 'S-2' } } } }
    const p1 = await W.wbWrite({ action: 'progress', orderId: t1.orderId, line: '开工' }, exec2)
    step('sessions 有 accept（首次 progress）', p1.ok && T.readSessionTimeline('s2').some((e) => e.event === 'accept'))
    // 关单自动补写回 + 警告 + end
    const cl = await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成检索', refs: [process.env.WB_TEST_ROOT] }, exec2)
    const memFile = path.join(P.AGENTS, cl.autoMemory || '')
    const memOk = fs.existsSync(memFile) && fs.readFileSync(memFile, 'utf8').indexOf('auto: true') >= 0
    step('关单无 memory → 自动补 memory(auto:true) + 警告', cl.ok && cl.autoMemory && memOk && (await E.readEvents()).some((e) => e.order_id === t1.orderId && e.warning === 'memory-auto'))
    step('close 后 summary 投影 + sessions end', cl.summaryUpdated && T.readSessionTimeline('s2').some((e) => e.event === 'end'))
    const idx = path.join(P.AGENTS, 's2', 'memory', 'INDEX.md')
    step('memory/INDEX.md 自动生成（≤120 行）', fs.existsSync(idx) && fs.readFileSync(idx, 'utf8').split(/\r?\n/).length <= 120)
    // search 升级 + 指针
    const sres = R.search({ query: '检索', scope: 'memory', since: '2020-01-01', limit: 2 })
    step('search(query/scope/since/limit) → path/date/one_line/refs', sres.ok && sres.hits.length > 0 && sres.hits.every((h) => h.path && h.date && h.one_line && Array.isArray(h.refs)) && sres.hits.length <= 2)
    const t2 = await W.wbWrite({ action: 'task', to: 's2', task: '检索功能优化', wake: true }, execOrder)
    const wakeText = String((prompts.filter((p) => p.sessionId === 'S-2').slice(-1)[0] || {}).text || '')
    step('派单注入相关历史指针 ≤3', t2.ok && wakeText.indexOf('相关历史（≤3）') >= 0 && (wakeText.match(/^- agents\//gm) || []).length <= 3)
    const t3 = await W.wbWrite({ action: 'task', to: 's2', task: '完全无关的新任务XYZ', wake: true }, execOrder)
    const wake3 = String((prompts.filter((p) => p.sessionId === 'S-2').slice(-1)[0] || {}).text || '')
    step('无命中写「未找到相关历史」', t3.ok && wake3.indexOf('未找到相关历史') >= 0)
    // depends_on 自动 wake 下游
    const tA = await W.wbWrite({ action: 'task', to: 's1', task: '前置任务A', wake: false }, exec2)
    const tB = await W.wbWrite({ action: 'task', to: 's2', task: '下游任务B', depends_on: [tA.orderId], wake: false }, execOrder)
    await W.wbWrite({ action: 'close', orderId: tA.orderId, status: 'done', note: 'A 完成', refs: [process.env.WB_TEST_ROOT] }, execOrder)
    step('depends_on 前置 done → 自动 wake 下游一次', (await E.readEvents()).some((e) => e.type === 'wake' && e.order_id === tB.orderId && e.reason === 'depends_on'))
    // 交接 → sessions handover
    const regNow = store.readJson(P.REGISTRY, {})
    regNow.scenes.push({ id: 's3', name: '场景三', sessions: [{ sessionId: 'S-OLD' }] })
    store.writeJson(P.REGISTRY, regNow)
    const rb = await call('POST', '/plugins/workbench-core/scene/rebind', { id: 's3', autoCreate: true, cwd: process.env.WB_TEST_ROOT })
    step('sessions 有 handover（交接）', rb.code === 200 && T.readSessionTimeline('s3').some((e) => e.event === 'handover'))
    // 瘦身
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    step('事件流分区保留/无数据目录版本块', cli.indexOf('事件流（events.jsonl）') >= 0 && cli.indexOf('数据目录 / 插件版本') < 0)
    const cfg = JSON.parse(fs.readFileSync(P.CONFIG, 'utf8'))
    step('config.debug 默认 false', cfg.debug === false)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv037-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const stdout = String(r.stdout || '').trim()
  let report = null
  try { report = JSON.parse(stdout.split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, parseError: String((e && e.message) || e), stdout: stdout.slice(0, 4000), stderr: String(r.stderr || '').slice(0, 3000) } }
  report.exitCode = r.status
  report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh059-memory-loop')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v037-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 第二批·入场与记忆闭环分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
