import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const frontendDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = process.argv[2] ? resolve(process.argv[2]) : resolve(frontendDir, 'dist')
const manifest = JSON.parse(readFileSync(resolve(distDir, '.vite/manifest.json'), 'utf8'))
const entry = Object.keys(manifest).find((key) => manifest[key].isEntry)
if (!entry) throw new Error('构建清单缺少入口文件')

// 统计入口和路由的全部静态依赖；不能通过把大包切成多个小文件绕过预算。
function measure(keys) {
  const visited = new Set()
  const files = new Set()
  const collect = (key) => {
    if (visited.has(key)) return
    visited.add(key)
    const chunk = manifest[key]
    if (!chunk) throw new Error(`构建清单缺少模块：${key}`)
    if (chunk.file.endsWith('.js')) files.add(chunk.file)
    for (const dependency of chunk.imports ?? []) collect(dependency)
  }
  keys.forEach(collect)
  let bytes = 0
  let gzipBytes = 0
  for (const file of files) {
    const source = readFileSync(resolve(distDir, file))
    bytes += source.length
    gzipBytes += gzipSync(source).length
  }
  return { bytes, gzipBytes, files: files.size }
}

const budgets = [
  { name: '应用入口', keys: [entry], limit: 100 * 1024 },
  { name: 'ToC 官网（含入口）', keys: [entry, 'src/pages/HomepagePage.tsx'], limit: 200 * 1024 },
  { name: 'ToB 官网（含入口）', keys: [entry, 'src/pages/TobHomepagePage.tsx'], limit: 200 * 1024 },
]
for (const budget of budgets) {
  try {
    const result = measure(budget.keys)
    console.log(`${budget.name}：JS ${(result.bytes / 1024).toFixed(1)} KiB，gzip ${(result.gzipBytes / 1024).toFixed(1)} / ${budget.limit / 1024} KiB，${result.files} 个分包`)
    if (result.gzipBytes > budget.limit) {
      console.error(`${budget.name}超出加载体积预算，请检查静态导入。`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`${budget.name}检查失败：${error.message}`)
    process.exitCode = 1
  }
}
