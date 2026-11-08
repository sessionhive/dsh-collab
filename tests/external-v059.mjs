#!/usr/bin/env node
/** external-v059.mjs —— dh085 浮层定位稳定（0.1.0） */
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
  // Portal
  step('A React portal 到 document.body', /require\('react-dom'\)/.test(cli) && /createPortal\(node, document\.body\)/.test(cli))
  step('A fixed 脱离子树 + 高 z-index', /\.wb-ctx-menu\{position:fixed;z-index:100000/.test(cli))
  // B 坐标/翻转/关闭
  const fnSrc = (cli.match(/function placeMenu\(x, y, mw, mh, vw, vh\) \{[\s\S]*?\n    \}/) || [])[0]
  let normal = null, right = null, bottom = null, smallDev = false
  if (fnSrc) {
    const place = new Function(fnSrc + '; return placeMenu;')()
    normal = place(100, 120, 170, 76, 800, 600)
    right = place(750, 120, 170, 76, 800, 600)
    bottom = place(100, 550, 170, 76, 800, 600)
    smallDev = Math.abs(normal.left - 100) <= 24 && Math.abs(normal.top - 120) <= 24
  }
  step('B clientX/Y 定位偏差 ≤24px（常规）', smallDev, { normal })
  step('B 右/下越界翻转', !!right && right.left === 580 && !!bottom && bottom.top === 474, { right, bottom })
  step('B 滚动/resize/外部/Esc 关闭', /addEventListener\('scroll', onDoc, true\)/.test(cli) && /addEventListener\('resize', onDoc\)/.test(cli) && /addEventListener\('mousedown', onDoc\)/.test(cli) && /Escape/.test(cli))
  // C 不被裁切
  step('C 菜单高 z-index + 根级 portal 不在面板边缘', /z-index:100000/.test(cli) && cli.indexOf('createPortal(node, document.body)') > 0 && !/ctxMenu \? h\('div', \{ style: \{ position: 'relative'/.test(cli))
  // E fixed overlays 排查
  const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
  step('E 看板抽屉 fixed 在 body 级且无 transform 祖先', /\.drawer\{position:fixed/.test(bp) && !/^.*(?:body|html|main)[^{]*\{[^}]*transform:/m.test(bp))
} catch (e) { step('异常', false, { error: String((e && e.stack) || e) }) }
const report = { ok: steps.every((s) => s.ok), steps }
const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh085-portal')
try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
try { fs.writeFileSync(path.join(evDir, 'external-v059-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
console.log('dh085 浮层定位分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
for (const s of steps) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
if (!report.ok) console.log(JSON.stringify(report).slice(0, 2500))
process.exit(report.ok ? 0 : 1)
