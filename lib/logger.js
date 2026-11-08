/**
 * logger.js —— 插件日志 _meta/logs/plugin.log（结构化/轮转/config.debug）
 */
import fs from 'node:fs'
import path from 'node:path'
import { META, CONFIG } from './paths.js'
import { readJson } from './store.js'

const DIR = path.join(META, 'logs')
const FILE = path.join(DIR, 'plugin.log')
const MAX = 1024 * 1024

function debugEnabled() {
  try { return !!(readJson(CONFIG, {}) || {}).debug } catch (e) { return false }
}

export function pluginLog(level, msg, data = {}) {
  try {
    if (String(level) === 'debug' && !debugEnabled()) return null
    fs.mkdirSync(DIR, { recursive: true })
    try { if (fs.statSync(FILE).size > MAX) fs.renameSync(FILE, FILE + '.1') } catch (e) { /* 不存在 */ }
    const row = { ts: new Date().toISOString(), level: String(level || 'info'), msg: String(msg || '').slice(0, 300), data }
    fs.appendFileSync(FILE, JSON.stringify(row) + '\n', 'utf8')
    return row
  } catch (e) { return null }
}

export function readLogTail(n = 100) {
  try {
    const lines = fs.readFileSync(FILE, 'utf8').split(/\r?\n/).filter(Boolean).slice(-n)
    return lines.map((l) => { try { return JSON.parse(l) } catch (e) { return { raw: l } } })
  } catch (e) { return [] }
}

export const logDebug = (msg, data) => pluginLog('debug', msg, data)
export const logInfo = (msg, data) => pluginLog('info', msg, data)
export const logWarn = (msg, data) => pluginLog('warn', msg, data)

export default pluginLog
