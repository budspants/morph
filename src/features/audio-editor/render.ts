// Turns an EditState into audio. Stage 1 is Web Audio (fast enough for live preview):
// cuts, crossfades, EQ, effects, speed, fades, volume. Stage 2 runs ffmpeg only when
// needed: pitch-locked speed, pitch shift, loudness. Preview and export share this path,
// so what you hear is what you get.
import { runJob } from '../../engine/ffmpeg'
import type { EditState, EffectId } from './model'

type Fx = {
  label: string
  rate?: number // playback rate, changes pitch like a record
  lowpass?: number
  highpass?: number
  peak?: [freq: number, db: number]
  reverb?: [seconds: number, wet: number]
  pan8d?: boolean
  comp?: boolean
  gainDb?: number
}

export const EFFECTS: Record<EffectId, Fx> = {
  none: { label: 'None' },
  slowed: { label: 'Slowed + reverb', rate: 0.85, reverb: [3, 0.35] },
  sped: { label: 'Sped up', rate: 1.25 },
  nightcore: { label: 'Nightcore', rate: 1.3, peak: [8000, 3] },
  '8d': { label: '8D', pan8d: true, reverb: [1.5, 0.15] },
  car: { label: 'Car speakers', highpass: 90, lowpass: 5000, peak: [180, 6], comp: true },
  underwater: { label: 'Underwater', lowpass: 550, reverb: [1.2, 0.3] },
  hall: { label: 'Concert hall', reverb: [4.5, 0.5] },
  airpods: { label: 'AirPods in another room', lowpass: 900, reverb: [2, 0.6], gainDb: -8 },
}

export const EQ_BANDS = [80, 250, 1000, 4000, 12000]

/** Seconds of output per second of edit timeline. */
export const outRate = (st: EditState) => (EFFECTS[st.effect].rate ?? 1) * st.speed

// Synthetic reverb tail: decaying stereo noise. No sound files to download.
const irCache = new Map<string, AudioBuffer>()
function impulse(ctx: BaseAudioContext, secs: number): AudioBuffer {
  const key = `${secs}-${ctx.sampleRate}`
  const hit = irCache.get(key)
  if (hit) return hit
  const len = Math.floor(secs * ctx.sampleRate)
  const ir = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c)
    let seed = 1234 + c * 999 // fixed seed: the same reverb every render
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647
      d[i] = ((seed / 2147483647) * 2 - 1) * (1 - i / len) ** 2.5
    }
  }
  irCache.set(key, ir)
  return ir
}

/** Join the timeline pieces into one buffer, crossfading where pieces overlap. */
export function assemble(srcs: AudioBuffer[], st: EditState): AudioBuffer {
  const sr = srcs[0].sampleRate
  const pieces = st.segs.map((s) => ({ s, buf: srcs[s.src], a: Math.floor(s.from * sr), b: Math.floor(s.to * sr), x: Math.floor((s.xfade ?? 0) * sr) }))
  const total = pieces.reduce((n, p, i) => n + (p.b - p.a) - (i ? p.x : 0), 0)
  const out = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, total), sampleRate: sr })
  for (let c = 0; c < 2; c++) {
    const o = out.getChannelData(c)
    let pos = 0
    pieces.forEach((p, i) => {
      const inp = p.buf.getChannelData(Math.min(c, p.buf.numberOfChannels - 1))
      const x = i ? p.x : 0
      pos -= x
      const n = p.b - p.a
      for (let k = 0; k < n; k++) {
        const v = inp[p.a + k] ?? 0
        if (k < x) {
          const t = k / x // equal-power crossfade
          o[pos + k] = o[pos + k] * Math.cos((t * Math.PI) / 2) + v * Math.sin((t * Math.PI) / 2)
        } else o[pos + k] = v
      }
      pos += n
    })
  }
  return out
}

/** Stage 1: Web Audio render of the whole edit. */
export async function renderWeb(srcs: AudioBuffer[], st: EditState): Promise<AudioBuffer> {
  const dry = assemble(srcs, st)
  const fx = EFFECTS[st.effect]
  const rate = (fx.rate ?? 1) * (st.keepPitch ? 1 : st.speed)
  const len = Math.max(1, Math.ceil(dry.length / rate))
  const sr = dry.sampleRate
  const ctx = new OfflineAudioContext(2, len, sr)
  const src = new AudioBufferSourceNode(ctx, { buffer: dry, playbackRate: rate })

  let node: AudioNode = src
  const chain = (n: AudioNode) => {
    node.connect(n)
    node = n
  }
  st.eq.forEach((db, i) => db && chain(new BiquadFilterNode(ctx, { type: i === 0 ? 'lowshelf' : i === 4 ? 'highshelf' : 'peaking', frequency: EQ_BANDS[i], gain: db, Q: 1 })))
  if (fx.highpass) chain(new BiquadFilterNode(ctx, { type: 'highpass', frequency: fx.highpass }))
  if (fx.lowpass) chain(new BiquadFilterNode(ctx, { type: 'lowpass', frequency: fx.lowpass }))
  if (fx.peak) chain(new BiquadFilterNode(ctx, { type: 'peaking', frequency: fx.peak[0], gain: fx.peak[1] }))
  if (fx.comp) chain(new DynamicsCompressorNode(ctx, { threshold: -24, ratio: 4 }))
  if (fx.pan8d) {
    const pan = new StereoPannerNode(ctx)
    const lfo = new OscillatorNode(ctx, { frequency: 0.12 })
    const depth = new GainNode(ctx, { gain: 0.9 })
    lfo.connect(depth).connect(pan.pan)
    lfo.start()
    chain(pan)
  }

  // Volume and fades on the final output (fade times are in output seconds).
  const master = new GainNode(ctx, { gain: 0 })
  const out = len / sr
  const g = 10 ** (((st.gainDb ?? 0) + (fx.gainDb ?? 0)) / 20)
  const fi = Math.min(st.fadeIn, out / 2)
  const fo = Math.min(st.fadeOut, out / 2)
  master.gain.setValueAtTime(fi ? 0 : g, 0)
  if (fi) master.gain.linearRampToValueAtTime(g, fi)
  if (fo) {
    master.gain.setValueAtTime(g, out - fo)
    master.gain.linearRampToValueAtTime(0, out)
  }
  if (fx.reverb) {
    const [secs, wet] = fx.reverb
    const verb = new ConvolverNode(ctx, { buffer: impulse(ctx, secs) })
    node.connect(new GainNode(ctx, { gain: 1 - wet * 0.5 })).connect(master)
    node.connect(verb).connect(new GainNode(ctx, { gain: wet })).connect(master)
  } else node.connect(master)
  master.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

/** 16-bit PCM WAV. */
export function toWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels
  const n = buf.length
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2))
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  out.setUint32(4, 36 + n * ch * 2, true)
  str(8, 'WAVEfmt ')
  out.setUint32(16, 16, true)
  out.setUint16(20, 1, true)
  out.setUint16(22, ch, true)
  out.setUint32(24, buf.sampleRate, true)
  out.setUint32(28, buf.sampleRate * ch * 2, true)
  out.setUint16(32, ch * 2, true)
  out.setUint16(34, 16, true)
  str(36, 'data')
  out.setUint32(40, n * ch * 2, true)
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let o = 44
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]))
      out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      o += 2
    }
  return new Uint8Array(out.buffer)
}

// atempo only takes 0.5–2 per instance, so chain it for bigger changes.
function atempo(r: number): string[] {
  const out: string[] = []
  while (r > 2) {
    out.push('atempo=2')
    r /= 2
  }
  while (r < 0.5) {
    out.push('atempo=0.5')
    r /= 0.5
  }
  return [...out, `atempo=${r.toFixed(5)}`]
}

/** The ffmpeg filters stage 2 needs, or none. */
export function stage2Filters(st: EditState, sr: number): string[] {
  const f: string[] = []
  if (st.keepPitch && st.speed !== 1) f.push(...atempo(st.speed))
  if (st.pitch) {
    const k = 2 ** (st.pitch / 12)
    f.push(`asetrate=${Math.round(sr * k)}`, `aresample=${sr}`, ...atempo(1 / k))
  }
  if (st.loudness) f.push(`loudnorm=I=${st.loudness}:TP=-1.5:LRA=11`, `aresample=${sr}`)
  return f
}

export type ExportFormat = 'mp3' | 'm4a' | 'wav' | 'flac'
export const EXPORTS: Record<ExportFormat, { mime: string; args: string[] }> = {
  mp3: { mime: 'audio/mpeg', args: ['-c:a', 'libmp3lame', '-b:a', '192k', '-id3v2_version', '3'] },
  m4a: { mime: 'audio/mp4', args: ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'] },
  wav: { mime: 'audio/wav', args: ['-c:a', 'pcm_s16le'] },
  flac: { mime: 'audio/flac', args: ['-c:a', 'flac'] },
}

/** Stage 2 for preview: returns the buffer unchanged when no ffmpeg work is needed. */
export async function renderPreview(srcs: AudioBuffer[], st: EditState, decode: (b: ArrayBuffer) => Promise<AudioBuffer>): Promise<AudioBuffer> {
  const web = await renderWeb(srcs, st)
  const filters = stage2Filters(st, web.sampleRate)
  if (!filters.length) return web
  const wav = new File([toWav(web) as BlobPart], 'edit.wav', { type: 'audio/wav' })
  const out = await runJob(wav, 'p.wav', (i, o) => ['-i', i, '-af', filters.join(','), '-c:a', 'pcm_s16le', o], () => {}).result
  return decode(out.slice().buffer)
}

/** Final file: preview render, stage 2, encode, tags and cover art. */
export async function exportEdit(rendered: AudioBuffer, st: EditState, format: ExportFormat, cover: File | null, onProgress: (r: number) => void): Promise<Blob> {
  const wav = new File([toWav(rendered) as BlobPart], 'edit.wav', { type: 'audio/wav' })
  const { mime, args } = EXPORTS[format]
  const tags = Object.entries(st.meta).flatMap(([k, v]) => (v.trim() ? ['-metadata', `${k}=${v.trim()}`] : []))
  const withCover = cover && (format === 'mp3' || format === 'm4a')
  const out = await runJob(
    wav,
    `out.${format}`,
    (i, o, [c]) => [
      '-i', i,
      ...(withCover ? ['-i', c, '-map', '0:a', '-map', '1:v', '-c:v', format === 'mp3' ? 'mjpeg' : 'copy', '-disposition:v', 'attached_pic'] : []),
      ...args, ...tags, o,
    ],
    onProgress,
    withCover ? [cover] : [],
  ).result
  return new Blob([out as BlobPart], { type: mime })
}
