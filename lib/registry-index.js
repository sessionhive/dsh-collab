/**
 * registry-index.js —— 无壳模式：从 _meta\registry.json 直接生成 _meta\scene-index.md（dh042）。
 * 外部 DSH 没有 工具\gen 生成器时，自动索引用它重算索引；有壳仍走 sync-registry + gen-index。
 */
import fs from 'node:fs'
import path from 'node:path'
import { REGISTRY, META } from './paths.js'
import { readJson, writeAtomic, today } from './store.js'

export const SCENE_INDEX = path.join(META, 'scene-index.md')

/** @returns {{ok:boolean, file:string, scenes:number, bytes:number, error?:string}} */
export function recomputeSceneIndexFromRegistry() {
  try {
    const reg = readJson(REGISTRY, {}) || {}
    const scenes = Array.isArray(reg.scenes) ? reg.scenes : []
    const groups = Array.isArray(reg.groups) ? reg.groups : []
    const lines = []
    lines.push('# 场景索引（插件生成 · 无壳模式）')
    lines.push('')
    lines.push('> 数据源：`_meta/registry.json`；生成时间：' + new Date().toISOString() + '；场景 ' + scenes.length + ' 个。')
    lines.push('')
    lines.push('## 一、场景/面板/会话')
    lines.push('')
    lines.push('| 场景 | 名称 | 技能 | 面板数 | 会话数 | 交接摘要 |')
    lines.push('|---|---|---|---|---|---|')
    for (const s of scenes) {
      const panels = Array.isArray(s.panels) ? s.panels.length : 0
      const sessions = Array.isArray(s.sessions) ? s.sessions.length : 0
      lines.push('| `' + String(s.id) + '` | ' + String(s.name || s.id) + ' | ' + String(s.skill || '') + ' | ' + panels + ' | ' + sessions + ' | `' + String(s.summary || ('agents/' + s.id + '/summary.md')) + '` |')
    }
    if (groups.length) {
      lines.push('')
      lines.push('## 二、协作分组')
      lines.push('')
      for (const g of groups) lines.push('- **' + String(g.name || g.id) + '**（`' + String(g.id) + '`）：' + (Array.isArray(g.members) ? g.members.join('、') : ''))
    }
    lines.push('')
    lines.push('## 三、面板/会话明细')
    lines.push('')
    for (const s of scenes) {
      const ps = Array.isArray(s.panels) ? s.panels : []
      if (!ps.length) continue
      lines.push('### ' + String(s.name || s.id) + '（`' + String(s.id) + '`）')
      for (const p of ps) lines.push('- `' + String(p.panelId || p.id || '') + '` · ' + String(p.type || '') + (p.title ? ' · ' + String(p.title) : ''))
      const ss = Array.isArray(s.sessions) ? s.sessions : []
      for (const ssx of ss) lines.push('- 会话：`' + String(ssx.sessionId || '') + '`' + (ssx.title ? '（' + String(ssx.title) + '）' : ''))
      lines.push('')
    }
    const text = lines.join('\n')
    writeAtomic(SCENE_INDEX, text)
    return { ok: true, file: SCENE_INDEX, scenes: scenes.length, bytes: Buffer.byteLength(text, 'utf8') }
  } catch (e) {
    return { ok: false, file: SCENE_INDEX, scenes: 0, bytes: 0, error: String((e && e.message) || e) }
  }
}
