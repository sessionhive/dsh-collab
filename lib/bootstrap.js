/**
 * bootstrap.js —— 首次运行自举（dh032）。
 * 只创建缺失的目录/文件；已存在绝不覆盖。
 * 外部 DSH：只有数据目录也能起（无 外壳 时场景真源 = _meta\registry.json）。
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  DSH_HOME, AGENTS, COLLAB, BLACKBOARD, SHARED, EVENTS_DIR, META, REGISTRY, CONFIG, GLOBAL_RULES, HAS_GUI, ROOT,
} from './paths.js'
import { DEFAULTS } from './budget.js'
import { ensureDir, exists, readText, writeAtomic, writeJson } from './store.js'
import { ensureBoardPage } from './board.js'

const RULES_TEMPLATE = [
  '# 全局规则（可编辑）',
  '',
  '> 写入 shared\\env\\global-rules.md；保存后合成注入片段；只对 registry 已注册的协作会话生效。',
  '',
  '## 通用规范',
  '',
  '- 用中文交付；结论必须带证据路径（INV-001）。',
  '- 交付说清：结论 + 改了哪些文件 + 怎么生效（⟳ 还是重启）。',
  '',
].join('\n')

/** 首次运行：建目录 + 缺省文件；返回本次实际创建了什么 */
export function ensureBootstrap() {
  const created = []
  const dirs = [
    DSH_HOME,
    AGENTS, COLLAB, BLACKBOARD,
    path.join(SHARED, 'env'),
    EVENTS_DIR, META,
    path.join(DSH_HOME, 'constitution', 'current'),
  ]
  for (const d of dirs) {
    if (!exists(d)) { ensureDir(d); created.push(d) }
  }
  if (!exists(CONFIG)) { writeJson(CONFIG, DEFAULTS); created.push(CONFIG) }
  if (!exists(REGISTRY)) { writeJson(REGISTRY, { schemaVersion: 1, scenes: [], groups: [] }); created.push(REGISTRY) }
  if (!exists(GLOBAL_RULES)) { writeAtomic(GLOBAL_RULES, RULES_TEMPLATE); created.push(GLOBAL_RULES) }
  // dh048/dh049：内置看板写到 <dataRoot>\board\index.html（英文目录，注入引擎端口）
  try { const b = ensureBoardPage(); if (b.written) created.push(b.file) } catch (e) { /* 看板写盘失败不阻断自举 */ }
  return { ok: true, dataHome: DSH_HOME, hasGui: HAS_GUI, root: ROOT, created }
}

/** 供外部脚本/测试直接调用：只读报告，不写盘 */
export function bootstrapStatus() {
  return {
    dataHome: DSH_HOME, root: ROOT, hasGui: HAS_GUI,
    dirs: [AGENTS, COLLAB, BLACKBOARD, SHARED, EVENTS_DIR, META].map((d) => ({ path: d, exists: exists(d) })),
    files: [CONFIG, REGISTRY, GLOBAL_RULES].map((f) => ({ path: f, exists: exists(f), bytes: exists(f) ? Buffer.byteLength(readText(f), 'utf8') : 0 })),
  }
}
