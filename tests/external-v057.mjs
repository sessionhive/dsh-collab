#!/usr/bin/env node
/** external-v057.mjs —— dh083 浅色主题标签修复（0.1.0） */
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
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), '..', 'package.json'), 'utf8'))
    step('版本 = 0.1.0', pkg.version === '0.1.0', { version: pkg.version })
    const bp = fs.readFileSync(path.join(path.dirname(SELF), '..', 'lib', 'board-page.html'), 'utf8')
    // ① 协作单列表行 badge/chip/status token
    step('① 协作单 badge/status/chip 走 token', /\.badge\{[^}]*background:var\(--badge-bg\)/.test(bp) && /\.st-open\{[^}]*background:var\(--st-open-bg\)/.test(bp) && /\.st-done\{[^}]*background:var\(--st-done-bg\)/.test(bp) && /\.chip\{[^}]*background:var\(--chip-bg\)/.test(bp))
    step('① flow 角色步骤走 token', /\.flowstep\.done\{[^}]*var\(--flow-done-bg\)/.test(bp) && /\.flowstep\.current\{[^}]*var\(--flow-current-bg\)/.test(bp) && /\.fs\.done\{[^}]*var\(--flow-done-bg\)/.test(bp))
    // ② 其它标签 token
    step('② 事件类型/黑板/学习卡/KPI token', /\.ev-badge\.t-dispatch,.ev-badge\.t-task\{[^}]*var\(--ev-dispatch-bg\)/.test(bp) && /\.bb-type\.t-fact\{[^}]*var\(--bb-fact-bg\)/.test(bp) && /\.stat\{background:var\(--card\)/.test(bp) && /\.learn-line/.test(bp))
    // ③ 静态断言：badge/chip/status/flow/bb 规则不得硬编码深色背景
    const lines = bp.split(/\r?\n/).filter((l) => /\.(badge|chip|st-[a-z]+|ev-badge|bb-type|flowstep|fs)([:.{\s,]|$)/.test(l))
    const hard = lines.filter((l) => !/data-theme="light"/.test(l) && /background:\s*#[0-9a-fA-F]{3,6}/.test(l))
    step('③ 禁止 badge 等硬编码深色背景', hard.length === 0, { hard: hard.slice(0, 3) })
    step('③ 禁止 #0b0e14 类深色 badge 背景', !/background:\s*#0b0e14/.test(bp) && !/background:\s*#1a2030/.test(bp) && !/background:\s*#1d2a44/.test(bp))
    // 浅色 token 存在
    step('浅色 badge/状态/flow/事件 token', /--badge-bg:#eef3ff/.test(bp) && /--st-done-bg:#eaf8f1/.test(bp) && /--flow-current-bg:#eaf1fe/.test(bp) && /--ev-dispatch-bg:#152647/.test(bp) && /--chip-bg:#f1f3f7/.test(bp))
    return { ok: steps.every((s) => s.ok), steps }
  } catch (e) { return { ok: false, steps, error: String((e && e.stack) || e) } }
}

if (CHILD) {
  childMain().then((r) => { console.log(JSON.stringify(r)); process.exit(r.ok ? 0 : 1) }).catch((e) => { console.error(String(e)); process.exit(2) })
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-extv057-'))
  const r = spawnSync(process.execPath, [SELF, '--child'], { env: process.env, cwd: tmp, encoding: 'utf8', timeout: 60000, windowsHide: true })
  let report = null
  try { report = JSON.parse(String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]) } catch (e) { report = { ok: false, stdout: String(r.stdout || '').slice(0, 3000), stderr: String(r.stderr || '').slice(0, 2000) } }
  report.exitCode = r.status
  const evDir = path.resolve(path.dirname(SELF), '..', '..', '..', '工作区', '证据', 'dh083-tokens')
  try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { }
  try { fs.writeFileSync(path.join(evDir, 'external-v057-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { }
  console.log('dh083 浅色标签分项：' + (report.ok ? '✓ 通过' : '✗ 失败'))
  for (const s of (report.steps || [])) console.log((s.ok ? '  ✓ ' : '  ✗ ') + s.name)
  if (!report.ok) console.log(JSON.stringify(report).slice(0, 3000))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) { }
  process.exit(report.ok ? 0 : 1)
}
