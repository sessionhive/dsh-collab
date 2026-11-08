/**
 * migrate.js —— schemaVersion 迁移 + manifest sha 校验（v0.3.x 第一批 dh073）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { CONFIG, REGISTRY, META } from './paths.js'
import { readJson, writeJson, ensureDir, readText } from './store.js'

export const CURRENT_SCHEMA = 1
const PLUGIN = fileURLToPath(new URL('../', import.meta.url))
const MANIFEST = path.join(META, 'plugin-manifest.json')
const LOG = path.join(META, 'migrations.jsonl')

function sha(file) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') } catch (e) { return '' }
}
function log(row) { try { ensureDir(META); fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...row }) + '\n') } catch (e) { /* ignore */ } }

function migrateJson(file, label) {
  const j = readJson(file, null)
  if (!j || typeof j !== 'object') return { file: label, skipped: true, reason: 'missing/invalid' }
  if (Number(j.schemaVersion) >= CURRENT_SCHEMA) return { file: label, ok: true, changed: false }
  const bak = file + '.bak-' + Date.now()
  try {
    fs.copyFileSync(file, bak)
    j.schemaVersion = CURRENT_SCHEMA
    writeJson(file, j)
    log({ action: 'migrate', file: label, from: Number(j.schemaVersion) - 1 || 0, to: CURRENT_SCHEMA, backup: path.basename(bak) })
    return { file: label, ok: true, changed: true, backup: bak }
  } catch (e) {
    try { if (fs.existsSync(bak)) fs.copyFileSync(bak, file) } catch (e2) { /* ignore */ }
    log({ action: 'migrate-failed', file: label, error: String((e && e.message) || e) })
    return { file: label, ok: false, error: String((e && e.message) || e) }
  }
}

export function buildManifest() {
  const files = ['package.json', 'CHANGELOG.md', path.join('lib', 'index.js'), path.join('lib', 'runtime.js'), path.join('client', 'client.js'), path.join('lib', 'constitution', 'core.md')]
  const map = {}
  for (const rel of files) map[rel.replace(/\\/g, '/')] = sha(path.join(PLUGIN, rel))
  const pkg = readJson(path.join(PLUGIN, 'package.json'), {}) || {}
  const m = { name: 'dsh-workbench-core', version: pkg.version || '', algorithm: 'sha256', files: map, at: new Date().toISOString() }
  ensureDir(META)
  writeJson(MANIFEST, m)
  return m
}

export function verifyManifest() {
  if (!fs.existsSync(MANIFEST)) return { ok: false, skipped: true, detail: '未生成 manifest（启动时自动生成）' }
  const m = readJson(MANIFEST, null) || {}
  const bad = []
  for (const [rel, want] of Object.entries(m.files || {})) {
    const got = sha(path.join(PLUGIN, rel))
    if (!got || got !== want) bad.push(rel)
  }
  if (bad.length) return { ok: false, detail: 'sha 不一致：' + bad.slice(0, 5).join(' / ') }
  return { ok: true, detail: 'sha 一致（' + Object.keys(m.files || {}).length + ' 个文件）' }
}

export function migrateAll() {
  const out = { ok: true, schema: CURRENT_SCHEMA, steps: [] }
  try { out.steps.push(migrateJson(CONFIG, 'config.json')) } catch (e) { out.steps.push({ file: 'config.json', ok: false, error: String((e && e.message) || e) }); out.ok = false }
  try { out.steps.push(migrateJson(REGISTRY, 'registry.json')) } catch (e) { out.steps.push({ file: 'registry.json', ok: false, error: String((e && e.message) || e) }); out.ok = false }
  try {
    if (!fs.existsSync(MANIFEST)) { buildManifest(); out.steps.push({ file: 'manifest.json', ok: true, changed: true }) } else out.steps.push({ file: 'manifest.json', ok: true, changed: false })
  } catch (e) { out.steps.push({ file: 'manifest.json', ok: false, error: String((e && e.message) || e) }); out.ok = false }
  return out
}

export default migrateAll
