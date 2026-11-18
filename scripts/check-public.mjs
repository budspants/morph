// Fails the public build if any YouTube/personal code reached dist/.
// `--personal` flips it: asserts the marker IS in dist-personal/, proving the
// detector actually sees the module (so a pass on the public build means something).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const personal = process.argv.includes('--personal')
const dir = personal ? 'dist-personal' : 'dist'
const PATTERN = /youtube|youtu\.be|yt-dlp|ytsearch|MORPH_PERSONAL_MODULE|127\.0\.0\.1:47321/gi

const hits = []
for (const f of readdirSync(dir, { recursive: true, withFileTypes: true })) {
  if (!f.isFile()) continue
  if (f.name.endsWith('.wasm')) continue // third-party binaries (ffmpeg, ONNX, MediaPipe); MediaPipe's names "YOUTUBE" internally
  const path = join(f.parentPath, f.name)
  const text = readFileSync(path, 'latin1')
  for (const m of text.matchAll(PATTERN)) hits.push(`${path}: "${m[0]}"`)
}

if (personal) {
  if (!hits.some((h) => h.includes('MORPH_PERSONAL_MODULE'))) {
    console.error(`✗ ${dir}/ is missing the personal module marker`)
    process.exit(1)
  }
  console.log(`✓ ${dir}/ contains the personal module (${hits.length} references)`)
} else if (hits.length) {
  console.error(`✗ Public build contains ${hits.length} YouTube references:\n  ${hits.slice(0, 20).join('\n  ')}`)
  process.exit(1)
} else {
  console.log(`✓ Public build: 0 YouTube references in ${dir}/`)
}
