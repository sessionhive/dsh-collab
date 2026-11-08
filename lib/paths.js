/**
 * 数据根常量：工作台根 / DSH_HOME / 各子目录。
 *
 * 2026-11-06（dh032）可移植化：
 *   - 数据根优先 DSH_HOME / DSH_CUSTOMER_HOME（外部 DSH 只给数据目录也能起）；
 *   - 工作台根（ROOT）只在存在 `外壳\` 时按「外壳上一级」推导，否则退回 DSH_WORKBENCH_ROOT / DSH_HOME 上一级；
 *   - 没有 `外壳\` 时 HAS_GUI=false：场景真源 = _meta\registry.json（不写 scenarios json）。
 * 与 `工具\_共用-协作.mjs`、`外壳\preload.js` 的口径一致（有外壳时行为不变）。
 */
import fs from 'node:fs'
import path from 'node:path'

const exists = (p) => { try { return fs.existsSync(p) } catch (e) { return false } }

function findRoot() {
  const cands = []
  if (process.env.DSH_WORKBENCH_ROOT) cands.push(process.env.DSH_WORKBENCH_ROOT)
  if (process.env.DSH_SHELL_DIR) cands.push(path.dirname(process.env.DSH_SHELL_DIR))
  if (process.env.DSH_HOME) cands.push(path.dirname(process.env.DSH_HOME))
  if (process.env.DSH_CUSTOMER_HOME) cands.push(path.dirname(process.env.DSH_CUSTOMER_HOME))
  let p = process.cwd()
  for (let i = 0; i < 6; i++) { cands.push(p); p = path.dirname(p) }
  for (const c of cands) {
    try { if (exists(path.join(c, '外壳'))) return c } catch (e) { /* ignore */ }
  }
  if (process.env.DSH_WORKBENCH_ROOT) return process.env.DSH_WORKBENCH_ROOT
  if (process.env.DSH_SHELL_DIR) return path.dirname(process.env.DSH_SHELL_DIR)
  if (process.env.DSH_HOME) return path.dirname(process.env.DSH_HOME)
  if (process.env.DSH_CUSTOMER_HOME) return path.dirname(process.env.DSH_CUSTOMER_HOME)
  return process.cwd()
}

/**
 * DSH 数据根（dh041 优先级）：
 *   1) cordis config.dataRoot（插件 apply 前写入 globalThis.__wbConfigDataRoot）
 *   2) DSH_HOME / DSH_CUSTOMER_HOME 环境变量
 *   3) <工作台根>\引擎数据\.dsh（当前行为）
 */
function findDataHome(root) {
  const override = typeof globalThis.__wbConfigDataRoot === 'string' ? globalThis.__wbConfigDataRoot.trim() : ''
  const cands = [override, process.env.DSH_HOME, process.env.DSH_CUSTOMER_HOME, path.join(root, '引擎数据', '.dsh')].filter(Boolean)
  for (const c of cands) { try { if (exists(c)) return c } catch (e) { /* ignore */ } }
  return cands[0]
}

export const ROOT = findRoot()
export const GUI = path.join(ROOT, '外壳')
export const HAS_GUI = (() => { try { return fs.statSync(path.join(GUI, 'scenarios')).isDirectory() } catch (e) { return false } })()
export const DSH_HOME = findDataHome(ROOT)
export const AGENTS = path.join(DSH_HOME, 'agents')
export const MEMORY = (id) => path.join(AGENTS, id, 'memory')
export const COLLAB = path.join(DSH_HOME, 'collab')
export const BLACKBOARD = path.join(DSH_HOME, 'blackboard')
export const SHARED = path.join(DSH_HOME, 'shared')
export const GLOBAL_RULES = path.join(SHARED, 'env', 'global-rules.md')
export const GLOBAL_INJECT = path.join(SHARED, 'env', 'global-rules.inject.md')
export const EVENTS_DIR = path.join(DSH_HOME, 'events')
export const EVENTS_FILE = path.join(EVENTS_DIR, 'events.jsonl')
export const DISPATCH_FILE = path.join(EVENTS_DIR, 'dispatch.jsonl')
export const VIOLATIONS_FILE = path.join(EVENTS_DIR, 'violations.jsonl')
export const COUNTER = path.join(EVENTS_DIR, 'counter.json')
export const META = path.join(DSH_HOME, '_meta')
export const REGISTRY = path.join(META, 'registry.json')
export const CONFIG = path.join(META, 'config.json')
export const CONSTITUTION = path.join(DSH_HOME, 'constitution', 'current')
export const SCENARIOS = path.join(GUI, 'scenarios')
export const TOOLS = path.join(ROOT, '工具')
export const BOARD_DIR = path.join(DSH_HOME, 'board')
export const BOARD_HTML = path.join(BOARD_DIR, 'index.html')
