/**
 * scene-pack.js —— 新建协作会话启动包（无角色模型 v0.3.5）：
 *   - skills\<id>\SKILL.md：通用协作规则（所有场景同一套）
 *   - summary 模板兜底
 *   - 开场 seed 文本
 */
import fs from 'node:fs'
import path from 'node:path'
import { DSH_HOME } from './paths.js'
import { ensureDir, exists, writeAtomic } from './store.js'

export function sceneSkillPath(id) { return path.join(DSH_HOME, 'skills', String(id), 'SKILL.md') }

export function skillTemplateFor({ id, name, mission }) {
  const who = String(name || id)
  const what = String(mission || '').trim() || (who + ' 的职责（待补）')
  return [
    '---',
    'name: ' + String(id),
    'description: 【协作会话】' + who + '：' + what.slice(0, 80) + '（触发词：「' + who + '」「' + String(id) + '」）',
    '---',
    '',
    '# ' + who + '（' + String(id) + '）',
    '',
    '你是 ' + who + '，负责 ' + what + '。',
    '',
    '## 什么时候用',
    '',
    '（写：什么场景/宿主说什么话时，该用这个技能；关联协作单/面板）',
    '',
    '## 怎么做',
    '',
    '1. 开场读 `_meta\\scene-index.md` 认领身份，再读 `agents\\' + String(id) + '\\card.json` + `summary.md`；',
    '2. 按职责干活，跨场景写协作单/黑板；',
    '3. 干完写回记忆并更新 summary。',
    '',
    '## 交付标准',
    '',
    '（写：做出什么算完成——文件 / 命令 / 证据路径；协作单终态）',
    '',
    '## 协作规则（所有场景同一套，无角色分支）',
    '',
    '1. 收到用户需求：先判断归属（我的 / 别人的），不猜、不抢。',
    '2. 自己的部分：先 ack → 干 → 写证据。',
    '3. 别人的部分：派单/转交（一单 flow，不拆单）。',
    '4. 有下一棒：完成必须转交，禁止 close。',
    '5. 最后一棒：转交回主负责人。',
    '6. 主负责人：收齐 → 验收 → close → 交付用户；禁 sleep/轮询。',
    '',
    '## 验收边界（只做这四件事）',
    '',
    '- ① refs 可达；② 结论与任务一致；③ 无未决项；④ close + 交付。',
    '- 默认不抽检；仅证据缺失/矛盾/高风险时抽检 ≤3。',
    '- ⛔ 禁止重跑 build / vet / test / 黑盒 / 重编。',
    '',
    '## 交接与产物',
    '',
    '- handoff 的 refs 引用单内段（如 `#记录-2026`）；只写「变更 + 证据」。',
    '- 单文档去重：handoff 只写变更+refs；终态只写证据目录+关键 2~3 条；ack 与 progress 分行。',
    '- 跨日引用单号写 `YYYY-MM-DD/dhNNN`（dhNNN 每日从 001 重置）。',
    '- 产物只落 `bin/`；PowerShell 5.1 验证用 HttpClient + UTF-8 文件 body（见下）。',
    '- 证据文件统一 UTF-8 编码（含 .md/.json/.txt）；禁止 UTF-16/GBK 写证据。',
    '',
    '```powershell',
    '# PS 5.1 最小验证：HttpClient + UTF-8 文件 body',
    '$body = [IO.File]::ReadAllText("$PWD\\body.json", [Text.Encoding]::UTF8)',
    '$c = New-Object Net.HttpClient',
    '$r = $c.PostAsync("http://127.0.0.1:3083/api/x", (New-Object Net.Http.StringContent($body, [Text.Encoding]::UTF8, "application/json"))).Result',
    '[IO.File]::WriteAllText("$PWD\\resp.json", $r.Content.ReadAsStringAsync().Result, [Text.Encoding]::UTF8)',
    '```',
    '',
    '## 开场读取（≤3）',
    '',
    '开场最多读 3 个文件：`agents\\<id>\\card.json` → `summary.md` → `_meta\\scene-index.md`（或 board）。读够就开工。',
    '',
    '## 注意',
    '',
    '- 只写自己的 `agents\\' + String(id) + '\\`；别人的记忆只读（BND-002）。',
    '- 结论必须带来源（INV-001）；记忆 ≤20 行/≤2KB（PRT-004）。',
    '',
  ].join('\n')
}

/** 生成/补齐技能文件；已存在但内容为空或缺少「怎么做」→ 重写。 */
export function ensureSceneSkill({ id, name, mission }) {
  const file = sceneSkillPath(id)
  if (exists(file)) {
    try {
      const t = fs.readFileSync(file, 'utf8')
      const how = (t.split('## 怎么做')[1] || '').split(/^## /m)[0] || ''
      const rulesOk = t.indexOf('## 协作规则') >= 0
      if (how.replace(/[\s#（(）)]/g, '').length >= 8 && rulesOk) return { ok: true, existed: true, file, skillId: String(id), nonEmpty: true }
    } catch (e) { /* rewrite below */ }
  }
  try {
    ensureDir(path.dirname(file))
    writeAtomic(file, skillTemplateFor({ id, name, mission }))
    return { ok: true, existed: false, file, skillId: String(id), nonEmpty: true }
  } catch (e) {
    return { ok: false, file, error: String((e && e.message) || e) }
  }
}

/** 兼容旧调用：开场 seed 文案（新代码用 entry-seed 短模板） */
export function launchSeedText({ id, name, mission }) {
  const who = String(name || id)
  const what = String(mission || '').trim() || '本协作会话职责'
  return [
    '你是「' + who + '」(场景 ' + id + ')。身份以 card 为准；忽略运行时角色名。',
    '数据根：' + DSH_HOME,
    '职责：' + what,
    '规则：收到需求先判断归属；自己的先 ack→干→写证据；别人的派单/转交（一单 flow）；有下一棒必须转交禁 close；最后一棒转交回主负责人；禁 sleep/轮询。',
  ].join('\n')
}
