/**
 * tools/schema.js —— wb_write / wb_read 参数与 action 的单一真源（v0.3.2 协议闭环）
 *   runtime 注册工具时由此生成 schema；手写实现不再各写一份。
 */
export const WRITE_ACTIONS = [
  { name: 'note', desc: '写结论（refs 非空，只写自己场景）' },
  { name: 'progress', desc: '进度/心跳行（record 为别名）' },
  { name: 'comment', desc: '单内说明（任何角色）' },
  { name: 'task', desc: '建单（五件套 + task_hash/depends_on/write_scopes/collaborators）' },
  { name: 'submit', desc: '提交（refs 证据）' },
  { name: 'verify', desc: '验收通过（仅 dispatcher，refs）' },
  { name: 'reject', desc: '验收退回（仅 dispatcher，refs）' },
  { name: 'close', desc: '关单 done/blocked/cancelled + 回执 dispatcher' },
  { name: 'cancel', desc: '取消（需原因）' },
  { name: 'reopen', desc: '恢复 blocked 单' },
  { name: 'handoff', desc: '单内接力（next/back，to 在 flow 或 dispatcher）' },
]

const BASE_PARAMS = {
  action: { type: 'string', required: true, description: 'action（见 actions）' },
  scene: { type: 'string', description: 'note：目标场景 id（只能写自己）' },
  text: { type: 'string', description: 'note/comment：正文' },
  refs: { type: 'array', items: { type: 'string' }, description: 'note/submit/verify/reject/close/handoff：证据路径或链接' },
  orderId: { type: 'string', description: '协作单号' },
  id: { type: 'string', description: '协作单号别名' },
  line: { type: 'string', description: 'progress：追加的一行' },
  to: { type: 'string', description: 'task：接单场景；handoff：下一棒角色' },
  task: { type: 'string', description: 'task：任务说明' },
  loc: { type: 'string', description: 'task：落点（改哪些文件）' },
  forbid: { type: 'string', description: 'task：禁区' },
  accept: { type: 'string', description: 'task：可观察验收' },
  wake: { type: 'boolean', description: 'task：是否唤醒接单场景' },
  force: { type: 'boolean', description: 'wake 预算显式 override' },
  status: { type: 'string', description: 'close：done / blocked / cancelled' },
  note: { type: 'string', description: 'close/cancel/handoff：结论/原因' },
  author: { type: 'string', description: '写作者场景 id（默认取当前会话所属场景）' },
  collaborators: { type: 'array', items: { type: 'string' }, description: 'task：协作者' },
  depends_on: { type: 'array', items: { type: 'string' }, description: 'task：前置单号' },
  write_scopes: { type: 'array', items: { type: 'string' }, description: 'task：写入范围（并发冲突警告）' },
  slug: { type: 'string', description: 'task：文件名后缀' },
  group: { type: 'string', description: 'task：分组标注' },
  flow: { type: 'array', items: { type: 'string' }, description: 'task：接力顺序（[别人] 或 [自己,别人]）' },
  evidence: { type: 'string', description: 'task：证据文件/路径（五项之一）' },
  kind: { type: 'string', description: 'handoff：next | back' },
}

export function writeParameters() {
  const p = JSON.parse(JSON.stringify(BASE_PARAMS))
  p.action.description = WRITE_ACTIONS.map((a) => a.name).join(' / ')
  return p
}

export function writeDescription() {
  return '写：note/progress/comment/task/submit/verify/reject/close/cancel/reopen/handoff。'
}

export const READ_PARAMS = {
  action: { type: 'string', required: true, description: 'check / scene / order / board / search' },
  scene: { type: 'string', description: 'scene：场景 id/名称/会话 id；search：按场景过滤' },
  id: { type: 'string', description: '协作单号 dhNNN（order 用）' },
  full: { type: 'boolean', description: 'board 是否带原始 config' },
  q: { type: 'string', description: 'search：关键词' },
  query: { type: 'string', description: 'search：关键词（优先于 q）' },
  scope: { type: 'string', description: 'search：memory / playbooks / blackboard / collab' },
  task_type: { type: 'string', description: 'search：按协作单 task_type 过滤' },
  since: { type: 'string', description: 'search：起始日期 YYYY-MM-DD' },
  limit: { type: 'number', description: 'search：返回条数（默认 5）' },
}
