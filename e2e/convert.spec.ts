import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// Phase 1 "done when": drop a video, get an MP3, in 3 taps on phone and desktop.

const fixture = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname
type W = Record<string, unknown>

async function stubExport(page: Page, isMobile: boolean) {
  await page.addInitScript((mobile) => {
    if (mobile) {
      // Capture what would go to the iOS/Android share sheet.
      navigator.canShare = () => true
      navigator.share = async (data?: ShareData) => {
        const f = data!.files![0]
        ;(window as unknown as W).__shared = {
          name: f.name,
          type: f.type,
          bytes: Array.from(new Uint8Array(await f.arrayBuffer())),
        }
      }
    } else {
      // Force the download fallback so Playwright can catch the file.
      delete (window as unknown as W).showSaveFilePicker
    }
  }, isMobile)
}

async function chooseFile(page: Page, name: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop anything/i }).click() // tap 1
  await (await chooser).setFiles(fixture(name))
}

test('video becomes an MP3 in 3 taps', async ({ page, isMobile }, info) => {
  await stubExport(page, isMobile)
  await page.goto('/')

  await chooseFile(page, 'sample.mp4')
  await page.getByRole('button', { name: /^Audio only/ }).click() // tap 2
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeVisible({ timeout: 90_000 })

  let bytes: Buffer
  if (isMobile) {
    await save.click() // tap 3
    const shared = (await (await page.waitForFunction(() => (window as unknown as W).__shared)).jsonValue()) as {
      name: string
      type: string
      bytes: number[]
    }
    expect(shared.name).toBe('sample.mp3')
    expect(shared.type).toBe('audio/mpeg')
    bytes = Buffer.from(shared.bytes)
  } else {
    const download = page.waitForEvent('download')
    await save.click() // tap 3
    const d = await download
    expect(d.suggestedFilename()).toBe('sample.mp3')
    bytes = readFileSync(await d.path())
  }

  const out = info.outputPath('out.mp3')
  writeFileSync(out, bytes)
  const probe = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', out]).toString(),
  )
  expect(probe.streams[0].codec_name).toBe('mp3')
  expect(Number(probe.format.duration)).toBeGreaterThan(1.5)
})

test('a video with no sound gets a helpful error', async ({ page }) => {
  await page.goto('/')
  await chooseFile(page, 'silent.mp4')
  await page.getByRole('button', { name: /^Audio only/ }).click()
  await expect(page.getByText('That file has no sound.')).toBeVisible({ timeout: 90_000 })
  await expect(page.getByRole('button', { name: 'Choose another file' })).toBeVisible()
})

test('cancel returns to the file without breaking the next run', async ({ page }, info) => {
  // 60 min of audio, made on the fly, so the job is still running when we cancel.
  const long = info.outputPath('long.m4a')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3600', '-ac', '1', '-c:a', 'aac', '-b:a', '8k', '-y', long])
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop anything/i }).click()
  await (await chooser).setFiles(long)
  await page.getByRole('button', { name: /^Audio only/ }).click()
  await expect(page.getByText(/s left|min left/)).toBeVisible({ timeout: 60_000 }) // real progress, not warm-up
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('long.m4a')).toBeVisible()
  // The engine restarts cleanly after cancel: a fresh short file still converts.
  await page.getByRole('button', { name: 'Remove file' }).click()
  await chooseFile(page, 'sample.mp4')
  await page.getByRole('button', { name: /^Audio only/ }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible({ timeout: 90_000 })
})

test('a broken save dialog falls back to a download', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop save path only')
  // Safari 26 exposed a save dialog that then failed to write ("Couldn't save the file").
  await page.addInitScript(() => {
    ;(window as unknown as W).showSaveFilePicker = async () => ({
      createWritable: async () => {
        throw new TypeError('createWritable unsupported')
      },
    })
  })
  await page.goto('/')
  await chooseFile(page, 'sample.mp4')
  await page.getByRole('button', { name: /^Audio only/ }).click()
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeVisible({ timeout: 90_000 })
  const download = page.waitForEvent('download')
  await save.click()
  expect((await download).suggestedFilename()).toBe('sample.mp3')
  await expect(page.getByText('✓ Saved')).toBeVisible()
})
