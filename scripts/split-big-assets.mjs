// After a build with BIG_ASSET_BASE set: moves dist/assets/*.wasm to dist-big/assets/ (upload that folder
// to the big-asset host, e.g. a Cloudflare R2 bucket) and tells the service worker where they live.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const base = process.env.BIG_ASSET_BASE?.replace(/\/$/, '')
rmSync('dist-big', { recursive: true, force: true }) // never leave a stale copy from an earlier build
if (!base) process.exit(0)
mkdirSync('dist-big/assets', { recursive: true })
const moved = readdirSync('dist/assets').filter((f) => f.endsWith('.wasm'))
for (const f of moved) renameSync(`dist/assets/${f}`, `dist-big/assets/${f}`)
const js = readdirSync('dist/assets').filter((f) => f.endsWith('.js') || f.endsWith('.mjs')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n')
for (const f of moved) if (!js.includes(`${base}/assets/${f}`)) throw new Error(`split-big-assets: no reference to ${base}/assets/${f}; was the build run with BIG_ASSET_BASE?`)
if (!existsSync('dist/sw.js')) throw new Error('split-big-assets: dist/sw.js missing')
const sw = readFileSync('dist/sw.js', 'utf8')
if (!sw.includes("const BIG = ''")) throw new Error('split-big-assets: BIG placeholder missing in sw.js')
writeFileSync('dist/sw.js', sw.replace("const BIG = ''", `const BIG = ${JSON.stringify(base)}`))
console.log(`✓ Moved ${moved.length} .wasm files to dist-big/assets/ (load from ${base})`)
