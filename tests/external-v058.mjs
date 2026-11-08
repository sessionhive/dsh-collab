#!/usr/bin/env node
/** external-v058.mjs —— dh084 右键菜单修复（0.1.0） */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const SELF = fileURLToPath(import.meta.url)
const steps = []
const step = (name, ok, extra) => { steps.push({ name, ok: !!ok, ...(extra || {}) }); return ok }
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
  const cli = fs.readFileSync(path.join(path.dirname(SELF), '..', 'client', 'client.js'), 'utf8')
  step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
  step('A fixed 浮层 + 边界翻转', /\.wb-ctx-menu\{position:fixed/.test(cli) && /placeMenu\(ctxMenu\.x/.test(cli) && /x - mw/.test(cli) && /y - mh/.test(cli))
  step('A 点击外部/Esc 关闭', /addEventListener\('mousedown', onDoc\)/.test(cli) && /addEventListener\('keydown', onDoc\)/.test(cli) && /Escape/.test(cli))
  step('B 目录只显示打开目录', /ctxMenu\.dir\s*\n?\s*\?\s*h\('button'[^]*?'打开目录'/.test(cli) && /打开文件/.test(cli) && /打开所在目录/.test(cli))
  step('C 菜单移到根级（otherPanel 之后）', cli.indexOf("tab === 'other' ? otherPanel() : null,") >= 0 && cli.indexOf("className: 'wb-ctx-menu'") > cli.indexOf("tab === 'other' ? otherPanel() : null,"))
  step('C 菜单不再内联渲染到设置页顶部', !/ctxMenu \? h\('div', \{ style: \{ position: 'relative'/.test(cli) && !/ctxMenu \? h\('div', \{ style: \{ position: 'relative'/.test(cli))
  step('D 顶部不新增按钮区（无旧 inline 菜单）', !/ctxMenu \? h\('div', \{ style: \{ position: 'relative'/.test(cli) && (cli.match(/className: 'wb-ctx-menu'/g) || []).length === 1)
} catch (e) { step('异常', false, { error: String((e && e.stack) || e) }) }
const report = { ok: steps.every((s) => s.ok), steps }
const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh084-ctx')
try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
try { fs.writeFileSync(path.join(evDir, 'external-v058-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
console.log('dh084 右键菜单分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
for (const s of steps) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
if (!report.ok) console.log(JSON.stringify(report).slice(0, 2000))
process.exit(report.ok ? 0 : 1)
