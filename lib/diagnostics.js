/**
 * diagnostics.js —— 诊断信息（dh050）：profile 路径、运行/磁盘版本、引擎版本。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, DSH_HOME } from './paths.js'
import { hostGet } from './host.js'

const PKG_FILE = fileURLToPath(new URL('../package.json', import.meta.url))
const RUNTIME_VERSION = (() => { try { return String((JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')) || {}).version || '') } catch (e) { return '' } })()

export function runtimeVersion() { return RUNTIME_VERSION }

export function diskPluginVersion() {
  try { return String((JSON.parse(fs.readFileSync(PKG_FILE, 'utf8')) || {}).version || '') } catch (e) { return '' }
}

/** profile 目录：进程 argv / DSH_PROFILE / host ctx / 默认 profiles\web */
export function profilePath() {
  const cands = []
  for (const a of process.argv) {
    const m = String(a || '').match(/profiles[\\/]([A-Za-z0-9._-]+)/)
    if (m) cands.push(m[0])
    if (/[\\/]profiles[\\/][A-Za-z0-9._-]+$/.test(String(a || ''))) cands.push(String(a))
  }
  if (process.env.DSH_PROFILE) cands.push(String(process.env.DSH_PROFILE))
  try {
    const p = hostGet('profile')
    if (p && typeof p === 'string') cands.push(p)
    if (p && typeof p === 'object' && p.path) cands.push(String(p.path))
  } catch (e) { /* ignore */ }
  for (const c of cands) {
    try {
      if (fs.statSync(c).isDirectory()) return path.resolve(c)
    } catch (e) { /* next */ }
  }
  return path.join(DSH_HOME, 'profiles', 'web')
}

/** 引擎版本：读磁盘 package.json；读不到给 unknown + 原因 */
export function engineVersionInfo() {
  const cands = [path.join(ROOT, '引擎', 'apps', 'cli', 'package.json'), path.join(ROOT, '引擎', 'package.json')]
  const tried = []
  for (const p of cands) {
    tried.push(p)
    try {
      const v = String((JSON.parse(fs.readFileSync(p, 'utf8')) || {}).version || '')
      if (v && v !== '0.0.0') return { version: v, source: p }
    } catch (e) { /* next */ }
  }
  return { version: 'unknown', reason: '读不到引擎 package.json（尝试：' + tried.join('；') + '）', source: '' }
}

/** 运行内存版本 vs 磁盘 package.json（热替换后能辨出代码旧） */
export function versionCompare() {
  const run = runtimeVersion()
  const disk = diskPluginVersion()
  return { runtime: run, disk, same: !!run && !!disk && run === disk, stale: !!run && !!disk && run !== disk }
}
