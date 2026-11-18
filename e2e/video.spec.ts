import { expect, test, type Page } from '@playwright/test'
import { captionPixels, exportAndProbe, openVideo, probe, speechClip } from './helpers'
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// Phase 4 step 1: open a video, split / delete / trim with undo, export an MP4.
test.skip(({ isMobile }) => isMobile, 'desktop download path; touch drag differs')
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as Record<string, unknown>).showSaveFilePicker)
})

/** 10 s, 640x360, with a tone. Playwright's Chromium has no H.264 decoder, so it gets WebM. */
function clip(dir: (n: string) => string, browser: string) {
  const webm = browser === 'chromium'
  const path = dir(webm ? 'clip.webm' : 'clip.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', ...codecs, '-shortest', '-y', path])
  return path
}

const total = (page: Page) => page.getByText(/^\d:\d\d\.\d \/ /)
const expectTotal = (page: Page, re: RegExp) => expect(total(page)).toHaveText(re, { timeout: 15_000 })

async function clickTimeline(page: Page, ratio: number) {
  const box = (await page.getByRole('slider', { name: 'Timeline' }).boundingBox())!
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
}

test('split, delete a piece, undo/redo, export a shorter MP4', async ({ page, browserName }, info) => {
  await openVideo(page, clip((n) => info.outputPath(n), browserName))
  await expectTotal(page, / \/ 0:10\.0$/)

  await clickTimeline(page, 0.5)
  await page.getByRole('button', { name: 'Split at playhead' }).click()
  await page.getByRole('button', { name: /^Piece 2/ }).click()
  await page.getByRole('button', { name: 'Delete 1 piece' }).click()
  await expectTotal(page, / \/ 0:0[45]\.\d$/)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expectTotal(page, / \/ 0:10\.0$/)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expectTotal(page, / \/ 0:0[45]\.\d$/)

  // Trim the first second off what's left.
  await clickTimeline(page, 0.2)
  await page.getByRole('button', { name: 'Trim start to here' }).click()
  await expectTotal(page, / \/ 0:0[34]\.\d$/)

  const d = page.waitForEvent('download')
  await page.getByRole('button', { name: /^Export MP4/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 90_000 })
  const out = (await (await d).path())!
  expect(Number(probe(out, 'format=duration'))).toBeCloseTo(4, 0)
  expect(probe(out, 'stream=codec_type').split('\n')).toEqual(['video', 'audio'])
  expect(probe(out, 'stream=width,height').split('\n')[0]).toBe('640,360')
})

test('Home offers Edit video for a dropped clip', async ({ page, browserName }, info) => {
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByText('Drop anything').click()
  await (await chooser).setFiles(clip((n) => info.outputPath(n), browserName))
  await page.getByRole('button', { name: 'Edit video instead' }).click()
  await expect(page.getByRole('slider', { name: 'Timeline' })).toBeVisible({ timeout: 30_000 })
})

test('16:9 clip becomes a 1080x1920 vertical, filled or blurred', async ({ page, browserName }, info) => {
  await openVideo(page, clip((n) => info.outputPath(n), browserName))
  await page.getByRole('button', { name: '9:16 TikTok' }).click()
  await expect(page.getByRole('button', { name: /^Export MP4 .* 1080×1920$/ })).toBeVisible()
  // Drag the picture right: shows more of the left side, and is one undo step.
  await page.locator('main video').scrollIntoViewIfNeeded()
  const box = (await page.locator('main video').locator('..').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 4, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  const out = await exportAndProbe(page)
  expect(probe(out, 'stream=width,height').split('\n')[0]).toBe('1080,1920')
  expect(Number(probe(out, 'format=duration'))).toBeCloseTo(10, 0)
  // Dragged all the way right, the crop starts at the source's left edge: testsrc2's red bar.
  const [r, g, b] = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', out, '-frames:v', '1', '-vf', 'format=rgb24,crop=1:1:60:960', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  expect(r).toBeGreaterThan(150)
  expect(r).toBeGreaterThan(g + b) // red wins; the moving overlay can tint a pixel

  await page.getByRole('button', { name: 'Keep editing' }).click()
  await page.getByRole('button', { name: 'Blur background' }).click()
  expect(probe(await exportAndProbe(page), 'stream=width,height').split('\n')[0]).toBe('1080,1920')
})

test('rotate 90° turns a 640x360 clip into 360x640', async ({ page, browserName }, info) => {
  await openVideo(page, clip((n) => info.outputPath(n), browserName))
  await page.getByRole('button', { name: 'Rotate 90°' }).click()
  await page.getByRole('button', { name: 'Mirror' }).click()
  await expect(page.getByRole('button', { name: /^Export MP4 .* 360×640$/ })).toBeVisible()
  expect(probe(await exportAndProbe(page), 'stream=width,height').split('\n')[0]).toBe('360,640')
})

/** 2 s red then 2 s blue, with a tone: shows which way time runs. */
function redThenBlue(dir: (n: string) => string, browser: string) {
  const webm = browser === 'chromium'
  const path = dir(webm ? 'rb.webm' : 'rb.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '500k', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-filter_complex', '[0][1]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a', ...codecs, '-shortest', '-y', path])
  return path
}
const pixel = (file: string, at: number) =>
  [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'format=rgb24,crop=1:1:100:100', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]

test('2× speed halves the length, picture and sound', async ({ page, browserName }, info) => {
  await openVideo(page, clip((n) => info.outputPath(n), browserName))
  await page.getByRole('button', { name: '2×', exact: true }).click()
  await expectTotal(page, / \/ 0:05\.0$/)
  const out = await exportAndProbe(page)
  expect(Number(probe(out, 'format=duration'))).toBeCloseTo(5, 0)
  expect(Number(probe(out, 'stream=duration').split('\n')[1])).toBeCloseTo(5, 0) // audio
})

test('reverse plays the clip backwards, chunk by chunk', async ({ page, browserName }, info) => {
  await openVideo(page, redThenBlue((n) => info.outputPath(n), browserName))
  await page.getByRole('button', { name: 'Reverse' }).click()
  const out = await exportAndProbe(page)
  expect(Number(probe(out, 'format=duration'))).toBeCloseTo(4, 0)
  const [r0, , b0] = pixel(out, 0.3)
  const [r1, , b1] = pixel(out, 3.5)
  expect(b0).toBeGreaterThan(r0) // starts blue
  expect(r1).toBeGreaterThan(b1) // ends red
  expect(probe(out, 'stream=codec_type').split('\n')).toEqual(['video', 'audio'])
})

test('B&W look: preview and export are both grey', async ({ page, browserName }, info) => {
  await openVideo(page, redThenBlue((n) => info.outputPath(n), browserName))
  await page.getByRole('button', { name: 'B&W' }).click()
  await expect(page.locator('main video')).toHaveCSS('filter', /grayscale\(1\)/)
  const [r, g, b] = pixel(await exportAndProbe(page), 0.5)
  expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(12)
  expect(r).toBeGreaterThan(30) // red's luminance (≈47 after contrast), not black
  expect(r).toBeLessThan(70)
})

test('SRT follows cuts and speed', async ({ page }) => {
  await page.goto('/')
  const srt = await page.evaluate(async () => {
    const { toSrt } = await import('/src/features/video-editor/captions.ts')
    const w = (text: string, from: number) => ({ text, from, to: from + 0.4 })
    const words = [w('Hello', 1), w('world.', 1.5), w('Cut', 4), w('me.', 4.5), w('Keep', 7), w('this.', 7.5)]
    // [4, 6] cut out, then played at 2x.
    return toSrt(words, { segs: [{ src: 0, from: 0, to: 4 }, { src: 0, from: 6, to: 10 }], speed: 2, reverse: false })
  })
  expect(srt).toBe('1\n00:00:00,500 --> 00:00:00,950\nHello world.\n\n2\n00:00:02,500 --> 00:00:02,950\nKeep this.\n')
})

test('auto captions: on-device Whisper, edit a line, SRT', async ({ page, browserName }, info) => {
  test.skip(!!process.env.OFFLINE, 'downloads the speech model from Hugging Face')
  test.setTimeout(300_000)
  await openVideo(page, speechClip((n) => info.outputPath(n), browserName))
  await page.getByRole('combobox').selectOption('en')
  await page.getByRole('button', { name: 'Auto captions' }).click()
  const transcript = page.getByRole('list', { name: 'Transcript' })
  await expect(transcript).toBeVisible({ timeout: 240_000 })
  const all = (await transcript.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join(' ')
  expect(all.toLowerCase()).toMatch(/caption/)
  expect(all.toLowerCase()).toMatch(/video editor/)

  // Karaoke at the start of a line: unsung words are white, not lost in the outline (Safari painted them black).
  await page.getByRole('button', { name: 'Karaoke' }).click()
  await page.getByRole('button', { name: /^Go to / }).nth(1).click()
  const shot = info.outputPath('karaoke.png')
  await page.locator('p.pointer-events-none').screenshot({ path: shot })
  const [w, h] = probe(shot, 'stream=width,height').split(',').map(Number)
  expect(captionPixels(shot, 0, w, 0, h).white).toBeGreaterThan(500)

  // Fix the first line, then download the SRT.
  const first = transcript.locator('input').first()
  await first.fill('Hi there.')
  await first.press('Enter')
  const d = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download SRT' }).click()
  const srt = (await import('node:fs')).readFileSync((await (await d).path())!, 'utf8')
  expect(srt).toMatch(/^1\n00:00:0\d,\d{3} --> 00:00:0\d,\d{3}\nHi there\.\n/)
  expect(srt.toLowerCase()).toMatch(/video editor/) // the lines we didn't touch
})

test('auto captions: no word is stamped inside a pause', async ({ page, browserName }, info) => {
  test.skip(!!process.env.OFFLINE, 'downloads the speech model from Hugging Face')
  test.setTimeout(300_000)
  // Whisper used to put "you." 3 s into this pause (speech ends ~9.7 s, resumes ~17.8 s).
  const say = (n: string, text: string) => execFileSync('say', ['-v', 'Samantha', '-r', '165', '-o', info.outputPath(n), text])
  say('a.aiff', 'Welcome back to the channel. Today I am testing a new video editor that runs entirely on the phone. It turns a wide clip into a vertical one, and it writes the captions for you.')
  say('b.aiff', 'After the pause, the music should come back up.')
  const voice = info.outputPath('voice.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-i', info.outputPath('a.aiff'), '-i', info.outputPath('b.aiff'), '-filter_complex', '[0]aresample=48000,apad=pad_dur=8[a];[1]aresample=48000[b];[a][b]concat=n=2:v=0:a=1', '-y', voice])
  const sil = spawnSync('ffmpeg', ['-i', voice, '-af', 'silencedetect=n=-45dB:d=2', '-f', 'null', '-']).stderr.toString()
  const [s1, e1] = [/silence_start: ([\d.]+)/, /silence_end: ([\d.]+)/].map((re) => Number(re.exec(sil)![1]))
  const webm = browserName === 'chromium'
  const path = info.outputPath(webm ? 'pause.webm' : 'pause.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=30', '-i', voice, ...codecs, '-shortest', '-y', path])

  await openVideo(page, path)
  await page.getByRole('combobox').selectOption('en')
  await page.getByRole('button', { name: 'Auto captions' }).click()
  const transcript = page.getByRole('list', { name: 'Transcript' })
  await expect(transcript).toBeVisible({ timeout: 240_000 })
  const starts = await transcript.getByRole('button', { name: /^Go to / }).evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label')!.replace('Go to ', '').split(':').reduce((m, s) => m * 60 + Number(s), 0)),
  )
  expect(starts.filter((t) => t > s1 + 0.3 && t < e1 - 0.3)).toEqual([])
  const all = (await transcript.locator('input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join(' ')
  expect(all.toLowerCase()).toMatch(/for you/) // the moved word is kept, not dropped
})

test('cut silences removes a pause, and undo brings it back', async ({ page, browserName }, info) => {
  const say = (n: string, text: string) => execFileSync('say', ['-v', 'Samantha', '-o', info.outputPath(n), text])
  say('a.aiff', 'This is the first part.')
  say('b.aiff', 'And this is the second part.')
  const voice = info.outputPath('voice.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-i', info.outputPath('a.aiff'), '-i', info.outputPath('b.aiff'), '-filter_complex', '[0]aresample=48000,apad=pad_dur=3[a];[1]aresample=48000[b];[a][b]concat=n=2:v=0:a=1', '-y', voice])
  const len = (f: string) => Number(probe(f, 'format=duration'))
  const webm = browserName === 'chromium'
  const path = info.outputPath(webm ? 'pause.webm' : 'pause.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30', '-i', voice, ...codecs, '-shortest', '-y', path])
  const full = len(path)

  await openVideo(page, path)
  const totalSecs = async () => {
    const txt = (await total(page).textContent())!.split(' / ')[1]
    const [m, sec] = txt.split(':')
    return Number(m) * 60 + Number(sec)
  }
  await expect.poll(totalSecs).toBeCloseTo(full, 0)
  await page.getByRole('button', { name: 'Cut silences' }).click()
  await expect(page.getByRole('status').filter({ hasText: /^Cut [\d.]+ s of pauses/ })).toBeVisible({ timeout: 60_000 })
  const cut = full - (await totalSecs())
  expect(cut).toBeGreaterThan(2.3) // the 3 s pause, minus the padding kept around speech
  expect(cut).toBeLessThan(3.6)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(totalSecs).toBeCloseTo(full, 0)
})

test('reduce background noise lowers the hiss in the export', async ({ page, browserName }, info) => {
  execFileSync('say', ['-v', 'Samantha', '-o', info.outputPath('a.aiff'), 'Testing the noise reduction.'])
  const speech = Number(probe(info.outputPath('a.aiff'), 'format=duration'))
  const noisy = info.outputPath('noisy.wav')
  // The voice, then 3 s of silence, all over steady hiss.
  execFileSync('ffmpeg', ['-v', 'error', '-i', info.outputPath('a.aiff'), '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.02:sample_rate=48000', '-filter_complex', '[0]aresample=48000,apad=pad_dur=3[v];[v][1]amix=inputs=2:duration=first:normalize=0', '-y', noisy])
  const webm = browserName === 'chromium'
  const path = info.outputPath(webm ? 'noisy.webm' : 'noisy.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-b:a', '128k'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30', '-i', noisy, ...codecs, '-shortest', '-y', path])
  const db = (f: string, from: number, len: number) => {
    const out = spawnSync('ffmpeg', ['-ss', String(from), '-t', String(len), '-i', f, '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString()
    return Number(/mean_volume: (-?[\d.]+)/.exec(out)![1])
  }
  const pauseDb = (f: string) => db(f, speech + 0.8, 1.5)

  await openVideo(page, path)
  const plain = await exportAndProbe(page)
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await page.getByLabel(/Reduce background noise/).check()
  const clean = await exportAndProbe(page)
  expect(pauseDb(plain) - pauseDb(clean)).toBeGreaterThan(8) // hiss at least 8 dB quieter
  expect(Math.abs(db(plain, 0.3, 1) - db(clean, 0.3, 1))).toBeLessThan(3) // the voice keeps its level
})

test('follow face keeps a moving face in the middle of a 9:16 crop', async ({ page, browserName }, info) => {
  test.skip(!!process.env.OFFLINE, 'downloads a sample photo from Hugging Face')
  test.setTimeout(240_000)
  const face = info.outputPath('face.jpg')
  writeFileSync(face, Buffer.from(await (await fetch('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/portrait-of-woman_small.jpg')).arrayBuffer()))
  // A 6 s 1280×720 clip: the portrait (scaled to 400 px tall) slides from the left edge to the right edge on blue.
  const webm = browserName === 'chromium'
  const path = info.outputPath(webm ? 'moving.webm' : 'moving.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '1M'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x0000ff:s=1280x720:r=30:d=6', '-loop', '1', '-i', face, '-filter_complex', '[1]scale=-2:400[f];[0][f]overlay=x=40+t*(1280-80-overlay_w)/6:y=160:shortest=1', ...codecs, '-an', '-y', path])
  /** Horizontal centre (0–1) of the non-blue pixels in the export at time `at`. */
  const faceX = (file: string, at: number) => {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=108:192,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24 })
    let sum = 0
    let n = 0
    for (let i = 0; i < raw.length; i += 3) {
      const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]]
      if (!(b > 180 && r < 80 && g < 80)) {
        sum += (i / 3) % 108
        n++
      }
    }
    return sum / n / 108
  }

  await openVideo(page, path)
  await page.getByRole('button', { name: '9:16 TikTok' }).click()
  const fixed = await exportAndProbe(page)
  const miss = faceX(fixed, 0.5)
  expect(Number.isNaN(miss) || Math.abs(miss - 0.5) > 0.3).toBe(true) // control: a centre crop misses the face at the start
  await page.getByRole('button', { name: 'Keep editing' }).click()
  await page.getByRole('button', { name: 'Follow face' }).click()
  await expect(page.getByRole('button', { name: 'Follow face' })).toHaveAttribute('aria-pressed', 'true', { timeout: 120_000 })
  const followed = await exportAndProbe(page)
  // Near the clip's edges the crop can't move further, so the face sits a little off-centre there.
  for (const at of [0.5, 3, 5.5]) expect(Math.abs(faceX(followed, at) - 0.5), `face position at ${at} s`).toBeLessThan(0.25)
})

test('text overlay: drag it, box style, shows only in its time range', async ({ page, browserName }, info) => {
  const webm = browserName === 'chromium'
  const path = info.outputPath(webm ? 'blue.webm' : 'blue.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1f3a93:s=640x360:r=30:d=6', '-f', 'lavfi', '-i', 'sine=d=6', ...codecs, '-shortest', '-y', path])
  await openVideo(page, path)

  await page.getByRole('button', { name: '+ Text' }).click() // 0–3 s, centred at 30% height
  await page.getByLabel('Text').fill('HELLO')
  await page.getByRole('button', { name: 'Box' }).click()
  await page.getByRole('button', { name: 'Colour #FFD43B' }).click()
  // Drag it from 30% to 50% of the height.
  const img = page.getByRole('img', { name: 'Text: HELLO' })
  await img.scrollIntoViewIfNeeded()
  const frame = (await page.locator('main video').locator('..').boundingBox())!
  const b = (await img.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + frame.height * 0.2, { steps: 6 })
  await page.mouse.up()

  const out = await exportAndProbe(page)
  const yellowAt = (t: number, y: number) => captionPixels(out, t, 640, y - 8, y + 8).yellow
  expect(yellowAt(1, 180)).toBeGreaterThan(500) // dragged here (50%)
  expect(yellowAt(1, 108)).toBe(0) // not where it started
  expect(yellowAt(4.5, 180)).toBe(0) // gone after 3 s
})

/** Mean loudness (dB) of one frequency band over [from, from + secs]. */
function bandDb(file: string, hz: number, from: number, secs: number) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', String(secs), '-i', file, '-af', `bandpass=f=${hz}:width_type=q:w=8,volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' })
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)?.[1] ?? -99)
}

test('music: auto-ducks under the original sound, or replaces it', async ({ page, browserName }, info) => {
  // Original sound: a 440 Hz tone for 2 s, then silence. Music: a steady 880 Hz tone.
  const webm = browserName === 'chromium'
  const clipPath = info.outputPath(webm ? 'talk.webm' : 'talk.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=2,apad=whole_dur=6', ...codecs, '-t', '6', '-y', clipPath])
  const song = info.outputPath('song.wav')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=f=880:d=10', '-y', song])

  await openVideo(page, clipPath)
  const chooser = page.waitForEvent('filechooser')
  await page.getByText('+ Add music').click()
  await (await chooser).setFiles(song)
  await expect(page.getByLabel('Lower the music when there’s talking')).toBeChecked()

  const ducked = await exportAndProbe(page)
  const underTalk = bandDb(ducked, 880, 0.6, 1)
  const alone = bandDb(ducked, 880, 3.5, 1.5)
  expect(alone - underTalk).toBeGreaterThan(6) // music dips while the 440 Hz "talk" plays
  expect(bandDb(ducked, 440, 0.6, 1)).toBeGreaterThan(-30) // and the talk is still there
  expect(Number(probe(ducked, 'format=duration'))).toBeCloseTo(6, 0)

  await page.getByRole('button', { name: 'Keep editing' }).click()
  await page.getByRole('button', { name: 'Replace original sound' }).click()
  const replaced = await exportAndProbe(page)
  // The 440 Hz talk is gone (what's left is the band filter's leak from the 880 Hz music).
  expect(bandDb(ducked, 440, 0.6, 1) - bandDb(replaced, 440, 0.6, 1)).toBeGreaterThan(15)
  expect(bandDb(replaced, 880, 0.6, 1) - bandDb(ducked, 880, 0.6, 1)).toBeGreaterThan(6) // and the music is no longer ducked
})

test('export settings: fits under 8 MB; 720p at 24 fps', async ({ page, browserName }, info) => {
  test.setTimeout(240_000)
  // Noise is hard to compress, so a size target really has to work for it.
  const webm = browserName === 'chromium'
  const path = info.outputPath(webm ? 'noise.webm' : 'noise.mp4')
  const codecs = webm ? ['-c:v', 'libvpx', '-b:v', '6M', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac']
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=20,noise=alls=40:allf=t', '-f', 'lavfi', '-i', 'sine=d=20', ...codecs, '-shortest', '-y', path])
  await openVideo(page, path)

  await page.getByRole('button', { name: 'Under 8 MB' }).click()
  await expect(page.getByText(/^about \d+(\.\d)? MB · takes about/)).toBeVisible()
  const small = await exportAndProbe(page)
  const bytes = (await import('node:fs')).statSync(small).size
  expect(bytes).toBeLessThan(8e6)
  expect(bytes).toBeGreaterThan(4e6) // it used the room it had, rather than crushing the picture

  await page.getByRole('button', { name: 'Keep editing' }).click()
  await page.getByRole('button', { name: 'Under 8 MB' }).click() // tap again: no size limit
  await page.getByRole('button', { name: '9:16 TikTok' }).click()
  await page.getByRole('button', { name: '720p' }).click()
  await page.getByRole('button', { name: '24 fps' }).click()
  await expect(page.getByRole('button', { name: /^Export MP4 .* 720×1280$/ })).toBeVisible()
  const out = await exportAndProbe(page)
  expect(probe(out, 'stream=width,height').split('\n')[0]).toBe('720,1280')
  expect(probe(out, 'stream=r_frame_rate').split('\n')[0]).toBe('24/1')
})
