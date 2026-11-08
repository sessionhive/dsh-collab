/**
 * card-version.js —— 编辑感知（v0.3.3）
 *   card_version++ 后不发消息；该场景下次 wb_read/wb_write 响应带一次提醒。
 */
import path from 'node:path'
import { META, AGENTS } from './paths.js'
import { readJson, writeJson } from './store.js'
import { callerScene } from './rules.js'

const SEEN = path.join(META, 'card-seen.json')

export function bumpCardVersion(cardFile) {
  try {
    const card = readJson(cardFile, null)
    if (!card) return null
    card.card_version = (Number(card.card_version) || 0) + 1
    card.updated_at = new Date().toISOString()
    writeJson(cardFile, card)
    return { version: card.card_version, updated_at: card.updated_at }
  } catch (e) { return null }
}

export function consumeConfigNotice(exec) {
  try {
    const sc = callerScene(exec)
    if (!sc) return ''
    const card = readJson(path.join(AGENTS, String(sc.id), 'card.json'), null)
    if (!card) return ''
    const v = Number(card.card_version) || 0
    if (!v) return ''
    const seen = readJson(SEEN, {}) || {}
    const prev = Number(seen[String(sc.id)] || 0)
    if (v <= prev) return ''
    try { writeJson(SEEN, { ...seen, [String(sc.id)]: v }) } catch (e) { /* ignore */ }
    const d = card.updated_at ? String(card.updated_at).replace('T', ' ').slice(0, 19) : ''
    return '⚠ 配置已更新：名称/职责/技能（' + String(card.name || sc.id) + ' · v' + v + (d ? ' · ' + d : '') + '）；先重读 card+summary'
  } catch (e) { return '' }
}
