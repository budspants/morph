// Audio analysis on a mono, downsampled copy: waveform peaks, BPM + beat grid, musical key,
// silent stretches and a loop suggestion. Long loops yield to the UI so the screen never freezes.

const yieldUI = () => new Promise((r) => setTimeout(r, 0))

/** Mono mix, averaged down to about `target` Hz. */
export function mono(buf: AudioBuffer, target = 11025): { data: Float32Array; sr: number } {
  const step = Math.max(1, Math.floor(buf.sampleRate / target))
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
  const n = Math.floor(buf.length / step)
  const data = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < step; k++) for (const ch of chans) s += ch[i * step + k]
    data[i] = s / (step * chans.length)
  }
  return { data, sr: buf.sampleRate / step }
}

/** Min/max pairs per bucket of `bucket` samples, for drawing. */
export function peaks(buf: AudioBuffer, bucket = 256): Float32Array {
  const a = buf.getChannelData(0)
  const b = buf.numberOfChannels > 1 ? buf.getChannelData(1) : a
  const n = Math.ceil(buf.length / bucket)
  const out = new Float32Array(n * 2)
  for (let i = 0; i < n; i++) {
    let lo = 0
    let hi = 0
    for (let k = i * bucket, end = Math.min(buf.length, k + bucket); k < end; k++) {
      const v = (a[k] + b[k]) / 2
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    out[i * 2] = lo
    out[i * 2 + 1] = hi
  }
  return out
}

/** Tempo and beat times (seconds). Onset strength + autocorrelation over 70–180 BPM. */
export async function detectBpm(buf: AudioBuffer): Promise<{ bpm: number; beats: number[] } | null> {
  const { data, sr } = mono(buf)
  const hop = 64 // ~5.8 ms frames: fine enough to tell 120 from 118 BPM
  const frames = Math.floor(data.length / hop)
  if (frames < 256) return null
  const env = new Float32Array(frames)
  let prev = 0
  for (let f = 0; f < frames; f++) {
    let e = 0
    for (let k = 0; k < hop; k++) e += data[f * hop + k] ** 2
    e = Math.log1p(e * 1000)
    env[f] = Math.max(0, e - prev)
    prev = e
  }
  await yieldUI()
  const fps = sr / hop
  let best = 0
  let bestLag = 0
  for (let bpm = 70; bpm <= 180; bpm += 0.1) {
    const lag = (60 / bpm) * fps
    const l0 = Math.floor(lag)
    const w = lag - l0
    let s = 0
    for (let f = 0; f + l0 + 1 < frames; f++) s += env[f] * (env[f + l0] * (1 - w) + env[f + l0 + 1] * w)
    // Mild preference for 90–140, where most music sits.
    s *= bpm >= 90 && bpm <= 140 ? 1.05 : 1
    if (s > best) {
      best = s
      bestLag = lag
    }
  }
  if (!bestLag) return null
  // Beat phase: the offset whose grid lands on the strongest onsets.
  let phase = 0
  let phaseScore = -1
  for (let p = 0; p < bestLag; p++) {
    let s = 0
    for (let f = p; f < frames; f += bestLag) s += env[Math.round(f)] ?? 0
    if (s > phaseScore) {
      phaseScore = s
      phase = p
    }
  }
  const beats: number[] = []
  for (let f = phase; f < frames; f += bestLag) beats.push(f / fps)
  const raw = (60 * fps) / bestLag
  // Whole numbers when it's that close: music is almost always made at an integer tempo.
  return { bpm: Math.abs(raw - Math.round(raw)) < 0.45 ? Math.round(raw) : Math.round(raw * 10) / 10, beats }
}

const NOTES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
// Krumhansl–Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** Musical key from a pitch-class profile (Goertzel per note, C2–B5). */
export async function detectKey(buf: AudioBuffer): Promise<string | null> {
  const { data, sr } = mono(buf)
  const win = 4096
  const chroma = new Float64Array(12)
  const coefs = Array.from({ length: 48 }, (_, i) => 2 * Math.cos((2 * Math.PI * (65.406 * 2 ** (i / 12))) / sr))
  const stepFrames = Math.max(win, Math.floor(data.length / 400)) // cap work at ~400 windows
  let n = 0
  for (let start = 0; start + win <= data.length; start += stepFrames) {
    for (let i = 0; i < 48; i++) {
      const c = coefs[i]
      let s1 = 0
      let s2 = 0
      for (let k = 0; k < win; k++) {
        const s0 = data[start + k] + c * s1 - s2
        s2 = s1
        s1 = s0
      }
      chroma[i % 12] += Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2))
    }
    if (++n % 20 === 0) await yieldUI()
  }
  if (!n) return null
  const corr = (prof: number[], root: number) => {
    const x = [...chroma]
    const y = prof.map((_, i) => prof[(i - root + 12) % 12])
    const mx = x.reduce((a, b) => a + b) / 12
    const my = y.reduce((a, b) => a + b) / 12
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < 12; i++) {
      num += (x[i] - mx) * (y[i] - my)
      dx += (x[i] - mx) ** 2
      dy += (y[i] - my) ** 2
    }
    return num / Math.sqrt(dx * dy || 1)
  }
  let best = { score: -2, name: '' }
  for (let r = 0; r < 12; r++) {
    const maj = corr(MAJOR, r)
    const min = corr(MINOR, r)
    if (maj > best.score) best = { score: maj, name: `${NOTES[r]} major` }
    if (min > best.score) best = { score: min, name: `${NOTES[r]} minor` }
  }
  return best.name
}

/** Stretches quieter than `db` for at least `minSec`, as [start, end] seconds. */
export function findSilence(buf: AudioBuffer, db = -45, minSec = 0.7): [number, number][] {
  const { data, sr } = mono(buf, 4000)
  const hop = Math.floor(sr * 0.05)
  const limit = 10 ** (db / 20)
  const out: [number, number][] = []
  let start = -1
  const frames = Math.floor(data.length / hop)
  for (let f = 0; f <= frames; f++) {
    let rms = 0
    if (f < frames) {
      for (let k = 0; k < hop; k++) rms += data[f * hop + k] ** 2
      rms = Math.sqrt(rms / hop)
    }
    const quiet = f < frames && rms < limit
    if (quiet && start < 0) start = f
    if (!quiet && start >= 0) {
      const a = (start * hop) / sr
      const b = (f * hop) / sr
      if (b - a >= minSec) out.push([a, b])
      start = -1
    }
  }
  return out
}

/** A 4-bar loop on the beat grid, placed on the loudest stretch. */
export function findLoop(buf: AudioBuffer, beats: number[]): [number, number] | null {
  if (beats.length < 17) return null
  const { data, sr } = mono(buf, 4000)
  const energy = (a: number, b: number) => {
    let s = 0
    for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) s += data[i] ** 2
    return s
  }
  let best: [number, number] | null = null
  let bestE = -1
  for (let i = 0; i + 16 < beats.length; i += 4) {
    const e = energy(beats[i], beats[i + 16])
    if (e > bestE) {
      bestE = e
      best = [beats[i], beats[i + 16]]
    }
  }
  return best
}

/** Nearest beat to t, if one is within `tol` seconds. */
export const snap = (t: number, beats: number[] | undefined, tol = 0.15) => {
  if (!beats?.length) return t
  const b = beats.reduce((a, x) => (Math.abs(x - t) < Math.abs(a - t) ? x : a), beats[0])
  return Math.abs(b - t) <= tol ? b : t
}
