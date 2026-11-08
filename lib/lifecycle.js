/**
 * lifecycle.js —— 会话协作三态（dh052）：active / pending（无绑定会话推导）/ archived。
 *   unbind → pending；archive → lifecycle=archived + archivedAt + lastGroup + 移出分组；
 *   restore → 回 lastGroup（pending）；delete → scenario json + agents/<id> 移入 dataRoot/trash；
 *   export → dataRoot/exports/<scene>-<yyyymmdd>/（card/summary/memory/skill）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { AGENTS, REGISTRY, ROOT, DSH_HOME, SCENARIOS, HAS_GUI } from './paths.js'
import { readJson, writeJson, ensureDir, exists, nowIso } from './store.js'
import { readGroups } from './groups.js'
import { scenes } from './rules.js'

function readReg() { return readJson(REGISTRY, {}) || {} }
function writeReg(reg) { writeJson(REGISTRY, reg) }

function currentGroupId(sceneId) {
  const { groups } = readGroups()
  for (const g of groups) if ((g.members || []).indexOf(String(sceneId)) >= 0) return g.id
  return ''
}

/** 归档：lifecycle=archived + archivedAt + lastGroup，移出分组，清绑定 */
export function archiveScene(id) {
  const sceneId = String(id || '').trim()
  const reg = readReg()
  const arr = Array.isArray(reg.scenes) ? reg.scenes : []
  const row = arr.find((s) => String(s.id) === sceneId)
  if (!row) return { ok: false, hint: '找不到场景：' + sceneId }
  row.lastGroup = currentGroupId(sceneId)
  row.lifecycle = 'archived'
  row.archivedAt = nowIso()
  row.sessions = []
  if (Array.isArray(reg.groups)) for (const g of reg.groups) g.members = (g.members || []).filter((m) => String(m) !== sceneId)
  writeReg(reg)
  // card 绑定清空（保留 card/summary/memory）
  try {
    const cf = path.join(AGENTS, sceneId, 'card.json')
    if (exists(cf)) { const card = readJson(cf, null) || {}; card.sessions = []; writeJson(cf, card) }
  } catch (e) { /* ignore */ }
  return { ok: true, sceneId, lifecycle: 'archived', lastGroup: row.lastGroup, archivedAt: row.archivedAt }
}

/** 恢复：回到 lastGroup（若无该组则未分组），状态 pending（需再绑定/新建才 active） */
export function restoreScene(id) {
  const sceneId = String(id || '').trim()
  const reg = readReg()
  const arr = Array.isArray(reg.scenes) ? reg.scenes : []
  const row = arr.find((s) => String(s.id) === sceneId)
  if (!row) return { ok: false, hint: '找不到场景：' + sceneId }
  const lastGroup = String(row.lastGroup || '')
  delete row.lifecycle
  delete row.archivedAt
  row.sessions = []
  if (!Array.isArray(reg.groups)) reg.groups = []
  for (const g of reg.groups) g.members = (g.members || []).filter((m) => String(m) !== sceneId)
  const g = reg.groups.find((x) => String(x.id) === lastGroup)
  if (g) { if (!Array.isArray(g.members)) g.members = []; g.members.push(sceneId) }
  writeReg(reg)
  return { ok: true, sceneId, lifecycle: 'pending', group: g ? g.id : '', note: g ? '已恢复到分组 ' + g.name : '原分组不存在，已回未分组（待处理）' }
}

function movePath(src, dest) {
  ensureDir(path.dirname(dest))
  try { fs.renameSync(src, dest) } catch (e) { fs.cpSync(src, dest, { recursive: true }); try { fs.rmSync(src, { recursive: true, force: true }) } catch (e2) { /* ignore */ } }
}

/** 删除场景到 dataRoot/trash：scenario json + agents/<id> 一起移入；确认必须为 true */
export function deleteSceneToTrash(id, confirm) {
  if (confirm !== true) return { ok: false, hint: '需要内联二次确认（confirm:true）' }
  const sceneId = String(id || '').trim()
  const reg = readReg()
  const arr = Array.isArray(reg.scenes) ? reg.scenes : []
  const row = arr.find((s) => String(s.id) === sceneId)
  if (!row) return { ok: false, hint: '找不到场景：' + sceneId }
  const stamp = String(Date.now())
  const dest = path.join(DSH_HOME, 'trash', 'scene-' + sceneId + '-' + stamp)
  ensureDir(dest)
  const moved = []
  try {
    const sf = path.join(SCENARIOS, sceneId + '.json')
    if (HAS_GUI && exists(sf)) { movePath(sf, path.join(dest, 'scenario.json')); moved.push('scenario.json') }
  } catch (e) { /* ignore */ }
  try {
    const ad = path.join(AGENTS, sceneId)
    if (exists(ad)) { movePath(ad, path.join(dest, 'agents-' + sceneId)); moved.push('agents/' + sceneId) }
  } catch (e) { /* ignore */ }
  // registry 行与分组移除
  reg.scenes = arr.filter((s) => String(s.id) !== sceneId)
  if (Array.isArray(reg.groups)) for (const g of reg.groups) g.members = (g.members || []).filter((m) => String(m) !== sceneId)
  writeReg(reg)
  return { ok: true, sceneId, dest, moved }
}

/** 导出快照到 dataRoot/exports/<sceneId>-<yyyymmdd-HHmm>/ */
export function exportSceneSnapshot(id) {
  const sceneId = String(id || '').trim()
  const scene = scenes().find((s) => String(s.id) === sceneId)
  if (!scene) return { ok: false, hint: '找不到场景：' + sceneId }
  const d = new Date()
  const p2 = (n) => (n < 10 ? '0' : '') + n
  const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes())
  const dir = path.join(DSH_HOME, 'exports', sceneId + '-' + stamp)
  ensureDir(dir)
  const copied = []
  const sourcePaths = {}
  const copyFile = (src, rel) => {
    try {
      if (!exists(src)) return
      const dest = path.join(dir, rel)
      ensureDir(path.dirname(dest))
      fs.cpSync(src, dest, { recursive: true })
      copied.push(rel.split(path.sep).join('/'))
      sourcePaths[rel.split(path.sep).join('/')] = src
    } catch (e) { /* ignore */ }
  }
  copyFile(path.join(AGENTS, sceneId, 'card.json'), 'card.json')
  copyFile(path.join(AGENTS, sceneId, 'summary.md'), 'summary.md')
  copyFile(path.join(AGENTS, sceneId, 'memory'), 'memory')
  copyFile(path.join(AGENTS, sceneId, 'playbooks'), 'playbooks')
  let skillIds = []
  try {
    const card = readJson(path.join(AGENTS, sceneId, 'card.json'), {}) || {}
    skillIds = Array.isArray(card.skills) ? card.skills.map(String) : []
  } catch (e) { skillIds = [] }
  if (!skillIds.length && scene.skill) skillIds = [String(scene.skill)]
  for (const sid of skillIds) {
    if (!sid || sid.indexOf('..') >= 0 || /[\\/]/.test(sid)) continue
    copyFile(path.join(DSH_HOME, 'skills', sid), path.join('skill', sid))
  }
  const manifest = {
    sceneId, name: String(scene.name || sceneId), exportedAt: nowIso(),
    lifecycle: String(scene.lifecycle || (Array.isArray(scene.sessions) && scene.sessions.length ? 'active' : 'pending')),
    sourcePaths,
  }
  try { fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8'); copied.push('manifest.json') } catch (e) { /* ignore */ }
  return { ok: true, sceneId, dir, copied, manifest }
}

/** 拖拽排序/入组：把场景移到指定组与位置（组内顺序持久化到 registry.groups[].members） */
export function moveSceneInGroup(sceneId, groupId, toIndex) {
  const id = String(sceneId || '').trim()
  const gid = String(groupId || '').trim()
  const reg = readReg()
  const arr = Array.isArray(reg.scenes) ? reg.scenes : []
  if (!arr.some((s) => String(s.id) === id)) return { ok: false, hint: '找不到场景：' + id }
  if (!Array.isArray(reg.groups)) reg.groups = []
  for (const g of reg.groups) g.members = (g.members || []).filter((m) => String(m) !== id)
  if (gid) {
    const g = reg.groups.find((x) => String(x.id) === gid)
    if (!g) return { ok: false, hint: '找不到分组：' + gid }
    if (!Array.isArray(g.members)) g.members = []
    let idx = Number.isFinite(Number(toIndex)) ? Number(toIndex) : g.members.length
    idx = Math.max(0, Math.min(g.members.length, idx))
    g.members.splice(idx, 0, id)
  }
  writeReg(reg)
  return { ok: true, sceneId: id, groupId: gid }
}

/** 看板/设置用三态计数 */
export function lifecycleStats() {
  const arr = scenes()
  let active = 0, pending = 0, archived = 0, oldArchived = 0
  const now = Date.now()
  const rows = arr.map((s) => {
    const sid = Array.isArray(s.sessions) && s.sessions[0] ? String(s.sessions[0].sessionId || '') : ''
    const state = s.lifecycle === 'archived' ? 'archived' : (sid ? 'active' : 'pending')
    if (state === 'active') active++
    else if (state === 'pending') pending++
    else {
      archived++
      const at = s.archivedAt ? new Date(s.archivedAt).getTime() : 0
      if (at && now - at > 30 * 24 * 3600 * 1000) oldArchived++
    }
    return { id: String(s.id), state, archivedAt: s.archivedAt || '' }
  })
  return { active, pending, archived, oldArchived, rows }
}
