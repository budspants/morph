import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'

// Phase 2 "done when": 50 files convert in one batch without a crash.
test('50 files convert in one batch without a crash', async ({ page }, info) => {
  test.setTimeout(10 * 60_000)
  // 40 real videos (5 distinct clips, copied) + 10 images.
  const clips = [0, 1, 2, 3, 4].map((n) => {
    const p = info.outputPath(`clip${n}.mp4`)
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${3 + n}`, '-f', 'lavfi', '-i', `sine=frequency=${300 + n * 100}:duration=${3 + n}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-y', p])
    return p
  })
  const files: string[] = []
  for (let i = 0; i < 40; i++) {
    const p = info.outputPath(`video-${String(i + 1).padStart(2, '0')}.mp4`)
    copyFileSync(clips[i % clips.length], p)
    files.push(p)
  }
  for (let i = 0; i < 10; i++) {
    const p = info.outputPath(`photo-${i + 1}.png`)
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=1280x960`, '-frames:v', '1', '-y', p])
    files.push(p)
  }

  let crashed = false
  page.on('crash', () => (crashed = true))
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /drop anything/i }).click()
  await (await chooser).setFiles(files)
  await expect(page.getByRole('heading', { name: '50 files' })).toBeVisible()
  await page.getByRole('button', { name: /^Audio only/ }).click()
  await page.getByRole('button', { name: /^Convert image/ }).click()
  await page.getByRole('button', { name: 'Convert 50 files' }).click()
  await expect(page.getByRole('heading', { name: '50 done' })).toBeVisible({ timeout: 9 * 60_000 })
  expect(crashed).toBe(false)
  await expect(page.getByText('failed')).toHaveCount(0)
})
