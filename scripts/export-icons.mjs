// Renders the brand SVGs in design/brand/final to PNGs with Playwright's Chromium.
// Run: node scripts/export-icons.mjs   (re-run after changing any SVG there)
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'design/brand/final'
const OUT = join(SRC, 'png')
mkdirSync(OUT, { recursive: true })

// [svg, size, output path]
const jobs = [
  ...[1024, 512, 256, 128].map((s) => ['icon-dark.svg', s, join(OUT, `icon-dark-${s}.png`)]),
  ['icon-light.svg', 1024, join(OUT, 'icon-light-1024.png')],
  ['icon-tinted.svg', 1024, join(OUT, 'icon-tinted-1024.png')],
  ...[512, 64, 32].map((s) => ['morph-mark.svg', s, join(OUT, `mark-${s}.png`)]),
  // Used by the app itself.
  ['icon-dark.svg', 180, 'public/apple-touch-icon.png'],
  ['icon-dark.svg', 192, 'public/icon-192.png'],
  ['icon-dark.svg', 512, 'public/icon-512.png'],
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [svg, size, out] of jobs) {
  const markup = readFileSync(join(SRC, svg), 'utf8').replace('<svg ', `<svg width="${size}" height="${size}" `)
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${markup}`)
  await page.screenshot({ path: out, omitBackground: true })
  console.log(out)
}
await browser.close()
