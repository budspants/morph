import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { captionPixels, exportAndProbe, openVideo, probe, speechClip } from './helpers'

// Runs on every project (desktop, phone, Safari, iPhone): the phase's one promise, end to end.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker
    // Phones would open the share sheet; take the download path so the test can read the file.
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true })
  })
})

// Phase 4 "done when": a horizontal clip becomes a captioned vertical video.
test('horizontal clip becomes a captioned 1080x1920 vertical', async ({ page, browserName }, info) => {
  test.skip(!!process.env.OFFLINE, 'downloads the speech model from Hugging Face')
  test.setTimeout(300_000)
  await openVideo(page, speechClip((n) => info.outputPath(n), browserName, 'color=c=0x1f3a93:s=1280x720:r=30:d=6'))
  await page.getByRole('button', { name: '9:16 TikTok' }).click()
  await page.getByRole('combobox').selectOption('en')
  await page.getByRole('button', { name: 'Auto captions' }).click()
  await expect(page.getByRole('list', { name: 'Transcript' })).toBeVisible({ timeout: 240_000 })
  await expect(page.getByRole('button', { name: 'Word highlight' })).toHaveAttribute('aria-pressed', 'true') // the default style

  const out = await exportAndProbe(page)
  expect(probe(out, 'stream=width,height').split('\n')[0]).toBe('1080,1920')
  execFileSync('ffmpeg', ['-v', 'error', '-ss', '2.5', '-i', out, '-frames:v', '1', '-y', info.outputPath('frame.png')]) // for eyeballing
  // Mid-speech, the caption band holds white words and one yellow (highlighted) word.
  const band = captionPixels(out, 2.5, 1080, 1250, 1720)
  expect(band.white).toBeGreaterThan(2000)
  expect(band.yellow).toBeGreaterThan(300)
  // Above the band, nothing but the blue background.
  expect(captionPixels(out, 2.5, 1080, 200, 600).white).toBe(0)

  // Captions off: same export, no text.
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await page.getByLabel('Burn captions into the video').uncheck()
  const plain = await exportAndProbe(page)
  expect(captionPixels(plain, 2.5, 1080, 1250, 1720).white).toBe(0)
})
