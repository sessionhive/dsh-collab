#!/usr/bin/env node
/** external-v053.mjs —— dh078 看板优化 + 日夜主题 + 中英切换（0.1.0） */
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
  try {
    const ctx = {
      tools: { register() { } }, webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { } },
      get(n) {
        if (n === 'sessionController') return { list: async () => ({ items: [] }), create: async () => ({ sessionId: 'S-NEW' }), prompt: async () => ({ accepted: true }) }
        if (n === 'workspaceRegistry') return { list: () => [], archivedSessionIds: [] }
        return undefined
      },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const P = await import('../lib/paths.js'); const store = await import('../lib/store.js')
    const OPS = await import('../lib/ops.js'); const I = await import('../lib/i18n.js')
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('D 版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    // A 看板优化
    step('A 信息层次/密度/空态/hover/点击反馈', /\.statValue\{font-size:22px/.test(bp) && /\.emptyState\{padding:14px/.test(bp) && /\.order-all:hover/.test(bp) && /\.order-row:active/.test(bp) && /\.ev-row\{padding:7px 8px/.test(bp))
    step('A 保留 KPI/会话/协作单/事件/黑板/规则', /aria-label="会话表"/.test(bp) && /aria-label="协作单"/.test(bp) && /aria-label="最近事件"/.test(bp) && /aria-label="黑板"/.test(bp) && /aria-label="全局规则"/.test(bp))
    // B 主题
    step('B 主题按钮 ☀/🌙 + auto/dark/light', /id="themeBtn"/.test(bp) && /function setTheme/.test(bp) && /\['auto', 'dark', 'light'\]/.test(bp) && /☀/.test(bp) && /🌙/.test(bp))
    step('B 独立 CSS 变量两套配色 + config.theme 持久化', /html\[data-theme="light"\]\{/.test(bp) && /--topbg/.test(bp) && /\/ops\/config\/ui/.test(bp))
    // 主题持久化
    const s1 = OPS.saveUiConfig({ theme: 'light', lang: 'en' })
    const cfg = store.readJson(P.CONFIG, {})
    step('B config.theme/lang 持久化', s1.ok && cfg.theme === 'light' && cfg.lang === 'en')
    const ci = OPS.configInfo()
    step('B configInfo 返回 theme/lang 供设置页同步', ci.theme === 'light' && ci.lang === 'en')
    step('B 非法值拒绝', OPS.saveUiConfig({ theme: 'blue' }).ok === false && OPS.saveUiConfig({ lang: 'fr' }).ok === false)
    // C 语言
    step('C 语言按钮 中/EN + 全看板文案字典', /id="langBtn"/.test(bp) && /EN_TEXT/.test(bp) && /function applyLangDom/.test(bp) && /function setLang/.test(bp))
    step('C 设置页不再显示主题/语言下拉（配置保留）', !/settings\.theme/.test(cli) && !/settings\.lang/.test(cli) && !/saveUiCfg/.test(cli) && fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'runtime.js'), 'utf8').indexOf('/ops/config/ui') >= 0)
    const en = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'locale', 'en.json'), 'utf8'))
    const zh = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'locale', 'zh.json'), 'utf8'))
    step('C 3 tab 中英文案', ['tabs.rules', 'tabs.scenes', 'tabs.other'].every((k) => zh[k] && en[k] && zh[k] !== en[k]))
    // 事件类型/状态/日期
    step('C 事件类型中英标签', /dispatch: '派单'/.test(bp) && /delivered: '送达'/.test(bp) && /dispatch: 'Dispatch'/.test(bp) && /delivered: 'Delivered'/.test(bp))
    const fmtSrc = (bp.match(/function fmtDate\(ts\) \{[\s\S]*?\n  \}/) || [])[0]
    let zhDate = '', enDate = ''
    if (fmtSrc) {
      const make = (lang) => new Function('UI', 'EN_MONTH', 'asDate', fmtSrc + '; return fmtDate;')(
        { lang }, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], () => new Date(2026, 10, 8, 18, 29)
      )
      zhDate = make('zh')(); enDate = make('en')()
    }
    step('C 日期格式 zh 11-08 18:29 / en Nov 08, 18:29', zhDate === '11-08 18:29' && enDate === 'Nov 08, 18:29', { zhDate, enDate })
    // 缺翻译回落 + debug
    const cf = store.readJson(P.CONFIG, {}); cf.debug = true; store.writeJson(P.CONFIG, cf)
    const miss = I.t('__no_such_key__', 'en')
    const logTxt = fs.existsSync(path.join(P.META, 'logs', 'plugin.log')) ? fs.readFileSync(path.join(P.META, 'logs', 'plugin.log'), 'utf8') : ''
    step('C 缺翻译回落中文/键 + debug 日志', miss === '__no_such_key__' && /i18n missing/.test(logTxt))
    // 路由保存
    const call = async (method, p, body) => {
      const out = { code: 0, body: '' }
      const req = { method, url: p, on(ev, fn) { if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8')); if (ev === 'end') fn() }, destroy() { } }
      const res = { writeHead(c) { out.code = c }, end(s) { out.body = String(s || '') } }
      await ctx.__routes.handler(req, res)
      return out
    }
    const sr = await call('POST', '/plugins/workbench-core/ops/config/ui', { theme: 'dark', lang: 'zh' })
    step('B/C 路由保存并回读', sr.code === 200 && store.readJson(P.CONFIG, {}).theme === 'dark' && store.readJson(P.CONFIG, {}).lang === 'zh')
    const gr = await call('GET', '/plugins/workbench-core/ops/config')
    const gj = JSON.parse(gr.body)
    step('设置页配置回读 theme/lang', gr.code === 200 && gj.theme === 'dark' && gj.lang === 'zh')
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv053-'))
  const extRoot = path.join(tmp, 'ext'); fs.mkdirSync(extRoot, { recursive: true })
  const extData = path.join(extRoot, 'data'); fs.mkdirSync(extData, { recursive: true })
  const env = { ...process.env, WB_TEST_ROOT: extRoot, WB_TEST_DATA_ROOT: extData }
  delete env.DSH_HOME; delete env.DSH_CUSTOMER_HOME
  const r = spawnSync(process.execPath, [SELF, '--child'], { env, cwd: extRoot, encoding: 'utf8', timeout: 120000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status; report.dataRoot = extData
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh078-ui')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v053-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh078 看板/主题/语言分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
