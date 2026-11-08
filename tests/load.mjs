#!/usr/bin/env node
/**
 * workbench-core 加载/路由测试（不启动引擎）
 *   node 插件\workbench-core\tests\load.mjs
 *
 * 用假 ctx 调 apply()：验证
 *   - 两个工具都注册、名字/描述长度符合契约（≤80 字）
 *   - webServer 路由挂在前缀 /plugins/workbench-core
 *   - /spike /board-data /global-rules(GET/POST) /scenes /notice(GET/POST) 的 HTTP 响应
 */
import fs from 'node:fs'
import path from 'node:path'

const REAL = 'D:\\ChengXu\\Ai\\Workbench'
const SB = path.join(REAL, '工作区', '_临时', 'wb-core-load-' + process.pid)
const DSH = path.join(SB, '引擎数据', '.dsh')
function mk(p) { fs.mkdirSync(p, { recursive: true }) }
function w(p, t) { mk(path.dirname(p)); fs.writeFileSync(p, t, 'utf8') }
function wj(p, o) { w(p, JSON.stringify(o, null, 2)) }

fs.rmSync(SB, { recursive: true, force: true })
mk(path.join(SB, '外壳', 'scenarios'))
mk(path.join(SB, '工作区', '看板'))
mk(path.join(SB, '工具', 'gen'))
mk(path.join(DSH, '_meta'))
mk(path.join(DSH, 'agents', 'demo'))
mk(path.join(DSH, 'collab'))
mk(path.join(DSH, 'events'))
mk(path.join(DSH, 'blackboard'))
mk(path.join(DSH, 'shared', 'env'))
mk(path.join(DSH, 'constitution', 'current'))
mk(path.join(DSH, 'storages'))
w(path.join(SB, '工作区', '看板', 'index.html'), '<!doctype html><title>board</title><h1>看板</h1>')
w(path.join(DSH, 'events', 'events.jsonl'), '')
w(path.join(DSH, 'events', 'dispatch.jsonl'), '')
w(path.join(DSH, 'events', 'violations.jsonl'), '')
wj(path.join(DSH, 'events', 'counter.json'), { last_order_seq: 20 })
wj(path.join(DSH, '_meta', 'config.json'), { notice: { enabled: false, minutes: 20 }, budget: { wakePerScenePerDay: 3 } })
wj(path.join(DSH, '_meta', 'registry.json'), { scenes: [{ id: 'demo', name: '演示', panels: [{ panelId: 'demo-ai', type: 'harness' }], sessions: [{ panelId: 'demo-ai', sessionId: 'S-DEMO' }], skill: 'demo' }], groups: [] })
w(path.join(DSH, 'agents', 'demo', 'summary.md'), '# 演示\n\n## 在做\n- 空闲\n')
w(path.join(DSH, 'shared', 'env', 'global-rules.md'), '# 全局规则\n\n- 测试\n')
w(path.join(DSH, 'constitution', 'current', 'INV-001.md'), '---\nid: INV-001\nsection: 6\ntitle: 来源\n---\n\n写结论必须带来源。\n')
mk(path.join(DSH, 'skills', 'demo'))
w(path.join(DSH, 'skills', 'demo', 'SKILL.md'), '# demo skill\n')
// dh048：ops 沙箱（dataRoot 下英文目录 trash/backups/temp）
mk(path.join(DSH, 'trash', 'olddir'))
w(path.join(DSH, 'trash', 'trash1.txt'), 'trash content')
w(path.join(DSH, 'backups', 'bk1', 'a.txt'), 'backup-a')
w(path.join(DSH, 'backups', 'bk2.zip'), 'backup-b')
w(path.join(DSH, 'temp', 'tmpfile.txt'), 'temp content')
w(path.join(DSH, 'events', 'events.jsonl'), Array.from({ length: 8 }, (_, i) => JSON.stringify({ ts: '2026-11-06T00:0' + i + ':00.000Z', type: 'test', n: i })).join('\n') + '\n')

process.env.DSH_WORKBENCH_ROOT = SB
process.env.DSH_SHELL_DIR = path.join(SB, '外壳')
process.env.DSH_CUSTOMER_HOME = ''
process.env.DSH_HOME = ''

const tools = []
const routes = []
const ctx = {
  tools: { register(t) { tools.push(t) } },
  webServer: { register(r) { routes.push(r); return { dispose() { } } } },
  effect(fn) { fn() },
  get() { return undefined },
}
const mod = await import('../lib/index.js')
check0('name/inject 正确', mod.name === 'workbench-core' && mod.inject.includes('tools') && mod.inject.includes('webServer'))
await mod.apply(ctx)
check0('注册 2 个工具', tools.length === 2, tools.map((t) => t.name).join(','))
for (const t of tools) {
  const d = String(t.description || '')
  check0('工具 ' + t.name + ' 描述 ≤80 字', d.length > 0 && d.length <= 80, d.length + ' 字')
  check0('工具 ' + t.name + ' 有参数 schema + execute', !!t.parameters && typeof t.execute === 'function')
}
check0('路由前缀正确', routes.length === 1 && routes[0].path === '/plugins/workbench-core')

// ---- 假 req/res 调 handler ----
async function call(url, method = 'GET', body = null) {
  let payload = ''
  const req = {
    method, url,
    on(ev, fn) {
      if (ev === 'data' && body != null) fn(Buffer.from(JSON.stringify(body), 'utf8'))
      if (ev === 'end') fn()
    },
    destroy() { },
    socket: { remoteAddress: '127.0.0.1' },
  }
  const out = { code: 0, headers: {}, body: '' }
  const res = {
    setHeader(k, v) { out.headers[k] = v },
    writeHead(c, h) { out.code = c; Object.assign(out.headers, h || {}) },
    end(s) { out.body += String(s == null ? '' : s) },
  }
  await routes[0].handler(req, res)
  return out
}
const results = []
function check(name, cond, extra = '') { results.push({ name, ok: !!cond, extra: String(extra).slice(0, 200) }); console.log((cond ? '✓ ' : '✗ ') + name + (extra ? '  · ' + String(extra).slice(0, 160) : '')) }

const spike = await call('/plugins/workbench-core/spike')
check('/spike 200 + clientApi', spike.code === 200 && JSON.parse(spike.body).clientApi.includes('settings.section'))

const bd = await call('/plugins/workbench-core/board-data')
const bdJson = JSON.parse(bd.body)
check('/board-data 200 + root=沙箱数据根', bd.code === 200 && bdJson.root === DSH, 'root=' + bdJson.root)

const gr = await call('/plugins/workbench-core/global-rules')
check('/global-rules GET 返回 text', gr.code === 200 && JSON.parse(gr.body).text.includes('全局规则'))
const grSave = await call('/plugins/workbench-core/global-rules', 'POST', { text: '# 全局规则\n\n- 改后的内容\n' })
check('/global-rules POST 保存成功', grSave.code === 200 && JSON.parse(grSave.body).ok === true)
const grBig = await call('/plugins/workbench-core/global-rules', 'POST', { text: 'x'.repeat(33 * 1024) })
check('/global-rules POST >32KB 拒绝', grBig.code === 400 && JSON.parse(grBig.body).ok === false)

const sc = await call('/plugins/workbench-core/scenes')
check('/scenes 200 + 场景行', sc.code === 200 && JSON.parse(sc.body).scenes.length === 1)
const scNew = await call('/plugins/workbench-core/scene', 'POST', { id: 'newbie', name: '新场景', sessionId: 'S-NEW', role: '负责测试', skill: 'newbie' })
check('/scene 新增成功（card + scenarios + gen-index）', scNew.code === 200 && JSON.parse(scNew.body).ok === true && fs.existsSync(path.join(DSH, 'agents', 'newbie', 'card.json')) && fs.existsSync(path.join(SB, '外壳', 'scenarios', 'newbie.json')))

const nt = await call('/plugins/workbench-core/notice')
check('/notice GET 返回开关', nt.code === 200)
const ntSave = await call('/plugins/workbench-core/notice', 'POST', { enabled: true, minutes: 30 })
check('/notice POST 保存成功', ntSave.code === 200 && JSON.parse(ntSave.body).notice.minutes === 30)

// ---- 其他路由（读取/清理）----
const sk = await call('/plugins/workbench-core/skills')
check('/skills 200', sk.code === 200 && Array.isArray(JSON.parse(sk.body).skills))
const gp = await call('/plugins/workbench-core/groups')
check('/groups 200', gp.code === 200 && Array.isArray(JSON.parse(gp.body).groups))
const ses = await call('/plugins/workbench-core/sessions')
const sesJson = JSON.parse(ses.body)
check('/sessions 无 host API 时返回原因+空 unbound（dh041）', ses.code === 200 && sesJson.ok === false && Array.isArray(sesJson.unbound) && !!sesJson.sessionError, 'source=' + sesJson.source)
const pinfo = await call('/plugins/workbench-core/plugin-info')
check('/plugin-info 返回版本', pinfo.code === 200 && !!JSON.parse(pinfo.body).plugin.version)
const oi = await call('/plugins/workbench-core/ops/info')
check('/ops/info 200', oi.code === 200 && !!JSON.parse(oi.body).dataRoot)
const osc = await call('/plugins/workbench-core/ops/selfcheck', 'POST', {})
check('/ops/selfcheck 纯插件逐项（≥8）', osc.code === 200 && JSON.parse(osc.body).items.length >= 8 && JSON.parse(osc.body).items.every(function (x) { return ['ok', 'warn', 'fail'].indexOf(x.status) >= 0 }))
const oc = await call('/plugins/workbench-core/ops/config')
check('/ops/config 读预算默认', oc.code === 200 && JSON.parse(oc.body).budget.wakePerScenePerDay === 3)
const ob = await call('/plugins/workbench-core/ops/budget', 'POST', { enforceWake: false, wakePerScenePerDay: 5 })
const cfg1 = JSON.parse(fs.readFileSync(path.join(DSH, '_meta', 'config.json'), 'utf8'))
check('/ops/budget 写 config（enforceWake 不再落盘）', ob.code === 200 && cfg1.budget.wakePerScenePerDay === 5 && cfg1.budget.enforceWake === undefined)
const ot = await call('/plugins/workbench-core/ops/token', 'POST', { enabled: false, warnContextTokens: 45000, contextThresholdTokens: 90000 })
const cfg2 = JSON.parse(fs.readFileSync(path.join(DSH, '_meta', 'config.json'), 'utf8'))
check('/ops/token 写 handover', ot.code === 200 && cfg2.handover.warnContextTokens === 45000 && cfg2.handover.enabled === false)
const tr1 = await call('/plugins/workbench-core/ops/trash')
check('/ops/trash 计数', tr1.code === 200 && JSON.parse(tr1.body).count >= 1)
const bk1res = await call('/plugins/workbench-core/ops/backups')
check('/ops/backups 列表', bk1res.code === 200 && JSON.parse(bk1res.body).entries.length === 2)
const bdel = await call('/plugins/workbench-core/ops/backups/delete', 'POST', { names: ['bk1', 'bk2.zip'], confirm: true })
check('/ops/backups/delete 进回收站', bdel.code === 200 && JSON.parse(bdel.body).moved.length === 2)
const ev1 = await call('/plugins/workbench-core/ops/events')
check('/ops/events 行数', ev1.code === 200 && JSON.parse(ev1.body).lines === 8)
const etrim = await call('/plugins/workbench-core/ops/events/trim', 'POST', { keep: 3, confirm: true })
check('/ops/events/trim 保留最近 N 行', etrim.code === 200 && JSON.parse(etrim.body).removed === 5)
const tp1 = await call('/plugins/workbench-core/ops/temp')
check('/ops/temp 计数', tp1.code === 200 && JSON.parse(tp1.body).count >= 1)
const tclean = await call('/plugins/workbench-core/ops/temp/clean', 'POST', { confirm: true, names: ['tmpfile.txt'] })
check('/ops/temp/clean 进回收站', tclean.code === 200 && JSON.parse(tclean.body).moved.length === 1)
const trBad = await call('/plugins/workbench-core/ops/trash/clear', 'POST', { confirm: 'x' })
check('/ops/trash/clear 无确认拒绝', trBad.code === 400)
const trClear = await call('/plugins/workbench-core/ops/trash/clear', 'POST', { confirm: '清空' })
check('/ops/trash/clear 输入确认后清空', trClear.code === 200 && JSON.parse(trClear.body).removed >= 1)
const skList = await call('/plugins/workbench-core/skills')
check('/skills 200 + demo', skList.code === 200 && JSON.parse(skList.body).skills.some((x) => x.id === 'demo'))
const skOne = await call('/plugins/workbench-core/skill?id=demo')
check('/skill GET 读技能', skOne.code === 200 && JSON.parse(skOne.body).text.includes('demo skill'))
const skNew = await call('/plugins/workbench-core/skill', 'POST', { id: 'newskill', create: true })
check('/skill create 生成模板', skNew.code === 200 && fs.existsSync(path.join(DSH, 'skills', 'newskill', 'SKILL.md')))
const skDup = await call('/plugins/workbench-core/skill', 'POST', { id: 'newskill', create: true })
check('/skill create 已存在拒绝', skDup.code === 400)
const skSave = await call('/plugins/workbench-core/skill', 'POST', { id: 'newskill', text: '# newskill\n\n改后\n' })
check('/skill 保存可回读', skSave.code === 200 && fs.readFileSync(path.join(DSH, 'skills', 'newskill', 'SKILL.md'), 'utf8').includes('改后'))
const skBig = await call('/plugins/workbench-core/skill', 'POST', { id: 'newskill', text: 'x'.repeat(17 * 1024) })
check('/skill >16KB 拒绝', skBig.code === 400)
const skScene = await call('/plugins/workbench-core/scene', 'POST', { id: 'skillsonly', name: '多选测试', sessionId: 'S-SK', skills: ['demo', 'demo2'] })
check('/scene skills[] 写 card', skScene.code === 200 && JSON.parse(fs.readFileSync(path.join(DSH, 'agents', 'skillsonly', 'card.json'), 'utf8')).skills.length === 2)
const gpSave = await call('/plugins/workbench-core/groups', 'POST', { groups: [{ id: 'core', name: '核心', members: ['demo'] }] })
check('/groups POST 保存', gpSave.code === 200 && JSON.parse(gpSave.body).groups.length === 1)
const rbIndex = await call('/plugins/workbench-core/rebuild-index', 'POST', {})
check('/rebuild-index 路由存在', rbIndex.code === 200 || rbIndex.code === 500)
const openBad = await call('/plugins/workbench-core/open', 'POST', { target: 'nope' })
check('/open 非法 target 拒绝', openBad.code === 400)
const boardHtml = await call('/plugins/workbench-core/board')
check('/board 返回 HTML', boardHtml.code === 200 && boardHtml.body.includes('看板'))
const ntBad = await call('/plugins/workbench-core/notice', 'POST', { minutes: 9999 })
check('/notice 非法 minutes 拒绝', ntBad.code === 400)

const bad = await call('/plugins/workbench-core/nope')
check('未知路径 404', bad.code === 404)

const failed = results.filter((x) => !x.ok)
console.log('\n' + (failed.length ? '✗ ' + failed.length + ' 条失败 / ' : '✓ 全部通过 / ') + results.length + ' 条')
try { fs.rmSync(SB, { recursive: true, force: true }) } catch (e) { /* ignore */ }
process.exit(failed.length ? 1 : 0)

function check0(name, cond, extra) { if (!cond) { console.error('✗ 启动检查失败：' + name + ' ' + (extra || '')); process.exit(1) } }
