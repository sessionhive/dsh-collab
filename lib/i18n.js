/**
 * i18n.js —— UI 文案外置 zh/en（config.lang 默认 auto）
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CONFIG } from './paths.js'
import { readJson } from './store.js'
import { pluginLog } from './logger.js'

const DIR = fileURLToPath(new URL('../locale/', import.meta.url))
const cache = {}
export const SUPPORTED = ['zh', 'en']

function load(lang) {
  const l = SUPPORTED.includes(lang) ? lang : 'zh'
  if (cache[l]) return cache[l]
  try { cache[l] = JSON.parse(fs.readFileSync(DIR + l + '.json', 'utf8')) } catch (e) { cache[l] = {} }
  return cache[l]
}

export function resolveLang(explicit) {
  let lang = String(explicit || '').trim()
  if (!lang) { try { lang = String((readJson(CONFIG, {}) || {}).lang || 'auto') } catch (e) { lang = 'auto' } }
  if (lang === 'auto') return 'zh'
  return SUPPORTED.includes(lang) ? lang : 'zh'
}

export function t(key, lang) {
  const l = resolveLang(lang)
  const dict = load(l)
  if (dict[key] != null) return String(dict[key])
  const zh = load('zh')
  if (zh[key] != null) {
    try { pluginLog('debug', 'i18n missing translation', { key, lang: l, fallback: 'zh' }) } catch (e) { /* ignore */ }
    return String(zh[key])
  }
  try { pluginLog('debug', 'i18n missing key', { key, lang: l }) } catch (e) { /* ignore */ }
  return String(key)
}

export function dict(lang) { return { lang: resolveLang(lang), values: load(resolveLang(lang)) } }

export default { t, dict, resolveLang, SUPPORTED }
