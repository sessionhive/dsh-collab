/**
 * workspaces.js —— 工作区列表/解析（dh043；dh048 不再使用中文目录，未选时由 app 管理工作区）。
 *
 *   优先 host `ctx.get('workspaceRegistry').list()`；
 *   退到 `DSH_HOME\storages\workspace.json`（app 已注册工作区）；
 *   再退 config.defaultCwd；都没有 = 未选择（插件不接管使用者工作区）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DSH_HOME, CONFIG } from './paths.js'
import { readJson } from './store.js'
import { hostGet } from './host.js'

function fromHost() {
  try {
    const wr = hostGet('workspaceRegistry')
    if (!wr || typeof wr.list !== 'function') return null
    const arr = wr.list()
    return arr.map((w) => ({
      id: String((w && (w.id || w.workspaceId)) || ''),
      title: String((w && w.title) || ''),
      path: String((w && (w.path || w.dir || w.cwd)) || ''),
    })).filter((w) => w.id && w.path)
  } catch (e) { return null }
}

function fromStorages() {
  try {
    const wf = path.join(DSH_HOME, 'storages', 'workspace.json')
    const j = JSON.parse(fs.readFileSync(wf, 'utf8'))
    const tbl = (j && j.tables) || {}
    return Object.entries(tbl.workspaces || {}).map(([id, v]) => ({
      id: String(id), title: String((v && v.title) || ''), path: String((v && v.path) || ''),
    })).filter((w) => w.path)
  } catch (e) { return [] }
}

/** @returns {{ok:boolean, source:'host'|'storages'|'none', workspaces:Array<{id,title,path}>, config:{defaultCwd:string,seedOnCreate:boolean}}} */
export function listWorkspaces() {
  const host = fromHost()
  const workspaces = host && host.length ? host : fromStorages()
  const cfg = readJson(CONFIG, {}) || {}
  const defaultCwd = String(cfg.defaultCwd || '').trim()
  const seedOnCreate = cfg.seedOnCreate !== false
  return {
    ok: true,
    source: host && host.length ? 'host' : (workspaces.length ? 'storages' : 'none'),
    workspaces,
    config: { defaultCwd, seedOnCreate },
    error: workspaces.length ? '' : '没有可列出的工作区（host 无 workspaceRegistry 且 storages\\workspace.json 无数据）',
  }
}

/** 按 id 找工作区；找不到返回 null */
export function resolveWorkspace(workspaceId) {
  const id = String(workspaceId || '').trim()
  if (!id) return null
  return listWorkspaces().workspaces.find((w) => String(w.id) === id) || null
}

/** 新建会话的 cwd：显式 cwd → 工作区 → config.defaultCwd → ''（未选择；由 app 管理工作区，插件不接管） */
export function resolveCreateCwd({ cwd, workspaceId } = {}) {
  const explicit = String(cwd || '').trim()
  if (explicit) return { cwd: explicit, source: 'explicit', workspaceId: String(workspaceId || '') }
  if (workspaceId) {
    const w = resolveWorkspace(workspaceId)
    if (w && w.path) return { cwd: w.path, source: 'workspace', workspaceId: String(w.id) }
  }
  const cfg = readJson(CONFIG, {}) || {}
  const def = String(cfg.defaultCwd || '').trim()
  if (def) return { cwd: def, source: 'config.defaultCwd', workspaceId: '' }
  return { cwd: '', source: 'missing', workspaceId: '' }
}
