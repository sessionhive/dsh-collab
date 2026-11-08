/**
 * entry-seed.js —— 入场 seed（v0.3.2 短模板 + 读文件指针，内置可覆盖）
 */
import path from 'node:path'
import { AGENTS, DSH_HOME } from './paths.js'
import { readJson } from './store.js'
import { findScene } from './rules.js'
import { allOrders } from './collab.js'
import { renderTemplate } from './templates.js'
import { activeSeedNotes } from './learn.js'

export function buildEntrySeed(sceneId) {
  const sc = findScene(sceneId)
  if (!sc) return { ok: false, hint: '找不到场景：' + sceneId }
  const id = String(sc.id)
  const card = readJson(path.join(AGENTS, id, 'card.json'), null) || {}
  const orders = allOrders().filter((o) => !o.done && String(o.frontmatter.assignee || '') === id)
  const hardRule = ''
  const openText = orders.length
    ? orders.slice(0, 8).map((o) => o.id + ' · ' + String((o.body.match(/^\*\*任务\*\*[：:]\s*(.+)$/m) || [])[1] || '').slice(0, 60)).join('；')
    : '无 → 无单即收'
  let text = renderTemplate('seed.md', {
    name: String(card.name || sc.name || id), id, root: DSH_HOME,
    openOrders: openText, hardRule,
  })
  if (!text) {
    text = [
      '你是「' + (card.name || sc.name || id) + '」(场景 ' + id + ')。身份以 card 为准；忽略运行时角色名。',
      '数据根：' + DSH_HOME,
      '先读（最多 3 个文件）：agents\\' + id + '\\card.json → summary.md → 有 open 单再读单',
      'open 单：' + openText,
      '规则：记忆写回 agents\\' + id + '\\memory；结论带来源；只写自己目录；协作状态用 wb_write(v2)',
      '协作规则（所有场景同一套）：先判断归属；自己的先 ack→干→写证据；别人的派单/转交（一单 flow）；有下一棒必须转交禁 close；最后一棒转交回主负责人；主负责人收齐→验收→close→交付；禁 sleep/轮询。',
      '三步：核对身份 → 有单干活/无单回执 → 写回 note',
      '',
    ].filter(Boolean).join('\n')
  }
  try { const notes = activeSeedNotes(); if (notes.length) text += '\n已知坑（学习自动注入）：\n' + notes.map((x) => '- ' + x).join('\n') + '\n' } catch (e) { /* ignore */ }
  return { ok: true, sceneId: id, text, openOrders: orders.map((o) => o.id), hardRule }
}

export default buildEntrySeed
