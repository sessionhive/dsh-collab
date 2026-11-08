#!/usr/bin/env node
/**
 * auto-index.mjs —— 自动索引沙箱测试（dh031）
 *   假工作台 + 假 gen 脚本（写 marker 计数），验证：
 *   启动跑一次 / 改 scenarios json 自动重跑（防抖~1s）/ 新增/删除场景跟上 / 忽略临时与非 json /
 *   失败写日志+事件且不打断、恢复后继续 / 并发合并。
 * 用法：node tests\auto-index.mjs  （临时目录，结束删除；报告写 工作区\证据\dh031-autoindex\）
 */
import fs from 'node:fs'
import path from 'node:path'

const REAL = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', '..')
const SB = path.join(REAL, '工作区', '_临时', 'wb-autoindex-test-' + process.pid)
const DSH = path.join(SB, '引擎数据', '.dsh')
const SCEN = path.join(SB, '外壳', 'scenarios')
const GEN = path.join(SB, '工具', 'gen')
const MARK = path.join(SB, 'marker.log')
const FLAG = path.join(SB, 'fail.flag')

const mk = (p) => fs.mkdirSync(p, { recursive: true })
const w = (p, t) => { mk(path.dirname(p)); fs.writeFileSync(p, t, 'utf8') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

fs.rmSync(SB, { recursive: true, force: true })
mk(SCEN); mk(GEN); mk(path.join(DSH, '_meta')); mk(path.join(DSH, 'events')); mk(path.join(DSH, 'storages'))
w(path.join(DSH, '_meta', 'registry.json'), JSON.stringify({ scenes: [], groups: [] }, null, 2))
w(path.join(SCEN, 'demo.json'), JSON.stringify({ id: 'demo', name: '演示' }, null, 2))
// 假生成器：每次跑向 marker 追加一行；fail.flag 存在时 gen-index 失败
w(path.join(GEN, 'sync-registry.mjs'), `import fs from 'node:fs'\nfs.appendFileSync(${JSON.stringify(MARK)}, 'sync\\n')\n`)
w(path.join(GEN, 'gen-index.mjs'), `import fs from 'node:fs'\nif (fs.existsSync(${JSON.stringify(FLAG)})) { console.error('fake gen fail'); process.exit(1) }\nfs.appendFileSync(${JSON.stringify(MARK)}, 'gen\\n')\n`)

process.env.DSH_WORKBENCH_ROOT = SB
process.env.DSH_SHELL_DIR = path.join(SB, '外壳')
process.env.DSH_CUSTOMER_HOME = ''
process.env.DSH_HOME = ''

const results = []
const check = (name, ok, extra) => { results.push({ name, ok: !!ok, extra: String(extra || '').slice(0, 240) }); console.log((ok ? '✓ ' : '✗ ') + name + (extra ? '  · ' + String(extra).slice(0, 160) : '')) }
const count = () => { try { return fs.readFileSync(MARK, 'utf8').split(/\r?\n/).filter(Boolean).length } catch (e) { return 0 } }
const reset = () => { try { fs.rmSync(MARK, { force: true }) } catch (e) { /* ignore */ } }

const AI = await import('../lib/auto-index.js')
const { autoIndexStatus } = AI

try {
  // 1) 启动跑一次
  AI.startAutoIndex()
  await sleep(2200)
  check('启动跑一次（sync+gen）', count() >= 2, 'lines=' + count())
  check('watcher 已监听', autoIndexStatus().watching === true)

  // 2) 改 scenarios json → 自动重跑
  reset(); await sleep(200)
  w(path.join(SCEN, 'demo.json'), JSON.stringify({ id: 'demo', name: '演示改' }, null, 2))
  await sleep(2600)
  check('改 scenarios json → 防抖后自动重跑', count() >= 2, 'lines=' + count())

  // 3) 新增场景 → 跟上
  reset(); await sleep(200)
  w(path.join(SCEN, 'newbie.json'), JSON.stringify({ id: 'newbie', name: '新场景' }, null, 2))
  await sleep(2600)
  check('新增场景 → 自动重跑', count() >= 2, 'lines=' + count())

  // 4) 删除场景 → 跟上
  reset(); await sleep(200)
  fs.rmSync(path.join(SCEN, 'newbie.json'), { force: true })
  await sleep(2600)
  check('删除场景 → 自动重跑', count() >= 2, 'lines=' + count())

  // 5) 忽略临时文件/非 json
  reset(); await sleep(200)
  w(path.join(SCEN, 'foo.tmp.json'), '{}')
  w(path.join(SCEN, 'notes.txt'), 'x')
  w(path.join(SCEN, '_trash.json'), '{}')
  await sleep(1900)
  check('忽略临时/非 json/_ 前缀', count() === 0, 'lines=' + count())
  fs.rmSync(path.join(SCEN, 'foo.tmp.json'), { force: true })
  fs.rmSync(path.join(SCEN, 'notes.txt'), { force: true })
  fs.rmSync(path.join(SCEN, '_trash.json'), { force: true })

  // 6) 失败：写日志+事件、不打断；恢复后继续
  reset(); w(FLAG, '1'); await sleep(200)
  w(path.join(SCEN, 'demo.json'), JSON.stringify({ id: 'demo', name: '演示失败态' }, null, 2))
  await sleep(2600)
  const logTxt = (() => { try { return fs.readFileSync(path.join(DSH, 'events', 'auto-index.log'), 'utf8') } catch (e) { return '' } })()
  const evTxt = (() => { try { return fs.readFileSync(path.join(DSH, 'events', 'events.jsonl'), 'utf8') } catch (e) { return '' } })()
  check('失败写 auto-index.log', /FAIL/.test(logTxt), logTxt.split(/\r?\n/).filter(Boolean).slice(-1)[0])
  check('失败写 events.jsonl（type=index,status=error）', /"type":"index"/.test(evTxt) && /"status":"error"/.test(evTxt))
  fs.rmSync(FLAG, { force: true }); reset(); await sleep(200)
  w(path.join(SCEN, 'demo.json'), JSON.stringify({ id: 'demo', name: '演示恢复' }, null, 2))
  await sleep(2600)
  check('失败后不打断、恢复后继续', count() >= 2, 'lines=' + count())

  // 7) 并发合并（第二次立即返回 merged）
  reset(); await sleep(200)
  const p1 = AI.runAutoIndex('concurrent-1')
  const p2 = await AI.runAutoIndex('concurrent-2')
  await p1; await sleep(600)
  check('并发时合并/串行（第二次 merged=true）', p2 && p2.merged === true, JSON.stringify(p2))
} finally {
  AI.stopAutoIndex()
  const bad = results.filter((x) => !x.ok)
  const report = { ok: bad.length === 0, total: results.length, failed: bad.length, results, at: new Date().toISOString() }
  const evDir = path.join(REAL, '工作区', '证据', 'dh031-autoindex')
  try { mk(evDir); fs.writeFileSync(path.join(evDir, 'auto-index-report.json'), JSON.stringify(report, null, 2), 'utf8') } catch (e) { /* ignore */ }
  console.log('\n' + (bad.length ? '✗ ' + bad.length + ' 条失败 / ' : '✓ 全部通过 / ') + results.length + ' 条')
  try { fs.rmSync(SB, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  process.exit(bad.length ? 1 : 0)
}
