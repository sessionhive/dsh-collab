/**
 * health.js —— 健康聚合占位（dh032 骨架，可 import，默认不启用）。
 * 只读：目录/关键文件存在性 + registry 场景数 + 在途单数；不写盘、不弹窗。
 */
import fs from 'node:fs'
import { DSH_HOME, AGENTS, COLLAB, BLACKBOARD, SHARED, EVENTS_DIR, META, REGISTRY, CONFIG, GLOBAL_RULES } from './paths.js'
import { readJson, readText } from './store.js'
import { scenes } from './rules.js'
import { allOrders } from './collab.js'

const exists = (p) => { try { return fs.existsSync(p) } catch (e) { return false } }
const bytes = (p) => { try { return fs.statSync(p).size } catch (e) { return 0 } }

export function aggregate() {
  const reg = readJson(REGISTRY, {}) || {}
  const open = allOrders().filter((o) => !o.done)
  const dirs = [AGENTS, COLLAB, BLACKBOARD, SHARED, EVENTS_DIR, META]
  const files = [REGISTRY, CONFIG, GLOBAL_RULES]
  return {
    ok: true,
    dataHome: DSH_HOME,
    dirs: dirs.map((d) => ({ path: d, exists: exists(d) })),
    files: files.map((f) => ({ path: f, exists: exists(f), bytes: bytes(f) })),
    scenes: scenes().length,
    groups: Array.isArray(reg.groups) ? reg.groups.length : 0,
    openOrders: open.length,
    rulesBytes: exists(GLOBAL_RULES) ? Buffer.byteLength(readText(GLOBAL_RULES), 'utf8') : 0,
  }
}

export default aggregate
