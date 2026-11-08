/**
 * templates.js —— 模板加载（v0.3.2）：内置 lib/templates/，可由 <dataRoot>/shared/templates/ 覆盖。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_HOME } from './paths.js'

const BUILTIN = path.dirname(fileURLToPath(import.meta.url)) + path.sep + 'templates'

export function loadTemplate(name) {
  const n = String(name || '')
  if (!/^[a-z0-9-]+\.md$/i.test(n)) return ''
  const override = path.join(DSH_HOME, 'shared', 'templates', n)
  try { if (fs.existsSync(override)) return fs.readFileSync(override, 'utf8') } catch (e) { /* fall through */ }
  try { return fs.readFileSync(path.join(BUILTIN, n), 'utf8') } catch (e) { return '' }
}

export function renderTemplate(name, vars) {
  let t = loadTemplate(name)
  if (!t) return ''
  for (const [k, v] of Object.entries(vars || {})) t = t.split('<' + k + '>').join(String(v == null ? '' : v))
  return t
}

export function templateInfo() {
  return {
    builtinDir: BUILTIN,
    overrideDir: path.join(DSH_HOME, 'shared', 'templates'),
    seed: loadTemplate('seed.md').slice(0, 200),
    dispatch: loadTemplate('dispatch.md').slice(0, 200),
  }
}
