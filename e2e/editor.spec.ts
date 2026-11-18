import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

// Phase 3 "done when": slowed + reverb in 1 tap; undo always works.
test.skip(({ isMobile }) => isMobile, 'desktop download path; touch drag differs')
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showSaveFilePicker)
})

const durOf = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())

async function openInEditor(page: Page, file: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Editor' }).first().click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByText('Choose a file').click()
  await (await chooser).setFiles(file)
  await expect(page.getByRole('slider', { name: /Waveform/ })).toBeVisible({ timeout: 30_000 })
}
const total = (page: Page) => page.getByText(/^\d:\d\d\.\d \/ /)
const expectTotal = (page: Page, re: RegExp) => expect(total(page)).toHaveText(re, { timeout: 15_000 })

function tone(path: string, hz: number) {
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=10`, '-ac', '2', '-y', path])
  return path
}

test('slowed + reverb in one tap, exported', async ({ page }, info) => {
  await openInEditor(page, tone(info.outputPath('song.wav'), 440))
  await expectTotal(page, / \/ 0:10\.0$/)
  await page.getByRole('button', { name: 'Slowed + reverb' }).click() // the one tap
  await expectTotal(page, / \/ 0:11\.[78]$/) // 10 s / 0.85
  const d = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export MP3/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const out = await d
  expect(out.suggestedFilename()).toBe('song.mp3')
  expect(durOf((await out.path())!)).toBeCloseTo(11.76, 0)
})

test('undo and redo walk back through every edit', async ({ page }, info) => {
  await openInEditor(page, tone(info.outputPath('song.wav'), 330))
  await expectTotal(page, / \/ 0:10\.0$/)

  // 1. Cut the middle by dragging across the waveform.
  const box = (await page.getByRole('slider', { name: /Waveform/ }).boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.getByRole('button', { name: 'Cut selection' }).click()
  await expectTotal(page, / \/ 0:0[67]\.\d$/)
  // 2. and 3.: two effects.
  await page.getByRole('button', { name: 'Sped up' }).click()
  await page.getByRole('button', { name: 'Nightcore' }).click()
  await expectTotal(page, / \/ 0:0[45]\.\d$/)
  const finalTotal = (await total(page).textContent())!.split(' / ')[1]

  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expectTotal(page, / \/ 0:0[67]\.\d$/) // back to just the cut
  await page.keyboard.press('ControlOrMeta+z')
  await expectTotal(page, / \/ 0:10\.0$/) // back to the original
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()

  for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+Shift+z')
  await expectTotal(page, new RegExp(` / ${finalTotal.replace('.', '\\.')}$`))
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled()
})

test('converted file opens in the editor from the done screen', async ({ page }) => {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop anything/i }).click()
  await (await chooser).setFiles(new URL('./fixtures/sample.mp4', import.meta.url).pathname)
  await page.getByRole('button', { name: /^Audio only/ }).click()
  await page.getByRole('button', { name: 'Edit audio' }).click({ timeout: 90_000 })
  await expect(page.getByRole('slider', { name: /Waveform/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('main:not([hidden])').getByText('sample.mp3', { exact: true })).toBeVisible()
})

test('finds the BPM of a 120 BPM click track', async ({ page }, info) => {
  const clicks = info.outputPath('clicks.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.03),sin(2*PI*1200*t),0)':s=44100:d=20", '-ac', '2', '-y', clicks])
  await openInEditor(page, clicks)
  await page.getByRole('tab', { name: 'tools' }).click()
  await page.getByRole('button', { name: 'Find BPM & key' }).click()
  await expect(page.getByText(/BPM 120(?!\d)/)).toBeVisible({ timeout: 30_000 })
})

test('pitch-locked speed, silence removal and tags reach the exported file', async ({ page }, info) => {
  // 4 s tone, 3 s silence, 4 s tone.
  const gap = info.outputPath('gap.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', "aevalsrc='if(between(t,4,7),0,0.5*sin(2*PI*440*t))':s=44100:d=11", '-ac', '2', '-y', gap])
  await openInEditor(page, gap)
  await page.getByRole('tab', { name: 'tools' }).click()
  await page.getByRole('button', { name: 'Remove silences' }).click()
  await expectTotal(page, / \/ 0:08\.[2-4]$/) // 11 s minus ~2.7 s of silence
  await page.getByRole('tab', { name: 'adjust' }).click()
  const speed = page.getByRole('slider', { name: /Speed/ })
  await speed.focus()
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight') // 1.0 -> 1.5, pitch kept
  await expectTotal(page, / \/ 0:05\.[4-6]$/)
  await page.getByRole('tab', { name: 'info' }).click()
  await page.getByLabel('title').fill('My Edit')
  const d = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export MP3/ }).click({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const out = await d
  expect(out.suggestedFilename()).toBe('My Edit.mp3')
  const p = (await out.path())!
  expect(durOf(p)).toBeCloseTo(5.5, 0)
  const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', p]).toString())
  expect(tags.format.tags.title).toBe('My Edit')
})
