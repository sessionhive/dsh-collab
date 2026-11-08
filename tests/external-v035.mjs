#!/usr/bin/env node
/**
 * external-v035.mjs —— v0.1.0 UI 细节（dh057）：
 *   保存高亮 / 数据目录块与提示行删除 / 预检自检折叠+悬停 / 全局规范去提示路径 / 版本
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
    step('Token 保存与催办保存同款高亮（S.btn）', /onClick: saveToken, style: S\.btn \}/.test(cli) && /onClick: saveNotice[^\n]*style: Object\.assign\(\{\}, S\.btn/.test(cli))
    step('搜索按钮高亮（S.btn，与保存同款）', /setScenesQuery\(searchDraft\); \}, style: S\.btn \}, '搜索'/.test(cli))
    step('数据目录 / 插件版本整块删除', cli.indexOf('数据目录 / 插件版本') < 0 && cli.indexOf('打开数据目录') < 0 && cli.indexOf('verLine(') < 0 && cli.indexOf('profile ') < 0)
    step('清理区两条提示行删除', cli.indexOf('dataRoot 下无 trash') < 0 && cli.indexOf('路径不存在的工作区块已隐藏') < 0 && cli.indexOf('高级 · 数据清理') >= 0)
    step('启动预检说明行删除', cli.indexOf('dataRoot / cwd 可写性') < 0 && cli.indexOf('逐项 ok|warn|fail') < 0)
    step('预检折叠摘要 + 悬停浮窗', /'预检通过 ' \+ dTotal \+ '\/' \+ dTotal/.test(cli) && /'✗ 预检 ' \+ \(dTotal - dFail\)/.test(cli) && /setDocHover\(true\)/.test(cli) && cli.indexOf('S.popover') >= 0)
    step('自检折叠摘要 + 悬停浮窗', /\(sc\.ok \? '✓ 通过 ' : '✗ '\) \+ \(sc\.passed \|\| 0\) \+ '\/' \+ \(sc\.total \|\| 0\) \+ ' · ' \+ \(\(sc\.ms \|\| 0\) \/ 1000\)\.toFixed\(1\) \+ 's'/.test(cli) && /setSelfHover\(true\)/.test(cli))
    step('全局规范无提示句/路径行', cli.indexOf('底层基础规则') < 0 && cli.indexOf('文件：shared') < 0 && cli.indexOf('仅对已注册协作会话生效') < 0)
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) {
    return { ok: false, steps, error: String((e && e.stack) || e) }
  }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv035-'))
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
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh057-ui-polish')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
  try { fs.writeFileSync(path.join(evDir, 'external-v035-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('v0.1.0 UI 细节分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(report.ok ? 0 : 1)
}
