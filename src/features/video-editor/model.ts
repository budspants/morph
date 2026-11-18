// The video editor's document. Reuses the audio editor's timeline maths (pieces of a
// source placed end to end) and its undo history; video adds only what it needs on top.
import { EngineError, runJob } from '../../engine/ffmpeg'
import { targetKbps } from '../convert/presets'
import { editLength, starts, type Seg } from '../audio-editor/model'
import { outTime, type CaptionStyle, type Word } from './captions'
import { ffLook, type LookId } from './looks'
import type { Overlay } from './overlays'

export type Aspect = 'original' | '9:16' | '1:1' | '4:5' | '16:9'
export type Rotation = 0 | 90 | 180 | 270

export type VideoState = {
  segs: Seg[]
  aspect: Aspect
  /** fill: crop to fill the frame. blur: show all of it over a blurred copy. */
  fit: 'fill' | 'blur'
  /** Which part stays in frame when cropping, 0–1 per axis (0.5 = centre). In output orientation. */
  pos: [number, number]
  /** "Follow face": where the face is over time (fill crops, no rotation). Overrides pos[0]. */
  track: TrackPoint[] | null
  rotate: Rotation
  flip: boolean
  speed: number
  reverse: boolean
  look: LookId
  /** Transcript in source seconds; empty = no captions. */
  words: Word[]
  captionStyle: CaptionStyle
  /** Draw the captions into the picture on export. */
  burn: boolean
  overlays: Overlay[]
  /** Original sound level, 0–1 (0 = muted, e.g. replaced by music). */
  origVol: number
  /** Reduce background noise (hiss, hum, rumble) in the original sound on export. */
  cleanVoice: boolean
  /** Added music (the file itself lives outside the undo history). */
  music: Music | null
  /** Export: cap on the frame's shorter side (0 = full size). */
  maxShort: number
  /** Export: frames per second (0 = same as the source). */
  fps: number
  quality: Quality
  /** Export: fit under this many MB (0 = use `quality`). */
  targetMB: number
}

export type Quality = 'high' | 'standard' | 'small'
const CRF: Record<Quality, number> = { high: 18, standard: 23, small: 28 }

export type Music = {
  name: string
  vol: number
  /** Seconds into the song where the video starts. */
  start: number
  /** Turn the music down while the original sound is playing. */
  duck: boolean
}

/** Sidechain settings shared with the preview's live ducking, so both dip the music alike. */
export const DUCK = { threshold: 0.02, ratio: 10, attackMs: 15, releaseMs: 350, previewGain: 0.3 }

export const initialVideo = (duration: number): VideoState => ({
  segs: [{ src: 0, from: 0, to: duration }],
  aspect: 'original',
  fit: 'fill',
  pos: [0.5, 0.5],
  track: null,
  rotate: 0,
  flip: false,
  speed: 1,
  reverse: false,
  look: 'none',
  words: [],
  captionStyle: 'highlight',
  burn: true,
  overlays: [],
  origVol: 1,
  cleanVoice: false,
  music: null,
  maxShort: 0,
  fps: 0,
  quality: 'standard',
  targetMB: 0,
})

/** A text/sticker PNG mounted next to the input, its top-left pixel position, and output seconds. */
export type PlacedOverlay = { path: string; x: number; y: number; from: number; to: number }

/** Reverse buffers every frame it reverses, so the export reverses short chunks one at a time. */
export const MAX_REVERSE = 60
const CHUNK = 2

/** Voice cleanup: cut rumble under 80 Hz, then FFT noise reduction (24 dB, noise floor -35 dB; noise tracking made it weaker in tests). */
export const CLEAN_VOICE = 'highpass=f=80,afftdn=nr=24:nf=-35'

/** atempo takes 0.5–2 per step in some builds: chain steps for anything outside that. */
function atempo(speed: number): string[] {
  const out: string[] = []
  let s = speed
  for (; s > 2; s /= 2) out.push('atempo=2')
  for (; s < 0.5; s /= 0.5) out.push('atempo=0.5')
  if (Math.abs(s - 1) > 1e-3) out.push(`atempo=${s.toFixed(4)}`)
  return out
}

// Social-media sizes: 1080 wide (1920 for landscape).
export const ASPECTS: Record<Exclude<Aspect, 'original'>, [number, number]> = {
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '16:9': [1920, 1080],
}

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2)

/** Output width and height. `src` is the source size as stored (before rotation). */
export function outSize(st: VideoState, src: [number, number]): [number, number] {
  const [w, h] = st.aspect !== 'original' ? ASPECTS[st.aspect] : st.rotate % 180 ? [src[1], src[0]] : src
  const k = st.maxShort && Math.min(w, h) > st.maxShort ? st.maxShort / Math.min(w, h) : 1
  return [even(w * k), even(h * k)]
}

const audioKbps = (st: VideoState) => (st.targetMB ? 96 : 128)
export const outDuration = (st: VideoState) => editLength(st.segs) / st.speed

/** Video bitrate for a target size (capped: huge targets on short clips exhaust wasm memory). */
const sizeKbps = (st: VideoState, audio: boolean) => Math.min(8000, targetKbps(st.targetMB, Math.max(0.5, outDuration(st)), audio ? audioKbps(st) : 0))

/** For a size target, drop the resolution when the bitrate is too low to look good at full size. */
export function withAutoRes(st: VideoState, audio: boolean): VideoState {
  if (!st.targetMB) return st
  const vb = sizeKbps(st, audio)
  const short = vb < 500 ? 360 : vb < 900 ? 480 : vb < 1800 ? 720 : 0
  return short && (!st.maxShort || short < st.maxShort) ? { ...st, maxShort: short } : st
}

/** Rough output size (bytes) and encode time (seconds) for the confirm line under Export. */
export function estimate(st: VideoState, src: [number, number], audio: boolean, phone: boolean): { bytes: number; seconds: number } {
  const [w, h] = outSize(st, src)
  const px = (w * h) / (1920 * 1080)
  const secs = outDuration(st)
  const ak = audio || st.music ? audioKbps(st) : 0
  const vk = st.targetMB ? sizeKbps(st, audio) : 4500 * px ** 0.75 * 2 ** ((23 - CRF[st.quality]) / 6)
  // Measured: libx264 veryfast at 1080p runs about 0.55x realtime on iPhone, 0.6-0.8x on a Mac; time follows pixels.
  const speed = (phone ? 0.55 : 0.6) / Math.max(0.15, px)
  return { bytes: ((vk + ak) * 1000 * secs) / 8, seconds: secs / speed }
}

/** ffmpeg video filters for rotate / flip / frame, from the joined clip `inp` to `[v]`. */
/** A face position: source seconds, and the face centre as a fraction of the source width. */
export type TrackPoint = { t: number; x: number }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const following = (st: VideoState) => !!st.track?.length && st.aspect !== 'original' && st.fit === 'fill' && st.rotate === 0

/** The crop offset (0–1, like pos[0]) that puts a face at source-width fraction `cx` in the middle of the frame. */
export function cropFor(st: VideoState, src: [number, number], cx: number): number {
  const [W, H] = outSize(st, src)
  const sw = src[0] * Math.max(W / src[0], H / src[1]) // width after scale=…:force_original_aspect_ratio=increase
  if (sw - W < 1) return 0.5
  return clamp01(((st.flip ? 1 - cx : cx) * sw - W / 2) / (sw - W))
}

/** Face position at source time `t`, straight lines between track points. */
export function trackAt(track: TrackPoint[], t: number): number {
  const i = track.findIndex((p) => p.t > t)
  if (i === 0) return track[0].x
  if (i < 0) return track[track.length - 1].x
  const [a, b] = [track[i - 1], track[i]]
  return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t)
}

/** The crop's x as an ffmpeg expression of output time: the track mapped through cuts, speed and reverse. */
function trackExpr(st: VideoState, src: [number, number], W: number): string {
  const pts = st.track!
    .map((p) => [outTime(st, p.t), cropFor(st, src, p.x)] as const)
    .filter((p): p is [number, number] => p[0] !== null)
    .sort((a, b) => a[0] - b[0])
  if (!pts.length) return `(iw-${W})*${st.pos[0].toFixed(3)}`
  let e = pts[pts.length - 1][1].toFixed(4)
  for (let i = pts.length - 1; i > 0; i--) {
    const [[t0, a], [t1, b]] = [pts[i - 1], pts[i]]
    e = t1 - t0 < 1e-3 ? e : `if(lt(t,${t1.toFixed(3)}),${a.toFixed(4)}+${(b - a).toFixed(4)}*(t-${t0.toFixed(3)})/${(t1 - t0).toFixed(3)},${e})`
  }
  return `(iw-${W})*if(lt(t,${pts[0][0].toFixed(3)}),${pts[0][1].toFixed(4)},${e})`
}

export function frameFilter(st: VideoState, src: [number, number], inp: string): string {
  const turn = { 0: [], 90: ['transpose=1'], 180: ['hflip', 'vflip'], 270: ['transpose=2'] }[st.rotate]
  const pre = [...turn, ...(st.flip ? ['hflip'] : [])]
  const [W, H] = outSize(st, src)
  const head = pre.length ? `${inp}${pre.join(',')}` : inp
  if (st.aspect === 'original') return `${head}${pre.length ? ',' : ''}scale=${W}:${H},setsar=1[v]`
  if (st.fit === 'fill') {
    const [x, y] = st.pos
    // Single quotes keep the expression's commas from splitting the filter graph.
    const cx = following(st) ? `'${trackExpr(st, src, W)}'` : `(iw-${W})*${x.toFixed(3)}`
    return `${head}${pre.length ? ',' : ''}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:${cx}:(ih-${H})*${y.toFixed(3)},setsar=1[v]`
  }
  // Blur a small copy, then scale it up: much faster in wasm than blurring at full size.
  const [bw, bh] = [even(W / 4), even(H / 4)]
  return (
    `${head}${pre.length ? ',' : ''}split[fa][fb];` +
    `[fa]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=8,scale=${W}:${H}[bg];` +
    `[fb]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v]`
  )
}

/** Where edit-timeline time `t` falls: piece index and the matching time in the source. */
export function locate(segs: Seg[], t: number): { i: number; src: number } {
  const st = starts(segs)
  let i = segs.length - 1
  while (i > 0 && t < st[i]) i--
  const s = segs[i]
  return { i, src: Math.min(s.to, Math.max(s.from, s.from + t - st[i])) }
}

/** ffmpeg prints the streams of any file it opens; we only need to know if there's audio. */
export async function hasAudio(file: File): Promise<boolean> {
  try {
    await runJob(file, 'probe.txt', (i) => ['-hide_banner', '-i', i], () => {}).result
  } catch (err) {
    if (err instanceof EngineError) return /Stream #.*Audio:/.test(err.log)
    throw err
  }
  return false
}

const n = (x: number) => x.toFixed(3)

/**
 * One input per piece, each seeked straight to its start (fast even deep into a long file),
 * then joined. Re-encodes, so cuts land on the exact frame rather than the nearest keyframe.
 */
/** `subs`: an ASS file and the folder holding its fonts, both mounted next to the input. */
export function exportArgs(st: VideoState, src: [number, number], input: string, output: string, audio: boolean, subs?: { ass: string; fontsdir: string }, overlays: PlacedOverlay[] = [], musicPath?: string): string[] {
  // Reversed: cut the timeline into short chunks, reverse each, and join them last-to-first.
  const pieces = st.reverse
    ? st.segs
        .flatMap((s) => {
          // Equal chunks of about CHUNK seconds: no sliver too short to hold a frame.
          const count = Math.max(1, Math.round((s.to - s.from) / CHUNK))
          const len = (s.to - s.from) / count
          return Array.from({ length: count }, (_, k) => ({ from: s.from + k * len, to: s.from + (k + 1) * len }))
        })
        .reverse()
    : st.segs
  const ins = pieces.flatMap((s) => ['-ss', n(s.from), '-t', n(s.to - s.from), '-i', input])
  const rev = st.reverse
    ? pieces.map((_, k) => `[${k}:v:0]reverse[rv${k}];${audio ? `[${k}:a:0]areverse[ra${k}];` : ''}`).join('')
    : ''
  const pads = pieces.map((_, k) => (st.reverse ? `[rv${k}]${audio ? `[ra${k}]` : ''}` : `[${k}:v:0]${audio ? `[${k}:a:0]` : ''}`)).join('')
  const vpre = [...(st.speed !== 1 ? [`setpts=PTS/${st.speed}`] : []), ...(st.fps ? [`fps=${st.fps}`] : []), ...ffLook(st.look)]
  const apre = atempo(st.speed)
  const graph =
    `${rev}${pads}concat=n=${pieces.length}:v=1:a=${audio ? 1 : 0}[cv]${audio ? (apre.length ? '[ca]' : '[a]') : ''};` +
    (audio && apre.length ? `[ca]${apre.join(',')}[a];` : '') +
    (vpre.length ? `[cv]${vpre.join(',')}[pv];${frameFilter(st, src, '[pv]')}` : frameFilter(st, src, '[cv]')).replace(/\[v\]$/, '[f0]')
  // Then text/stickers (each a PNG input, shown only in its time range), then captions on top.
  const post = overlays.map((o, k) => `[f${k}][${pieces.length + k}:v]overlay=${o.x}:${o.y}:enable='between(t,${o.from.toFixed(3)},${o.to.toFixed(3)})'[f${k + 1}]`)
  const last = `f${overlays.length}`
  const tail = subs ? `;[${last}]ass=filename=${subs.ass}:fontsdir=${subs.fontsdir}[v]` : `;[${last}]null[v]`

  // Sound: the original (after cuts/speed) at its level, plus music that loops to fill the video,
  // optionally ducked under the original. The concat above names the original track [a].
  const music = st.music && musicPath ? st.music : null
  const outDur = (editLength(st.segs) / st.speed).toFixed(3)
  const orig = audio && st.origVol > 0
  const mIn = pieces.length + overlays.length
  const snd: string[] = []
  if (audio) snd.push(orig ? `[a]${st.cleanVoice ? CLEAN_VOICE + ',' : ''}volume=${st.origVol.toFixed(2)}[ao]` : '[a]anullsink')
  if (music) {
    snd.push(`[${mIn}:a:0]atrim=duration=${outDur},asetpts=PTS-STARTPTS,volume=${music.vol.toFixed(2)}[am]`)
    if (orig && music.duck) {
      const d = DUCK
      snd.push(`[ao]asplit[ao1][key]`, `[am][key]sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attackMs}:release=${d.releaseMs}[amd]`, `[ao1][amd]amix=inputs=2:duration=first:normalize=0[mix]`)
    } else if (orig) snd.push(`[ao][am]amix=inputs=2:duration=first:normalize=0[mix]`)
    else snd.push(`[am]anull[mix]`)
  } else if (orig) snd.push(`[ao]anull[mix]`)
  const hasOut = orig || !!music
  const vb = st.targetMB ? sizeKbps(st, hasOut) : 0
  const rate = vb ? ['-b:v', `${vb}k`, '-maxrate', `${Math.round(vb * 1.3)}k`, '-bufsize', `${vb * 2}k`] : ['-crf', String(CRF[st.quality])]
  return [
    ...ins,
    ...overlays.flatMap((o) => ['-i', o.path]),
    ...(music ? ['-stream_loop', '-1', '-ss', music.start.toFixed(3), '-i', musicPath!] : []),
    '-filter_complex', [graph, ...post].join(';') + tail + snd.map((x) => `;${x}`).join(''),
    '-map', '[v]', ...(hasOut ? ['-map', '[mix]', '-c:a', 'aac', '-b:a', `${audioKbps(st)}k`] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', ...rate, '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', output,
  ]
}

/** Keep only the parts of each piece inside `ranges` (source seconds, shifted by `offset`). Order and source stay. */
export function keepRanges(segs: Seg[], ranges: [number, number][], offset = 0): Seg[] {
  const out = segs.flatMap((s) =>
    ranges
      .map(([a, b]) => [Math.max(s.from, a + offset), Math.min(s.to, b + offset)] as const)
      .filter(([a, b]) => b - a > 0.05)
      .map(([a, b]) => ({ src: s.src, from: a, to: b })),
  )
  return out.length ? out : segs
}
