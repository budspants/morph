// Dev-only size test (sizetest.html). Runs each job on each picked file and records
// pass/fail, time and speed. A Safari tab crash reloads the page; the "running" marker
// left in localStorage turns that into a CRASHED row.
import { resetEngine, runJob } from '../engine/ffmpeg'
import { probeDuration } from '../features/convert/probe'

type Row = { file: string; size: number; job: string; ok: boolean | 'crash'; ms: number; speed: string; note: string }
type Saved = { results: Row[]; running: { file: string; size: number; job: string } | null }

const KEY = 'morph.sizetest'
const load = (): Saved => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '') as Saved
  } catch {
    return { results: [], running: null }
  }
}
const save = (s: Saved) => localStorage.setItem(KEY, JSON.stringify(s))

// Each job: output name, args, and how many seconds of media it processes (for speed).
const JOBS: { name: string; out: string; args: (i: string, o: string, dur: number) => string[]; media: (dur: number) => number }[] = [
  { name: 'MP3, whole file', out: 'o.mp3', args: (i, o) => ['-i', i, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', o], media: (d) => d },
  // Reads the last seconds: catches broken seeking past 2 GB.
  { name: 'MP3, last 5 s (seek)', out: 'e.mp3', args: (i, o, d) => ['-ss', String(Math.max(0, d - 8)), '-i', i, '-t', '5', '-vn', '-c:a', 'libmp3lame', o], media: (d) => Math.min(5, d) },
  { name: 'GIF, 10 s', out: 'o.gif', args: (i, o) => ['-t', '10', '-i', i, '-vf', 'fps=12,scale=480:-1:flags=lanczos', o], media: (d) => Math.min(10, d) },
  { name: 'Re-encode MP4, 60 s', out: 'o.mp4', args: (i, o) => ['-t', '60', '-i', i, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-c:a', 'aac', '-b:a', '128k', o], media: (d) => Math.min(60, d) },
]

const $ = (id: string) => document.getElementById(id)!
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${Math.round(b / 1e6)} MB`)

function render() {
  const s = load()
  $('rows').innerHTML = s.results
    .map((r) => {
      const cls = r.ok === true ? 'ok' : 'bad'
      const res = r.ok === true ? 'OK' : r.ok === 'crash' ? 'CRASHED' : 'FAILED'
      return `<tr><td>${r.file}<br><span style="color:#a1a1a1">${mb(r.size)}</span></td><td>${r.job}</td><td class="${cls}">${res}${r.note ? `<br><span style="color:#a1a1a1">${r.note}</span>` : ''}</td><td>${(r.ms / 1000).toFixed(1)} s</td><td>${r.speed}</td></tr>`
    })
    .join('')
}

function record(row: Row) {
  const s = load()
  s.results.push(row)
  s.running = null
  save(s)
  render()
}

async function runFile(file: File) {
  const duration = (await probeDuration(file)) ?? 0
  for (const job of JOBS) {
    $('status').textContent = `${file.name}: ${job.name}…`
    const s = load()
    s.running = { file: file.name, size: file.size, job: job.name }
    save(s)
    await resetEngine() // fresh wasm memory per job, like a real batch restart
    const t0 = performance.now()
    try {
      const { result } = runJob(file, job.out, (i, o) => job.args(i, o, duration), (r) => {
        $('status').textContent = `${file.name}: ${job.name} ${Math.round(r * 100)}%`
      })
      const out = await result
      const ms = performance.now() - t0
      const media = job.media(duration)
      record({ file: file.name, size: file.size, job: job.name, ok: true, ms, speed: media ? `${(media / (ms / 1000)).toFixed(2)}× real time` : '', note: `out ${mb(out.byteLength)}` })
    } catch (err) {
      const msg = (err as { log?: string }).log?.split('\n').filter(Boolean).slice(-2).join(' · ') || String(err)
      record({ file: file.name, size: file.size, job: job.name, ok: false, ms: performance.now() - t0, speed: '', note: msg.slice(0, 200) })
    }
  }
}

// A leftover "running" marker means the tab died mid-job.
{
  const s = load()
  if (s.running) {
    s.results.push({ ...s.running, ok: 'crash', ms: 0, speed: '', note: 'Page reloaded during this job (out of memory)' })
    s.running = null
    save(s)
  }
}
render()
$('dev').textContent = `${navigator.userAgent} · ${navigator.hardwareConcurrency} cores`

$('pick').addEventListener('change', async (e) => {
  const files = [...((e.target as HTMLInputElement).files ?? [])].sort((a, b) => a.size - b.size)
  for (const f of files) await runFile(f)
  $('status').textContent = 'Done.'
  ;(e.target as HTMLInputElement).value = ''
})
$('copy').addEventListener('click', () => {
  const lines = load().results.map((r) => `${r.file}\t${mb(r.size)}\t${r.job}\t${r.ok === true ? 'OK' : r.ok === 'crash' ? 'CRASHED' : 'FAILED'}\t${(r.ms / 1000).toFixed(1)}s\t${r.speed}\t${r.note}`)
  void navigator.clipboard.writeText([navigator.userAgent, ...lines].join('\n')).then(() => ($('status').textContent = 'Copied.'))
})
$('clear').addEventListener('click', () => {
  save({ results: [], running: null })
  render()
})
