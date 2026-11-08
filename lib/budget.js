/**
 * budget.js —— 读 _meta\config.json 的上下文/唤醒预算；唤醒计数来自 events。
 */
import { CONFIG } from './paths.js'
import { readJson } from './store.js'
import { readEvents, wakesToday } from './events.js'

export const DEFAULTS = {
  handover: { warnContextTokens: 60000, contextThresholdTokens: 120000 },
  budget: { wakePerScenePerDay: 3, tokenPerScenePerDay: null },
  notice: { enabled: false, minutes: 20 },
  debug: false,
  lang: 'zh',
  theme: 'auto',
  protocol: { staleMinutes: 3, heartbeatMinutes: 20 },
  learn: { autoApply: true },
}

export function config() {
  const j = readJson(CONFIG, {}) || {}
  return {
    raw: j,
    handover: { ...DEFAULTS.handover, ...(j.handover || {}) },
    budget: { ...DEFAULTS.budget, ...(j.budget || {}) },
    notice: { ...DEFAULTS.notice, ...(j.notice || {}) },
    debug: j.debug === true,
    lang: String(j.lang || 'zh'),
    theme: String(j.theme || 'auto'),
    protocol: { ...DEFAULTS.protocol, ...(j.protocol || {}) },
    learn: { ...DEFAULTS.learn, ...(j.learn || {}) },
  }
}

/** 唤醒预算判定：force=true 显式 override（--force 语义） */
/** 唤醒统计（v0.2.11：闸已取消，不再消费 enforceWake/wakePerScenePerDay；仅统计） */
export function canWake(sceneId, force = false, events = readEvents()) {
  const used = wakesToday(sceneId, events)
  return { ok: true, used, limit: null, gate: 'disabled', hint: '唤醒预算闸已取消（v0.2.11），仅保留今日唤醒统计' }
}

/** 可选 token 预算：读 storages\session_projcache 的当日用量（只警告，不硬停） */
export function tokenWarn(sceneId) {
  const cfg = config()
  const limit = Number(cfg.budget.tokenPerScenePerDay)
  if (!limit) return null
  return { limit, hint: 'token 预算 ' + limit + '/场景/天（超限只警告，不硬停）' }
}
