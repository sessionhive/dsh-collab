/**
 * host.js —— 插件 host ctx 的注入点（dh043）：sessionController / workspaceRegistry 等 host 服务都从这里取。
 */
let HOST = null
let CONFIG = {}

export function configureHost(ctx, config) { HOST = ctx || null; CONFIG = config || {} }

export function hostCtx() { return HOST }

export function hostConfig() { return CONFIG }

/** ctx.get(name) 的安全封装；没有 host 时返回 undefined */
export function hostGet(name) {
  try {
    if (!HOST || typeof HOST.get !== 'function') return undefined
    return HOST.get(name)
  } catch (e) { return undefined }
}
