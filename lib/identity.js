/**
 * identity.js —— 身份一致性校验（dh001 阶段2-1）
 *   真源 scenarios/*.json；派生 registry/card/scene-index。
 *   只读比对 id / name / panels / sessionId，返回差异清单，不自动写。
 */
import fs from 'node:fs'
import path from 'node:path'
import { SCENARIOS, DSH_HOME, REGISTRY, AGENTS, META, ROOT, GUI } from './paths.js'

function readJson(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { return def } }
function readText(p) { try { return fs.readFileSync(p, 'utf8') } catch (e) { return '' } }

function scenarioList(dir) {
  const out = []
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort() } catch (e) { return out }
  for (const f of files) {
    const j = readJson(path.join(dir, f), null)
    if (!j || !j.id) continue
    out.push({
      id: String(j.id), name: String(j.name || j.id),
      panels: (Array.isArray(j.panels) ? j.panels : []).map((p) => ({ id: String(p.id || ''), type: String(p.type || ''), title: String(p.title || ''), sessionId: String(p.sessionId || ''), sessionTitle: String(p.sessionTitle || '') })),
      file: f,
    })
  }
  return out
}

function indexMap(file) {
  const map = {}
  const lines = readText(file).split(/\r?\n/)
  for (const line of lines) {
    if (!/^\|\s*`[^`]+`\s*\|/.test(line)) continue
    const cells = line.split('|').map((x) => x.trim())
    // cells[0]='' cells[1]=id cells[2]=panelId cells[3]=panelTitle cells[4]=sessionName cells[5]=sessionId
    const clean = (s) => String(s || '').replace(/^`|`$/g, '').trim()
    const id = clean(cells[1])
    if (!id || id === '场景 id') continue
    if (!map[id]) map[id] = { panels: [], sessions: [] }
    const panelId = clean(cells[2])
    if (panelId) map[id].panels.push(panelId)
    const sid = clean(cells[5])
    if (sid && sid !== '—') map[id].sessions.push(sid)
  }
  return map
}

function sessionMapOf(panels) {
  const out = {}
  for (const p of panels) if (p.type === 'harness' && p.sessionId) out[p.id] = p.sessionId
  return out
}

/**
 * @param {{scenarios?:string, dshHome?:string, registry?:string, agents?:string, meta?:string}} [opts]
 */
export function identityCheck(opts = {}) {
  const scenDir = opts.scenarios || SCENARIOS
  const dsh = opts.dshHome || DSH_HOME
  const regFile = opts.registry || REGISTRY
  const agentsDir = opts.agents || AGENTS
  const indexFile = path.join(opts.meta || META, 'scene-index.md')
  if (!fs.existsSync(scenDir)) return { ok: true, skipped: 'no-scenarios', differences: [], counts: { scenarios: 0, registry: 0, cards: 0 } }
  const scen = scenarioList(scenDir)
  const reg = readJson(regFile, { scenes: [] })
  const regScenes = new Map((Array.isArray(reg.scenes) ? reg.scenes : []).map((s) => [String(s.id), s]))
  const idx = indexMap(indexFile)
  const diffs = []
  const add = (id, field, expected, actual, source) => diffs.push({ id, field, expected, actual, source })
  const ids = new Set([...scen.map((s) => s.id), ...regScenes.keys(), ...Object.keys(idx)])
  let cards = 0
  for (const id of [...ids].sort()) {
    const s = scen.find((x) => x.id === id)
    const r = regScenes.get(id)
    const card = readJson(path.join(agentsDir, id, 'card.json'), null)
    if (card) cards++
    if (!s) { add(id, 'scenario', '存在', '缺失', 'scenarios'); continue }
    if (!r) add(id, 'registry', '存在', '缺失', 'registry')
    if (!card) add(id, 'card', '存在', '缺失', 'card')
    if (!idx[id]) add(id, 'scene-index', '存在', '缺失', 'scene-index')
    if (r && String(r.name || '') !== s.name) add(id, 'name', s.name, String(r.name || ''), 'registry')
    if (card && String(card.name || '') !== s.name) add(id, 'name', s.name, String(card.name || ''), 'card')
    const regPanels = r && Array.isArray(r.panels) ? r.panels.map((p) => ({ id: String(p.panelId || ''), type: String(p.type || ''), title: String(p.title || '') })) : []
    const cardPanels = card && Array.isArray(card.panels) ? card.panels.map((p) => ({ id: String(p.id || ''), type: String(p.type || ''), title: String(p.title || '') })) : []
    const scenPanels = s.panels.map((p) => ({ id: p.id, type: p.type, title: p.title }))
    const keys = new Set([...scenPanels.map((p) => p.id), ...regPanels.map((p) => p.id), ...cardPanels.map((p) => p.id), ...((idx[id] && idx[id].panels) || [])])
    for (const pid of [...keys].sort()) {
      const sp = scenPanels.find((p) => p.id === pid)
      const rp = regPanels.find((p) => p.id === pid)
      const cp = cardPanels.find((p) => p.id === pid)
      if (!sp) add(id + '/' + pid, 'panel.scenario', '存在', '缺失', 'scenarios')
      if (sp && !rp) add(id + '/' + pid, 'panel.registry', '存在', '缺失', 'registry')
      if (sp && !cp) add(id + '/' + pid, 'panel.card', '存在', '缺失', 'card')
      if (sp && sp.type === 'harness' && !(idx[id] && idx[id].panels.includes(pid))) add(id + '/' + pid, 'panel.scene-index', '存在', '缺失', 'scene-index')
      if (sp && rp && (sp.type !== rp.type || sp.title !== rp.title)) add(id + '/' + pid, 'panel.meta', sp.type + '/' + sp.title, rp.type + '/' + rp.title, 'registry')
      if (sp && cp && (sp.type !== cp.type || sp.title !== cp.title)) add(id + '/' + pid, 'panel.meta', sp.type + '/' + cp.title, cp.type + '/' + cp.title, 'card')
    }
    const sSessions = sessionMapOf(s.panels)
    const rSessions = {}
    if (r && Array.isArray(r.sessions)) for (const x of r.sessions) rSessions[String(x.panelId || '')] = String(x.sessionId || '')
    const cSessions = {}
    if (card && Array.isArray(card.sessions)) for (const x of card.sessions) cSessions[String(x.panelId || '')] = String(x.sessionId || '')
    const sids = new Set([...Object.keys(sSessions), ...Object.keys(rSessions), ...Object.keys(cSessions)])
    for (const pid of [...sids].sort()) {
      if (sSessions[pid] == null) { add(id + '/' + pid, 'session.scenario', '存在', '缺失', 'scenarios'); continue }
      if (rSessions[pid] == null) add(id + '/' + pid, 'session.registry', '存在', '缺失', 'registry')
      else if (rSessions[pid] !== sSessions[pid]) add(id + '/' + pid, 'sessionId', sSessions[pid], rSessions[pid], 'registry')
      if (cSessions[pid] == null) add(id + '/' + pid, 'session.card', '存在', '缺失', 'card')
      else if (cSessions[pid] !== sSessions[pid]) add(id + '/' + pid, 'sessionId', sSessions[pid], cSessions[pid], 'card')
      if (idx[id] && !idx[id].sessions.includes(sSessions[pid])) add(id + '/' + pid, 'session.scene-index', '存在', '缺失', 'scene-index')
    }
  }
  const roots = {
    shellDir: String(process.env.DSH_SHELL_DIR || ''),
    workbenchRoot: ROOT,
    gui: GUI,
    toolsRoot: String(process.env.DSH_WORKBENCH_ROOT || ROOT),
    dataRoot: dsh,
    dataHomeOrder: ['DSH_CUSTOMER_HOME', '<root>/引擎数据/.dsh', 'DSH_HOME'],
    configDataRoot: String((typeof globalThis !== 'undefined' && globalThis.__wbConfigDataRoot) || ''),
    shellDirMatchesRoot: !process.env.DSH_SHELL_DIR || path.dirname(process.env.DSH_SHELL_DIR) === ROOT,
  }
  return { ok: diffs.length === 0, generatedAt: new Date().toISOString(), roots, sources: { scenarios: scenDir, registry: regFile, cards: agentsDir, sceneIndex: indexFile }, counts: { scenarios: scen.length, registry: regScenes.size, cards }, differences: diffs }
}

export default identityCheck
