#!/usr/bin/env node
/**
 * external-v032.mjs —— v0.1.0 卡片/按钮统一（dh053）：
 *   单行 6 按钮顺序、同规格、无换行、回收红+内联确认、分组头同规格、tab 统一、无弹框、版本
 * 纯静态 + 启动 apply；用法 node tests\external-v032.mjs
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
    const ctx = {
      tools: { register() { } },
      webServer: { register(o) { ctx.__routes = o } },
      effect(fn) { try { fn() } catch (e) { /* ignore */ } },
      get() { return undefined },
    }
    const IX = await import('../lib/index.js')
    await IX.apply(ctx, { dataRoot: process.env.WB_TEST_DATA_ROOT })
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = ' + V, pkg.version === V, { version: pkg.version })

    const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
    const seg = cli.slice(cli.indexOf('function sceneRow'), cli.indexOf('function otherPanel'))
    // 按钮顺序（源码顺序即渲染顺序）
    const order = ['编辑', '交接', '解绑', '归档', '⋮']
    let pos = -1, okOrder = true
    for (const label of order) {
      const p = seg.indexOf("'" + label + "'", pos + 1)
      if (p < 0) { okOrder = false; break }
      pos = p
    }
    step('在用卡片短按钮顺序：编辑·交接·解绑·归档·⋮', okOrder)
    step('单行布局（itemRow flexWrap nowrap + actBar 横向滚动兜底）', /itemRow/.test(cli) && /flexWrap: 'nowrap'/.test(cli) && /actBar/.test(cli) && /overflowX: 'auto'/.test(cli) && /S\.itemRow/.test(seg))
    step('按钮同规格（26px/12px/6px 间距/7px 圆角/0 8px 内边距）', /btnAct: \{[^}]*height: '26px'[^}]*padding: '0 8px'[^}]*fontSize: '12px'[^}]*borderRadius: '7px'/.test(cli) && /actBar: \{[^}]*gap: '6px'/.test(cli))
    const actSeg = seg.slice(seg.indexOf('h(\'div\', { style: S.actBar }'), seg.indexOf('rebindFor === s.id'))
    step('按钮全部使用 S.btnAct/actBar（不再 btnMini 掉行）', actSeg.length > 0 && actSeg.indexOf('S.btnMini') < 0 && /S\.actBar/.test(actSeg) && /S\.btnAct/.test(actSeg))
    step('归档/回收靠右 & 回收红色系', /btnActDanger/.test(cli) && /style: S\.btnActDanger/.test(seg))
    step('回收内联确认（requestInlineConfirm，0 弹框）', /doDeleteScene/.test(seg) && /requestInlineConfirm/.test(cli) && cli.indexOf('window.confirm') < 0 && cli.indexOf('askConfirm') < 0 && cli.indexOf("position: 'fixed'") < 0)
    step('不适用状态隐藏/不换行（解绑仅绑定会话显示）', /hasSession \? h\('button'[^]*?'解绑'/.test(seg) && /itemRow/.test(cli))
    step('分组头按钮同规格（改组/改名/删除 = S.btnAct）', /style: S\.btnAct \},\s*groupEditing === sec\.key/.test(cli) && cli.indexOf("style: S.btnAct }, '改名'") >= 0 && cli.indexOf("style: S.btnAct }, '删除'") >= 0)
    step('两 tab 与主 tab 同规格（S.tabs/S.tab 统一）', /tabs: \{[^}]*flexWrap: 'nowrap'/.test(cli) && /tab: \{[^}]*height: '26px'[^}]*fontSize: '12px'/.test(cli) && seg.indexOf('S.tab') >= 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv032-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh053-ui-unify')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v032-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 卡片/按钮统一分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
