import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'

// Phase 2: every preset makes a real file, and batches work.
// Desktop only: the save path is a plain download there, which Playwright can catch.
test.skip(({ isMobile }) => isMobile, 'desktop download path')
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showSaveFilePicker)
})

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname
const probe = (file: string) =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height:format=duration,format_name', '-of', 'json', file]).toString())

async function choose(page: Page, files: string[]) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop anything/i }).click()
  await (await chooser).setFiles(files)
}

async function download(page: Page, button: RegExp | string) {
  const d = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: typeof button === 'string' }).click()
  const got = await d
  return { name: got.suggestedFilename(), path: (await got.path())! }
}

async function runPreset(page: Page, title: RegExp, file = fixture('sample.mp4')) {
  await page.goto('/')
  await choose(page, [file])
  await page.getByRole('button', { name: title }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 90_000 })
  return download(page, 'Save')
}

const cases: [RegExp, string, (p: ReturnType<typeof probe>) => void][] = [
  [/^Studio quality/, 'sample.flac', (p) => expect(p.streams[0].codec_name).toBe('flac')],
  [/^Make a GIF/, 'sample.gif', (p) => expect(p.streams[0].codec_name).toBe('gif')],
  [/^Phone-friendly video/, 'sample.mp4', (p) => expect(p.streams.map((s: { codec_name: string }) => s.codec_name)).toEqual(['h264', 'aac'])],
  [/^TikTok/, 'sample-vertical.mp4', (p) => expect([p.streams[0].width, p.streams[0].height]).toEqual([720, 1280])],
]
for (const [title, name, check] of cases) {
  test(`preset ${title.source.replace(/[\^]/g, '')} makes a valid file`, async ({ page }) => {
    const out = await runPreset(page, title)
    expect(out.name).toBe(name)
    check(probe(out.path))
  })
}

test('ringtone: M4R on Apple devices, MP3 elsewhere', async ({ page }) => {
  const out = await runPreset(page, /^Ringtone/)
  const iphone = out.name.endsWith('.m4r')
  expect(out.name).toBe(iphone ? 'sample-ringtone.m4r' : 'sample-ringtone.mp3')
  expect(probe(out.path).streams[0].codec_name).toBe(iphone ? 'aac' : 'mp3')
})

test('extract frames gives a zip of JPGs', async ({ page }) => {
  const out = await runPreset(page, /^Extract frames/)
  expect(out.name).toBe('sample-frames.zip')
  const files = Object.keys(unzipSync(readFileSync(out.path)))
  expect(files.length).toBeGreaterThanOrEqual(2)
  expect(files.every((f) => f.endsWith('.jpg'))).toBe(true)
})

test('shrink asks for a size, then lands under it', async ({ page }) => {
  await page.goto('/')
  await choose(page, [fixture('sample.mp4')])
  await page.getByRole('button', { name: /^Shrink to a size/ }).click()
  await page.getByRole('button', { name: '8 MB' }).click()
  await page.getByRole('button', { name: 'Convert', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 90_000 })
  const out = await download(page, 'Save')
  expect(out.name).toBe('sample-small.mp4')
  expect(readFileSync(out.path).length).toBeLessThan(8e6)
})

test('options sheet changes the output format', async ({ page }) => {
  await page.goto('/')
  await choose(page, [fixture('sample.mp4')])
  await page.getByRole('button', { name: 'Options' }).first().click() // Audio only
  await page.getByRole('button', { name: 'OPUS' }).click()
  await page.getByRole('button', { name: 'Convert', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 90_000 })
  const out = await download(page, 'Save')
  expect(out.name).toBe('sample.opus')
  expect(probe(out.path).streams[0].codec_name).toBe('opus')
})

test('an image converts to JPG', async ({ page }, info) => {
  const png = info.outputPath('pic.png')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', '-y', png])
  const out = await runPreset(page, /^Convert image/, png)
  expect(out.name).toBe('pic.jpg')
  expect(probe(out.path).streams[0].codec_name).toBe('mjpeg')
})

test('a batch of mixed files converts and saves as one zip', async ({ page }, info) => {
  const files = ['a', 'b', 'c'].map((n) => {
    const p = info.outputPath(`${n}.mp4`)
    copyFileSync(fixture('sample.mp4'), p)
    return p
  })
  const png = info.outputPath('pic.png')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240', '-frames:v', '1', '-y', png])
  await page.goto('/')
  await choose(page, [...files, png])
  await expect(page.getByRole('heading', { name: '4 files' })).toBeVisible()
  await page.getByRole('button', { name: /^Audio only/ }).click()
  await expect(page.getByRole('button', { name: 'Pick a preset for 1 more' })).toBeDisabled()
  await page.getByRole('button', { name: /^Convert image/ }).click()
  await page.getByRole('button', { name: 'Convert 4 files' }).click()
  await expect(page.getByRole('heading', { name: '4 done' })).toBeVisible({ timeout: 120_000 })
  const out = await download(page, 'Save all 4')
  expect(Object.keys(unzipSync(readFileSync(out.path))).sort()).toEqual(['a.mp3', 'b.mp3', 'c.mp3', 'pic.jpg'])
})

test('converted files stay in the library after a reload', async ({ page }) => {
  await runPreset(page, /^Audio only/)
  await page.getByRole('tab', { name: 'Library' }).first().click()
  await expect(page.getByRole('button', { name: /sample\.mp3/ })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Recent files' }).getByText('sample.mp3')).toBeVisible()
  await page.getByRole('tab', { name: 'Library' }).first().click()
  await page.getByRole('button', { name: /sample\.mp3/ }).click()
  await expect(page.getByRole('dialog', { name: 'sample.mp3' })).toBeVisible()
})

test('smart drop offers what you picked last time', async ({ page }) => {
  await runPreset(page, /^Studio quality/)
  await page.getByRole('button', { name: 'Convert another' }).click()
  await choose(page, [fixture('sample.mp4')])
  const smart = page.getByRole('button', { name: /Smart Drop.*studio quality/i })
  await expect(smart).toBeVisible()
  await smart.click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 90_000 })
  expect((await download(page, 'Save')).name).toBe('sample.flac')
})
