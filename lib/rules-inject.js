/**
 * rules-inject.js —— 全局规则 → 注入片段（dh032 骨架，可 import，默认不启用）。
 * 手动调用 buildInject()/writeInject() 才生成 shared\env\global-rules.inject.md；
 * 插件启动时不会自动写盘（避免意外改外部 DSH 的注入文件）。
 */
import { GLOBAL_RULES, GLOBAL_INJECT } from './paths.js'
import { exists, readText, writeAtomic } from './store.js'

export const HEADER = '<!-- 由 workbench-core rules-inject 生成；改规则请改 shared\\env\\global-rules.md -->'

export function buildInject(rulesText) {
  const body = String(rulesText == null ? (exists(GLOBAL_RULES) ? readText(GLOBAL_RULES) : '') : rulesText).trim()
  if (!body) return { ok: false, hint: '全局规则为空：' + GLOBAL_RULES }
  return { ok: true, text: HEADER + '\n\n' + body + '\n', source: GLOBAL_RULES, target: GLOBAL_INJECT }
}

/** 显式落盘（返回写的字节数）；调用方自负时机 */
export function writeInject(rulesText) {
  const r = buildInject(rulesText)
  if (!r.ok) return r
  writeAtomic(GLOBAL_INJECT, r.text)
  return { ok: true, target: GLOBAL_INJECT, bytes: Buffer.byteLength(r.text, 'utf8') }
}

export default buildInject
