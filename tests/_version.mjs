/**
 * _version.mjs —— 测试期望版本的单一来源：CHANGELOG.md 顶部 "## x.y.z" 为发布版本。
 * 各版本用例不再手改版本号；package.json 与 CHANGELOG 版本不一致会直接失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export function expectedVersion() {
  try {
    const text = fs.readFileSync(path.join(HERE, '..', 'CHANGELOG.md'), 'utf8')
    const m = text.match(/^##\s+(\d+\.\d+\.\d+)\b/m)
    return m ? m[1] : ''
  } catch (e) { return '' }
}
