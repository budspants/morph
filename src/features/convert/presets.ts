// Every conversion preset (spec: Smart converter). A preset is a big card on the ready
// screen; `fields` are the knobs its Options sheet shows. ffmpeg presets build a command
// line; image presets run through the browser's own decoder (images.ts).

export type Kind = 'video' | 'audio' | 'image'

/** What we know about the input file. `index`/`count`: its place in the batch (for renaming). */
export type Ctx = { kind: Kind; size: number; duration?: number; name: string; index?: number; count?: number }

export type Opts = {
  format?: string
  audioKbps?: number
  sampleRate?: number // 0 = keep
  channels?: number // 0 = keep
  height?: number // video max height, 0 = keep
  fps?: number // 0 = keep
  crf?: number // video quality, lower = better
  quality?: number // image quality 0.5–1
  maxSide?: number // image longest side, 0 = keep
  targetMB?: number
  start?: number
  length?: number
  every?: number // extract frames: one frame every N seconds
  fit?: 'crop' | 'blur'
  /** Image resize: 'p50' = 50%, 'w1080' = 1080 wide, 'c1080x1920' = cropped to fill 1080x1920. */
  size?: string
  /** Image compress: largest file size in KB. */
  targetKB?: number
  /** Output name pattern: {name} {n} {date}. Empty keeps the original name. */
  rename?: string
  /** Background removal: what goes behind the subject. */
  bg?: 'none' | 'white' | 'black'
}
export type Field = keyof Opts

export type Format = { label: string; ext: string; mime: string }
export const FORMATS: Record<string, Format> = {
  mp3: { label: 'MP3', ext: 'mp3', mime: 'audio/mpeg' },
  m4a: { label: 'M4A (AAC)', ext: 'm4a', mime: 'audio/mp4' },
  ogg: { label: 'OGG', ext: 'ogg', mime: 'audio/ogg' },
  opus: { label: 'OPUS', ext: 'opus', mime: 'audio/ogg' },
  flac: { label: 'FLAC', ext: 'flac', mime: 'audio/flac' },
  wav: { label: 'WAV', ext: 'wav', mime: 'audio/wav' },
  m4r: { label: 'iPhone (M4R)', ext: 'm4r', mime: 'audio/mp4' },
  mp4: { label: 'MP4', ext: 'mp4', mime: 'video/mp4' },
  mov: { label: 'MOV', ext: 'mov', mime: 'video/quicktime' },
  mkv: { label: 'MKV', ext: 'mkv', mime: 'video/x-matroska' },
  webm: { label: 'WEBM', ext: 'webm', mime: 'video/webm' },
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif' },
  jpg: { label: 'JPG', ext: 'jpg', mime: 'image/jpeg' },
  png: { label: 'PNG', ext: 'png', mime: 'image/png' },
  webp: { label: 'WEBP', ext: 'webp', mime: 'image/webp' },
  zip: { label: 'ZIP of JPGs', ext: 'zip', mime: 'application/zip' },
}

export type Preset = {
  id: string
  /** Saved custom presets point at the built-in preset they came from. */
  baseId?: string
  title: string
  icon: 'audio' | 'studio' | 'shrink' | 'gif' | 'phone' | 'vertical' | 'image' | 'frames' | 'ring' | 'cutout'
  kinds: Kind[]
  defaults: Opts
  fields: Field[]
  formats?: string[] // choices for the format field
  /** Re-encodes video: slow on phones, so the card shows a time estimate. */
  reencode?: boolean
  engine: 'ffmpeg' | 'image' | 'cutout'
  /** Tapping the card opens Options first (it needs a choice, e.g. target size). */
  askFirst?: boolean
  args?: (i: string, o: string, opts: Opts, ctx: Ctx) => string[]
  estimate?: (opts: Opts, ctx: Ctx) => number | undefined
  guide?: (opts: Opts) => string
}

export const outFormat = (p: Preset, o: Opts, kind?: Kind): Format =>
  FORMATS[o.format ?? p.defaults.format ?? ((p.baseId ?? p.id) === 'shrink' && kind !== 'audio' ? 'mp4' : 'mp3')]
/** Output name inside ffmpeg; `%` collects numbered frames into a zip. */
export const engineOut = (p: Preset, o: Opts, kind?: Kind) => ((p.baseId ?? p.id) === 'frames' ? 'f_%04d.webp' : `out.${outFormat(p, o, kind).ext}`)

// --- shared argument builders ---------------------------------------------------------

const clip = (o: Opts) => [...(o.start ? ['-ss', String(o.start)] : []), ...(o.length ? ['-t', String(o.length)] : [])]

function audioArgs(o: Opts): string[] {
  const k = `${o.audioKbps ?? 192}k`
  const extra = [...(o.sampleRate ? ['-ar', String(o.sampleRate)] : []), ...(o.channels ? ['-ac', String(o.channels)] : [])]
  switch (o.format) {
    case 'm4a': return ['-c:a', 'aac', '-b:a', k, ...extra, '-movflags', '+faststart']
    case 'm4r': return ['-c:a', 'aac', '-b:a', k, ...extra, '-f', 'ipod']
    case 'ogg': return ['-c:a', 'libvorbis', '-b:a', k, ...extra]
    case 'opus': return ['-c:a', 'libopus', '-b:a', k, ...extra]
    case 'flac': return ['-c:a', 'flac', ...extra]
    case 'wav': return ['-c:a', 'pcm_s16le', ...extra]
    default: return ['-c:a', 'libmp3lame', '-b:a', k, ...extra]
  }
}

function videoArgs(o: Opts, vf: string[], vbitrate?: number): string[] {
  const rate = vbitrate ? ['-b:v', `${vbitrate}k`, '-maxrate', `${Math.round(vbitrate * 1.3)}k`, '-bufsize', `${vbitrate * 2}k`] : []
  const filters = [...vf, ...(o.fps ? [`fps=${o.fps}`] : [])]
  const f = filters.length ? ['-vf', filters.join(',')] : []
  if (o.format === 'webm')
    return [...f, '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', ...(vbitrate ? rate : ['-crf', String(o.crf ?? 10), '-b:v', '4M']), '-c:a', 'libopus', '-b:a', '128k']
  return [...f, '-c:v', 'libx264', '-preset', 'veryfast', ...(vbitrate ? rate : ['-crf', String(o.crf ?? 23)]), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${o.audioKbps ?? 128}k`, ...(o.format === 'mkv' ? [] : ['-movflags', '+faststart'])]
}

// Never upscale: `min(ih, H)`, width follows and stays even.
const scaleTo = (h?: number) => (h ? [`scale=-2:'min(ih,${h})'`] : [])

// Rough H.264 bitrates (kbps) at crf 23; each 6 crf steps halves or doubles it.
const BASE_KBPS: Record<number, number> = { 2160: 14000, 1440: 8000, 1280: 2600, 1080: 4500, 720: 2500, 480: 1200, 360: 800 }
const videoKbps = (h: number, crf = 23) => (BASE_KBPS[h] ?? 4500) * 2 ** ((23 - crf) / 6)
const bytes = (kbps: number, secs?: number) => (secs ? (kbps * 1000 * secs) / 8 : undefined)
const audioOnly = (o: Opts) => ({ wav: 1411, flac: 900 })[o.format ?? ''] ?? o.audioKbps ?? 192
const len = (o: Opts, ctx: Ctx) => (ctx.duration ? Math.max(0, Math.min(o.length ?? Infinity, ctx.duration - (o.start ?? 0))) : undefined)

/** Video bitrate that lands the file under the target size, leaving room for audio. */
export function targetKbps(targetMB: number, secs: number, audioKbps = 96) {
  return Math.max(150, Math.floor(((targetMB * 8 * 1000 * 0.94) / secs) - audioKbps))
}

// --- the presets ------------------------------------------------------------------------

const AUDIO_FORMATS = ['mp3', 'm4a', 'ogg', 'opus']
const VIDEO_FORMATS = ['mp4', 'mov', 'mkv', 'webm']

export const presets: Preset[] = [
  {
    id: 'mp3',
    title: 'Audio only',
    icon: 'audio',
    kinds: ['video', 'audio'],
    engine: 'ffmpeg',
    defaults: { format: 'mp3', audioKbps: 192, sampleRate: 0, channels: 0 },
    fields: ['format', 'audioKbps', 'sampleRate', 'channels'],
    formats: AUDIO_FORMATS,
    args: (i, o, opts) => ['-i', i, '-vn', '-map_metadata', '0', ...audioArgs(opts), o],
    estimate: (o, c) => bytes(audioOnly(o), c.duration),
  },
  {
    id: 'studio',
    title: 'Studio quality',
    icon: 'studio',
    kinds: ['video', 'audio'],
    engine: 'ffmpeg',
    defaults: { format: 'flac', sampleRate: 0, channels: 0 },
    fields: ['format', 'sampleRate', 'channels'],
    formats: ['flac', 'wav'],
    args: (i, o, opts) => ['-i', i, '-vn', '-map_metadata', '0', ...audioArgs(opts), o],
    estimate: (o, c) => bytes(audioOnly(o), c.duration),
  },
  {
    id: 'shrink',
    title: 'Shrink to a size',
    icon: 'shrink',
    kinds: ['video', 'audio'],
    engine: 'ffmpeg',
    askFirst: true,
    reencode: true,
    defaults: { targetMB: 25 },
    fields: ['targetMB'],
    args: (i, o, opts, c) => {
      const secs = c.duration ?? 60
      if (c.kind === 'audio') {
        const k = Math.max(32, Math.min(320, Math.floor((opts.targetMB! * 8000 * 0.95) / secs)))
        return ['-i', i, '-vn', ...audioArgs({ format: 'mp3', audioKbps: k }), o]
      }
      const audio = secs > 1200 ? 64 : 96
      // Cap: a big target on a short clip asks x264 for huge buffers (wasm runs out of memory).
      const vb = Math.min(8000, targetKbps(opts.targetMB!, secs, audio))
      // Low bitrates look awful at 1080p; drop resolution to keep it watchable.
      const h = vb < 500 ? 360 : vb < 900 ? 480 : vb < 1800 ? 720 : 1080
      return ['-i', i, ...videoArgs({ format: 'mp4', audioKbps: audio }, scaleTo(h), vb), o]
    },
    estimate: (o) => (o.targetMB ? o.targetMB * 1e6 * 0.94 : undefined),
  },
  {
    id: 'gif',
    title: 'Make a GIF',
    icon: 'gif',
    kinds: ['video'],
    engine: 'ffmpeg',
    defaults: { format: 'gif', start: 0, length: 6, fps: 12, height: 360 },
    fields: ['start', 'length', 'fps', 'height'],
    args: (i, o, opts) => [
      ...clip(opts), '-i', i,
      '-vf', `fps=${opts.fps ?? 12},scale=-2:'min(ih,${opts.height ?? 360})':flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
      '-loop', '0', o,
    ],
    // Very rough: GIF size depends a lot on motion.
    estimate: (o, c) => ((o.height ?? 360) / 360) ** 2 * (o.fps ?? 12) * (len(o, c) ?? o.length ?? 6) * 22_000,
  },
  {
    id: 'phone',
    title: 'Phone-friendly video',
    icon: 'phone',
    kinds: ['video'],
    engine: 'ffmpeg',
    reencode: true,
    defaults: { format: 'mp4', height: 1080, crf: 23, fps: 0 },
    fields: ['format', 'height', 'crf', 'fps'],
    formats: VIDEO_FORMATS,
    args: (i, o, opts) => ['-i', i, ...videoArgs(opts, scaleTo(opts.height)), o],
    estimate: (o, c) => bytes(videoKbps(o.height || 1080, o.crf) + 128, c.duration),
  },
  {
    id: 'vertical',
    title: 'TikTok / Reels vertical',
    icon: 'vertical',
    kinds: ['video'],
    engine: 'ffmpeg',
    reencode: true,
    defaults: { format: 'mp4', fit: 'blur', height: 1280, crf: 23 },
    fields: ['fit', 'height', 'crf'],
    args: (i, o, opts) => {
      const even = (n: number) => Math.round(n / 2) * 2
      const h = opts.height ?? 1280
      const w = even((h * 9) / 16)
      const [bw, bh] = [even(w / 4), even(h / 4)] // blur a small copy: much faster in wasm
      const vf =
        opts.fit === 'crop'
          ? [`crop='min(iw,ih*9/16)':'min(ih,iw*16/9)'`, `scale=${w}:${h}`]
          : [`split[a][b];[a]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=8,scale=${w}:${h}[bg];[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`]
      return ['-i', i, ...videoArgs({ ...opts, format: 'mp4' }, vf), o]
    },
    estimate: (o, c) => bytes(videoKbps(1280, o.crf) * ((o.height ?? 1280) / 1280) ** 2 + 128, c.duration),
  },
  {
    id: 'frames',
    title: 'Extract frames',
    icon: 'frames',
    kinds: ['video'],
    engine: 'ffmpeg',
    defaults: { format: 'zip', every: 1, height: 1080 },
    fields: ['every', 'height'],
    // ffmpeg.wasm hangs writing JPG sequences, so frames come out as WEBP; convertOne turns them into JPGs.
    args: (i, o, opts) => ['-i', i, '-an', '-vf', `fps=1/${opts.every ?? 1},${scaleTo(opts.height)[0] ?? 'null'}`, '-c:v', 'libwebp', '-quality', '92', '-frames:v', '300', o],
    estimate: (o, c) => (c.duration ? Math.min(300, c.duration / (o.every ?? 1)) * ((o.height ?? 1080) / 1080) ** 2 * 250_000 : undefined),
  },
  {
    id: 'ringtone',
    title: 'Ringtone',
    icon: 'ring',
    kinds: ['video', 'audio'],
    engine: 'ffmpeg',
    defaults: { format: /iPhone|iPad|Mac/.test(globalThis.navigator?.userAgent ?? '') ? 'm4r' : 'mp3', start: 0, length: 30, audioKbps: 192 },
    fields: ['format', 'start', 'length'],
    formats: ['m4r', 'mp3'],
    args: (i, o, opts) => {
      const l = Math.min(40, opts.length ?? 30) // iPhone ringtones max out at 40 s
      return [...clip({ ...opts, length: l }), '-i', i, '-vn', '-af', `afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, l - 2)}:d=2`, ...audioArgs(opts), o]
    },
    estimate: (o) => bytes(o.audioKbps ?? 192, Math.min(40, o.length ?? 30)),
    guide: (o) =>
      o.format === 'm4r'
        ? 'iPhone: on a Mac, connect your iPhone, open it in Finder and drag the .m4r onto it. Then Settings → Sounds & Haptics → Ringtone.'
        : 'Android: save it, then Settings → Sound → Phone ringtone → pick the file.',
  },
  {
    id: 'image',
    title: 'Convert image',
    icon: 'image',
    kinds: ['image'],
    engine: 'image',
    defaults: { format: 'jpg', quality: 0.9, maxSide: 0 },
    fields: ['format', 'quality', 'maxSide', 'rename'],
    formats: ['jpg', 'png', 'webp'],
  },
  {
    id: 'resize',
    title: 'Resize image',
    icon: 'image',
    kinds: ['image'],
    engine: 'image',
    defaults: { format: 'jpg', quality: 0.9, size: 'p50' },
    fields: ['size', 'format', 'rename'],
    formats: ['jpg', 'png', 'webp'],
  },
  {
    id: 'compress',
    title: 'Compress image',
    icon: 'shrink',
    kinds: ['image'],
    engine: 'image',
    // JPG only: Safari can't encode WEBP from a canvas, so a WEBP size target couldn't be met there.
    defaults: { format: 'jpg', targetKB: 250 },
    fields: ['targetKB', 'rename'],
    estimate: (o) => (o.targetKB ? o.targetKB * 1000 * 0.95 : undefined),
  },
  {
    id: 'cutout',
    title: 'Remove background',
    icon: 'cutout',
    kinds: ['image'],
    engine: 'cutout',
    defaults: { format: 'png', bg: 'none' },
    fields: ['bg', 'rename'],
    guide: () => 'Made for photos of people: selfies, portraits, profile pictures.',
  },
]

/** Fill a rename pattern: {name} original name, {n} position in the batch (zero-padded), {date} today. */
export function renamed(pattern: string | undefined, original: string, ctx: Ctx): string {
  if (!pattern?.trim()) return original
  const width = String(ctx.count ?? 1).length
  const date = new Date().toISOString().slice(0, 10)
  return pattern.trim().replace(/\{name\}/g, original).replace(/\{n\}/g, String(ctx.index ?? 1).padStart(width, '0')).replace(/\{date\}/g, date).replace(/[\\/:*?"<>|]/g, '-') || original
}

const EXT_KIND: Record<string, Kind> = {
  mp4: 'video', mov: 'video', m4v: 'video', mkv: 'video', webm: 'video', avi: 'video', '3gp': 'video',
  mp3: 'audio', m4a: 'audio', aac: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', opus: 'audio', aiff: 'audio', caf: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', heic: 'image', heif: 'image', gif: 'image', avif: 'image', bmp: 'image',
}
/** Video, audio or image, by MIME type or (when the browser gives none, e.g. HEIC) the extension. */
export function kindOf(file: File): Kind | undefined {
  const t = file.type.split('/')[0]
  if (t === 'video' || t === 'audio' || t === 'image') return t
  return EXT_KIND[file.name.split('.').pop()?.toLowerCase() ?? '']
}
export const isHeic = (file: File) => /\.hei[cf]$/i.test(file.name) || /image\/hei[cf]/.test(file.type)

/** Presets that make sense for this file, best first. HEIC goes straight to JPG. */
export const presetsFor = (kind: Kind) => presets.filter((p) => p.kinds.includes(kind))

/** Seconds a re-encode will take on this device (measured: iPhone 0.55×, Mac 0.77× real time at 1080p). */
export function timeEstimate(p: Preset, o: Opts, ctx: Ctx): number | undefined {
  if (!p.reencode || !ctx.duration || ctx.kind !== 'video') return undefined
  const phone = globalThis.matchMedia?.('(pointer: coarse)').matches
  const speed1080 = phone ? 0.55 : 0.75
  const id = p.baseId ?? p.id
  const h = id === 'shrink' ? 720 : o.height || 1080
  const pixels = id === 'vertical' ? (h * h * 9) / 16 : (h * h * 16) / 9
  const speed = speed1080 * ((1920 * 1080) / pixels) ** 0.85
  return (len(o, ctx) ?? ctx.duration) / Math.min(speed, 8)
}
