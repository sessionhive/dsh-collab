/**
 * groups.js —— 协作分组（registry.json 的 groups 字段，2026-11-05 dh027）。
 *   groups: [{ id, name, members:[sceneId], note }]
 * 规则：id 小写字母/数字/连字符；members 必须是 registry 已注册场景；一个场景只能在一个组。
 */
import { REGISTRY } from './paths.js'
import { readJson, writeJson, readText } from './store.js'
import { hashFile, writeJsonGuardedSync } from './concurrency.js'
import { scenes } from './rules.js'

const ID_RE = /^[a-z0-9][a-z0-9-]{0,23}$/

function normalize(raw, sceneIds) {
  const list = Array.isArray(raw) ? raw : []
  const seen = {}
  const out = []
  for (const g of list) {
    if (!g || typeof g !== 'object') continue
    const id = String(g.id || '').trim()
    const name = String(g.name || '').trim()
    if (!ID_RE.test(id) || !name) continue
    if (out.some((x) => x.id === id)) continue
    const members = []
    for (const m of (Array.isArray(g.members) ? g.members : [])) {
      const sid = String(m || '').trim()
      if (!sid || !sceneIds[sid] || seen[sid] || members.indexOf(sid) >= 0) continue
      seen[sid] = 1
      members.push(sid)
    }
    out.push({ id, name: name.slice(0, 40), members, note: String(g.note || '').slice(0, 200) })
  }
  return out
}

export function readGroups() {
  const reg = readJson(REGISTRY, {}) || {}
  const ids = {}
  for (const s of scenes()) ids[String(s.id)] = 1
  const groups = normalize(reg.groups, ids)
  const sceneGroup = {}
  for (const g of groups) for (const m of g.members) sceneGroup[m] = g.id
  const ungrouped = Object.keys(ids).filter((id) => !sceneGroup[id])
  return { groups, sceneGroup, ungrouped }
}

/** 整表覆盖保存；失败返回 {ok:false,rule,hint} */
export function writeGroups(raw) {
  const reg = readJson(REGISTRY, {}) || {}
  const ids = {}
  for (const s of scenes()) ids[String(s.id)] = 1
  const groups = normalize(raw, ids)
  if (Array.isArray(raw) && raw.length && !groups.length) return { ok: false, rule: 'PRT-013', hint: '分组数据全部不合法（id 需 [a-z0-9-]，name 必填，members 必须是已注册场景）' }
  reg.groups = groups
  writeJson(REGISTRY, reg)
  return { ok: true, ...readGroups() }
}

/** 场景 → 组名（看板/协作单标注用） */
export function groupOfScene(sceneId) {
  const { groups, sceneGroup } = readGroups()
  const gid = sceneGroup[String(sceneId || '')]
  if (!gid) return null
  const g = groups.find((x) => x.id === gid)
  return g ? { id: g.id, name: g.name, note: g.note } : null
}

function writeRawGroups(groups) {
  const regHash = hashFile(REGISTRY)
  const reg = readJson(REGISTRY, {}) || {}
  reg.groups = groups
  // dh046：写前比对 registry hash，被外部改动则取消并提示
  const w = writeJsonGuardedSync(REGISTRY, reg, { expectedHash: regHash, reason: 'groups-write' })
  if (!w.ok) return { ok: false, concurrent: true, rule: 'PRT-016', hint: w.reason }
  return { ok: true, ...readGroups() }
}

/** 改名/改备注（dh043） */
export function renameGroup(id, { name, note } = {}) {
  const { groups } = readGroups()
  const g = groups.find((x) => x.id === String(id || ''))
  if (!g) return { ok: false, rule: 'PRT-013', hint: '找不到分组：' + (id || '') }
  if (name != null) {
    const n = String(name).trim()
    if (!n) return { ok: false, rule: 'PRT-013', hint: '分组名称不能为空' }
    g.name = n.slice(0, 40)
  }
  if (note != null) g.note = String(note).trim().slice(0, 200)
  const r = writeRawGroups(groups)
  return { ok: true, ...r }
}

/** 删除分组：成员回「未分组」，不删场景/会话/card（dh043） */
export function deleteGroup(id) {
  const { groups } = readGroups()
  const target = String(id || '')
  if (!groups.some((g) => g.id === target)) return { ok: false, rule: 'PRT-013', hint: '找不到分组：' + target }
  const r = writeRawGroups(groups.filter((g) => g.id !== target))
  return { ok: true, deleted: target, ...r }
}

/** 把场景加入某组（先从其他组移除）；groupId 为空 = 未分组 */
export function assignSceneToGroup(sceneId, groupId) {
  const { groups, sceneGroup } = readGroups()
  const sid = String(sceneId || '')
  const gid = String(groupId || '')
  if (!sid) return { ok: false, rule: 'PRT-013', hint: 'sceneId 不能为空' }
  if (gid && !groups.some((g) => g.id === gid)) return { ok: false, rule: 'PRT-013', hint: '找不到分组：' + gid }
  for (const g of groups) g.members = (g.members || []).filter((m) => m !== sid)
  if (gid) groups.find((g) => g.id === gid).members.push(sid)
  const r = writeRawGroups(groups)
  return { ok: true, ...r }
}
