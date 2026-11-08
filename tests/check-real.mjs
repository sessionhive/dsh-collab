#!/usr/bin/env node
/** 真机只读检查：wb_read(check) 三项摘要（不写任何数据） */
import { wbRead } from '../lib/tools/read.js'

const r = await wbRead({ action: 'check' })
console.log(JSON.stringify(r, null, 2))
process.exit(r.ok ? 0 : 1)
