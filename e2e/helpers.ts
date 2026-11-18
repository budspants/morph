// Shared helpers for the video editor tests.
import { expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'

export const probe = (file: string, entries: string) =>
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()

export async function openVideo(page: Page, file: string) {
  await page.goto('/')
  await page.getByRole('tab', { name: 'Editor' }).first().click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByText('Choose a file').click()
  await (await chooser).setFiles(file)
  await expect(page.getByRole('slider', { name: 'Timeline' })).toBeVisible({ timeout: 30_000 })
}

export async function exportAndProbe(page: Page) {
  const d = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export MP4/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 90_000 })
  return (await (await d).path())!
}

/** A clip with a real voice (macOS `say`), for Whisper. */
export function speechClip(dir: (n: string) => string, browser: string, video = 'testsrc2=size=640x360:rate=30:duration=6') {
  const aiff = dir('speech.aiff')
  execFileSync('say', ['-v', 'Samantha', '-r', '170', '-o', aiff, 'Hello there. This is a caption test for the video editor.'])
  const webm = browser === 'chromium'
  const path = dir(webm ? 'speech.webm' : 'speech.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', video, '-i', aiff, ...codecs, '-t', '6', '-y', path])
  return path
}

/** Count caption-coloured pixels (white text, yellow highlight) in a band of one frame. */
export function captionPixels(file: string, at: number, w: number, y0: number, y1: number) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', `format=rgb24,crop=${w}:${y1 - y0}:0:${y0}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 })
  let white = 0
  let yellow = 0
  for (let i = 0; i < raw.length; i += 3) {
    const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]]
    if (r > 220 && g > 220 && b > 220) white++
    else if (r > 220 && g > 170 && b < 120) yellow++
  }
  return { white, yellow }
}
