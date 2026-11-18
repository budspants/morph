import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { unzipSync } from 'fflate'

// Phase 4 step 9: image tools — resize, compress to a size, batch rename.
test.skip(({ isMobile }) => isMobile, 'desktop download path')
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showSaveFilePicker)
})

const dims = (file: string) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'csv=p=0', file]).toString().trim()

/** A photo-like PNG: noise makes it hard to compress. */
function picture(path: string, size = '640x480') {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size},noise=alls=30:allf=t`, '-frames:v', '1', '-y', path])
  return path
}

async function choose(page: Page, files: string[]) {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop anything/i }).click()
  await (await chooser).setFiles(files)
}
async function options(page: Page, title: string) {
  const id = await page.locator('span[id]', { hasText: new RegExp(`^${title}$`) }).first().getAttribute('id') // the card title, not a dropdown option
  await page.locator(`button[aria-describedby="${id}"]`).click()
}
async function save(page: Page, name: string) {
  const d = page.waitForEvent('download')
  await page.getByRole('button', { name, exact: true }).click({ timeout: 60_000 })
  const got = await d
  return { name: got.suggestedFilename(), path: (await got.path())! }
}

test('compress an image to under 100 KB', async ({ page }, info) => {
  await choose(page, [picture(info.outputPath('photo.png'), '2000x1500')])
  await options(page, 'Compress image')
  await page.getByRole('button', { name: '100 KB' }).click()
  await page.getByRole('button', { name: 'Convert', exact: true }).click()
  const out = await save(page, 'Save')
  expect(out.name).toBe('photo.jpg')
  expect(statSync(out.path).size).toBeLessThanOrEqual(100_000)
  expect(statSync(out.path).size).toBeGreaterThan(50_000) // as good as fits, not crushed
  expect(dims(out.path).startsWith('mjpeg,')).toBe(true)
})

test('resize an image to 50%', async ({ page }, info) => {
  await choose(page, [picture(info.outputPath('shot.png'))])
  await page.getByRole('button', { name: /^Resize image/ }).click()
  const out = await save(page, 'Save')
  expect(dims(out.path)).toBe('mjpeg,320,240')
})

test('batch: crop to square and rename with a pattern, one zip', async ({ page }, info) => {
  const files = ['b', 'a', 'c'].map((n) => picture(info.outputPath(`${n}.png`)))
  await choose(page, files)
  await options(page, 'Resize image')
  await page.getByRole('button', { name: 'Square 1080' }).click()
  await page.getByLabel('Rename pattern').fill('holiday-{n}')
  await page.getByRole('button', { name: 'Convert', exact: true }).click()
  await page.getByRole('button', { name: 'Convert 3 files' }).click()
  await expect(page.getByRole('heading', { name: '3 done' })).toBeVisible({ timeout: 60_000 })
  const out = await save(page, 'Save all 3')
  const zip = unzipSync(readFileSync(out.path))
  expect(Object.keys(zip).sort()).toEqual(['holiday-1.jpg', 'holiday-2.jpg', 'holiday-3.jpg'])
  const first = info.outputPath('first.jpg')
  writeFileSync(first, zip['holiday-1.jpg'])
  expect(dims(first)).toBe('mjpeg,1080,1080')
})

test('remove background: transparent around a person, or a white backdrop', async ({ page }, info) => {
  test.skip(!!process.env.OFFLINE, 'downloads the model and a sample photo from Hugging Face')
  test.setTimeout(240_000)
  const photo = info.outputPath('portrait.jpg')
  const res = await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/portrait-of-woman_small.jpg')
  writeFileSync(photo, Buffer.from(await res.arrayBuffer()))
  /** Mean alpha (0–255) of a w×h box at x,y. */
  const alpha = (file: string, x: number, y: number, w = 20, h = 20) => {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `format=rgba,alphaextract,crop=${w}:${h}:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
    return raw.reduce((a, b) => a + b, 0) / raw.length
  }

  await choose(page, [photo])
  await page.getByRole('button', { name: /^Remove background/ }).click()
  const out = await save(page, 'Save')
  expect(out.name).toBe('portrait.png')
  const [w, h] = dims(out.path).split(',').slice(1).map(Number)
  expect(alpha(out.path, 0, 0)).toBeLessThan(20) // top-left corner: background, gone
  expect(alpha(out.path, w - 20, 0)).toBeLessThan(20)
  expect(alpha(out.path, Math.round(w / 2) - 10, Math.round(h / 2) - 10)).toBeGreaterThan(230) // the person stays

  await page.getByRole('button', { name: 'Convert another' }).click()
  await choose(page, [photo])
  await options(page, 'Remove background')
  await page.getByRole('button', { name: 'White' }).click()
  await page.getByRole('button', { name: 'Convert', exact: true }).click()
  const white = await save(page, 'Save')
  expect(alpha(white.path, 0, 0)).toBe(255) // backdrop filled in
})
