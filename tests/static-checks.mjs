#!/usr/bin/env node
/**
 * static-checks.mjs —— 源码级验收（dh041）：
 *   - 版本 0.2.2
 *   - sessions.js 列表优先 host sessionController、不依赖 server.log
 *   - client.js 区域②有「手填 sessionId」输入
 *   - read.js check 有 degradedReason（外部无工具层说明）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectedVersion } from './_version.mjs'

const V = expectedVersion()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const res = []
const check = (name, ok, extra) => { res.push({ name, ok: !!ok, extra: String(extra || '').slice(0, 200) }); console.log((ok ? '✓ ' : '✗ ') + name + (extra ? '  · ' + String(extra).slice(0, 160) : '')) }

const pkg = JSON.parse(read('package.json'))
check('版本 = ' + V, pkg.version === V, pkg.version)

const ses = read('lib/sessions.js')
check('sessions 列表优先 host sessionController', /get\('sessionController'\)/.test(ses) && /sessionController\.list/.test(ses))
const listFn = ses.slice(ses.indexOf('export async function listSessions'), ses.indexOf('function workspaceIdFor'))
check('listSessions 主体不读 server.log/token', !/server\.log|token/.test(listFn))
check('无 host 时返回明确原因（含手填提示）', /sessionController|手填 sessionId/.test(ses))

const cli = read('client/client.js')
check('区域②有「手填 sessionId」输入', cli.indexOf('直接粘贴 sessionId') >= 0)
check('client 处理 sessionError', cli.indexOf('sessionError') >= 0)

const rd = read('lib/tools/read.js')
check('wb_read(check) 有 degradedReason', /degradedReason/.test(rd) && /外部环境无工具层/.test(rd))

// dh045：区域①只展示全局规则预览，不输出内置基础规则正文
check('区域①不显示内置基础规则正文（无「核心宪法」字样）', !/核心宪法/.test(cli) && cli.indexOf('内置规则：') < 0)
const injSrc = read('lib/agents-inject.js')
const pvFn = injSrc.slice(injSrc.indexOf('export function injectPreview'))
check('注入预览接口不返回内置规则正文（无 current/section/coreText）', pvFn.length > 0 && !/\bcurrent\b/.test(pvFn) && !/\bsection\b/.test(pvFn) && !/coreText\(\)/.test(pvFn) && /globalRules/.test(pvFn) && /coreCount/.test(pvFn))

// dh047：区域①移除预览块/宪法字样，且前端不再请求 /inject/preview；路由保留为调试接口
check('区域①无「全局规则预览」块', cli.indexOf('全局规则预览') < 0 && cli.indexOf('injectData') < 0)
check('UI 无「宪法」字样且不请求 /inject/preview', !/宪法/.test(cli) && cli.indexOf('/inject/preview') < 0 && cli.indexOf('injectData') < 0)
check('区域①已删提示/路径行（v0.1.0）', cli.indexOf('文件：shared\\\\env\\\\global-rules.md') < 0 && cli.indexOf('底层基础规则由插件内置维护，不可修改，不在此展示') < 0 && cli.indexOf('全局规范') >= 0)
const rtSrc = read('lib/runtime.js')
check('路由表：/inject/preview 仍注册（调试接口，UI 不调用）', rtSrc.indexOf("'/inject/preview'") >= 0 && rtSrc.indexOf('injectPreview') >= 0)

const idx = read('lib/index.js')
check('入口支持 config.dataRoot 并懒加载 runtime', /config\.dataRoot/.test(idx) && /runtime\.js/.test(idx))
const paths = read('lib/paths.js')
check('paths 优先级 config.dataRoot → env → 引擎数据', /__wbConfigDataRoot/.test(paths) && /DSH_HOME/.test(paths))

const bad = res.filter((x) => !x.ok)
const evDir = path.resolve(ROOT, '..', '..', '工作区', '证据', 'dh041-external')
try { fs.mkdirSync(evDir, { recursive: true }) } catch (e) { /* ignore */ }
try { fs.writeFileSync(path.join(evDir, 'static-checks.json'), JSON.stringify({ ok: bad.length === 0, total: res.length, results: res }, null, 2), 'utf8') } catch (e) { /* ignore */ }
console.log('\n' + (bad.length ? '✗ ' + bad.length + ' 条失败 / ' : '✓ 全部通过 / ') + res.length + ' 条')
process.exit(bad.length ? 1 : 0)
