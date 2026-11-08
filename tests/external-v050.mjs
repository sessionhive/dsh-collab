#!/usr/bin/env node
/** external-v050.mjs —— dh075 健壮性/体验/最终 0.1.0 */
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
  let retryCount = 0
  const prompts = []
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return {
          list: async () => ({ items: [] }), create: async () => ({ sessionId: 'S-NEW' }),
          prompt: async (req) => {
            const text = String((req && req.content && req.content[0] && req.content[0].text) || '')
            prompts.push(text)
            if (text.indexOf('FAIL') >= 0) throw new Error('mock failure')
            if (text.indexOf('RETRY') >= 0) { retryCount++; if (retryCount <= 2) throw new Error('retry me') }
            return { accepted: true }
          },
        }
        if (n === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const S = await import('../lib/sessions.js'); const E = await import('../lib/events.js')
    const W = await import('../lib/tools/write.js'); const R = await import('../lib/tools/read.js')
    const C = await import('../lib/collab.js'); const BO = await import('../lib/board.js')
    const LG = await import('../lib/logger.js'); const I = await import('../lib/i18n.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('J 版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    store.writeJson(P.REGISTRY, { schemaVersion: 1, scenes: [{ id: 'aa', name: 'AA', sessions: [{ sessionId: 'S-A' }] }, { id: 'bb', name: 'BB', sessions: [{ sessionId: 'S-B' }] }], groups: [] })
    const exec = (sid) => ({ agent: { session: { header: { id: sid } } } })

    // A wake 重试 + outbox
    const w1 = await S.promptSession('S-A', 'RETRY please')
    step('A wake 失败退避重试 2 次后成功', w1.ok && w1.retries === 2, { w1 })
    const w2 = await S.promptSession('S-A', 'FAIL always')
    step('A 仍失败降级写 outbox', w2.ok === false && w2.retries === 2 && w2.outbox === true && fs.existsSync(path.join(P.META, 'outbox.jsonl')))

    // B 幂等去重
    await E.logEvent({ type: 'handoff', order_id: 'dh900', from: 'aa', to: 'bb', kind: 'next', note: 'dup' })
    await E.logEvent({ type: 'handoff', order_id: 'dh900', from: 'aa', to: 'bb', kind: 'next', note: 'dup' })
    const hCount = E.readEventsTail(500).filter((e) => e.type === 'handoff' && e.order_id === 'dh900').length
    step('B handoff 重复事件去重', hCount === 1, { hCount })
    await E.logEvent({ type: 'ack', order_id: 'dh901', from: 'aa', note: 'ack' })
    await E.logEvent({ type: 'ack', order_id: 'dh901', from: 'aa', note: 'ack' })
    step('B ack 重复事件去重', E.readEventsTail(500).filter((e) => e.type === 'ack' && e.order_id === 'dh901').length === 1)

    // C refs 安全
    const t1 = await W.wbWrite({ action: 'task', to: 'aa', task: 'refs 安全', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa'], wake: false }, exec('S-A'))
    const bad = await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: ['../secret.txt'] }, exec('S-A'))
    const vio = fs.existsSync(P.VIOLATIONS_FILE) ? fs.readFileSync(P.VIOLATIONS_FILE, 'utf8') : ''
    step('C refs 路径穿越拒绝 + violations', bad.ok === false && /路径穿越|证据不可达/.test(bad.hint || '') && /PRT-001/.test(vio))
    const okClose = await W.wbWrite({ action: 'close', orderId: t1.orderId, status: 'done', note: '完成', refs: [process.env.WB_TEST_ROOT] }, exec('S-A'))
    step('C refs 存在/可读通过', okClose.ok === true)

    // D 日志
    await E.logEvent({ type: 'comment', order_id: 'dh902', from: 'aa', note: 'log' })
    LG.logDebug('debug-should-hide', { x: 1 })
    const logFile = path.join(P.META, 'logs', 'plugin.log')
    const logTxt = fs.readFileSync(logFile, 'utf8')
    step('D plugin.log 结构化日志', fs.existsSync(logFile) && /"level":"info"/.test(logTxt) && /"msg":"event"/.test(logTxt))
    const cfg = store.readJson(P.CONFIG, {}); cfg.debug = true; store.writeJson(P.CONFIG, cfg)
    LG.logDebug('debug-visible', { y: 2 })
    step('D config.debug 控制 debug 级', /debug-visible/.test(fs.readFileSync(logFile, 'utf8')))

    // E dry-run
    const dry = await W.wbWrite({ action: 'task', to: 'bb', task: 'dry 任务', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', dryRun: true }, exec('S-A'))
    const before = fs.existsSync(path.join(P.DSH_HOME, 'collab'))
    step('E dryRun 返回将写入内容且不落盘', dry.ok && dry.dryRun === true && dry.would && dry.would.frontmatter && !/dry 任务/.test(fs.existsSync(path.join(P.DSH_HOME, 'collab')) ? JSON.stringify(fs.readdirSync(path.join(P.DSH_HOME, 'collab'))) : ''))
    const dryNote = await W.wbWrite({ action: 'note', scene: 'aa', text: 'dry note', refs: ['x'], dryRun: true }, exec('S-A'))
    step('E dryRun note 预览', dryNote.ok && dryNote.dryRun && dryNote.would.file)

    // F wb_read(order)
    const t2 = await W.wbWrite({ action: 'task', to: 'aa', task: '时间线查询', loc: 'x', forbid: 'y', accept: 'z', evidence: 'e', flow: ['aa', 'bb'], wake: false }, exec('S-A'))
    await W.wbWrite({ action: 'progress', orderId: t2.orderId, line: '开工' }, exec('S-A'))
    const ro = await R.wbRead({ action: 'order', id: t2.orderId }, exec('S-A'))
    step('F wb_read(order) 返回 steps/current/next/timeline/metrics', ro.ok && ro.current_owner === 'aa' && ro.next === 'bb' && Array.isArray(ro.steps) && ro.steps.some((s) => s.status === 'current') && Array.isArray(ro.timeline) && ro.metrics && ro.metrics.durations)

    // G i18n
    step('G i18n zh/en + config.lang 默认 auto', fs.existsSync(path.join(path.dirname(SELF), '..', 'locale', 'zh.json')) && fs.existsSync(path.join(path.dirname(SELF), '..', 'locale', 'en.json')) && (store.readJson(P.CONFIG, {}).lang || 'zh') === 'zh' && I.t('common.save', 'en') === 'Save' && I.t('common.save', 'zh') === '保存')
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const ir = await call('GET', '/plugins/workbench-core/i18n?lang=en')
    step('G /i18n 路由', ir.code === 200 && JSON.parse(ir.body).values['common.save'] === 'Save')

    // H 性能
    const b1 = await BO.boardData({ full: false }); const b2 = await BO.boardData({ full: false })
    step('H board-data 缓存命中', b1.generatedAt === b2.generatedAt)
    const mem = path.join(P.AGENTS, 'aa', 'memory', '2026-11-08'); fs.mkdirSync(mem, { recursive: true }); fs.writeFileSync(path.join(mem, 'note.md'), '# n\n\n结论：x\n', 'utf8')
    const MI = await import('../lib/memory-index.js')
    const i1 = MI.rebuildMemoryIndex('aa'); const i2 = MI.rebuildMemoryIndex('aa')
    step('H INDEX 增量重建跳过', i1.ok && i2.skipped === 'fresh', { i2 })
    step('H 事件流读尾', E.readEventsTail(3).length <= 3 && E.readEventsTail(3).length > 0)
    step('I 使用手册存在', fs.existsSync(path.join(path.dirname(SELF), '..', 'docs', '插件使用手册.md')))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv050-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh075-robust')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v050-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh075 健壮性/体验分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
