/**
 * workbench-core 插件入口（dh041：config.dataRoot 支持 + 懒加载 runtime）。
 *
 * 为什么薄：paths.js 在 import 时就固化数据根常量；cordis 的 config 在 apply 时才拿到，
 * 所以 apply 先把 config.dataRoot 记到 globalThis，再动态 import ./runtime.js，
 * 让 paths.js 第一次求值时就能用上配置的数据根。
 * 优先级：config.dataRoot → DSH_HOME / DSH_CUSTOMER_HOME → <工作台根>\引擎数据\.dsh（当前行为）。
 */
export const name = 'workbench-core'
export const inject = ['tools', 'webServer']

export async function apply(ctx, config) {
  try {
    const dr = config && config.dataRoot
    if (typeof dr === 'string' && dr.trim()) globalThis.__wbConfigDataRoot = dr.trim()
  } catch (e) { /* config 不合法就退回环境变量/默认数据根 */ }
  const runtime = await import('./runtime.js')
  await runtime.install(ctx, config || {})
}
