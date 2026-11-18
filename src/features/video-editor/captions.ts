// Caption data. Words keep their time in the *source* file, so later cuts, speed changes or
// reverse never invalidate a transcript: we map to the output timeline only when showing or
// exporting.
import { editLength, starts, type Seg } from '../audio-editor/model'

export type Word = { text: string; from: number; to: number }
/** A caption line: words [a, b). */
export type Line = { a: number; b: number }

const MAX_CHARS = 32
const MAX_GAP = 0.7
const MAX_SECS = 3.5

/** Group words into short lines that read well on a phone. */
export function captionLines(words: Word[]): Line[] {
  const lines: Line[] = []
  let a = 0
  let chars = 0
  words.forEach((w, i) => {
    if (i > a) {
      const prev = words[i - 1]
      const len = chars + 1 + w.text.trim().length
      if (len > MAX_CHARS || w.from - prev.to > MAX_GAP || /[.?!]$/.test(prev.text.trim()) || w.to - words[a].from > MAX_SECS) {
        lines.push({ a, b: i })
        a = i
        chars = 0
      }
    }
    chars += (chars ? 1 : 0) + w.text.trim().length
  })
  if (words.length) lines.push({ a, b: words.length })
  return lines
}

/** Loudness per 20 ms frame, and the level under which a frame counts as silence. */
function loudness(audio: Float32Array, rate: number) {
  const hop = Math.round(rate * 0.02)
  const rms = Float32Array.from({ length: Math.floor(audio.length / hop) }, (_, f) => {
    let s = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) s += audio[i] * audio[i]
    return Math.sqrt(s / hop)
  })
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(rms.length * 0.9)] ?? 0
  return { rms, floor: Math.max(0.003, loud * 0.05) } // about -26 dB under the clip's loud parts
}

/**
 * Whisper often stamps the last word before a pause seconds into the silence. A word whose span holds no
 * speech moves back to the end of the speech just before it; with no speech in the 3 s before, it was
 * made up in the silence and is dropped. `audio` is mono at `rate` Hz, starting at time 0.
 */
export function snapToSpeech(words: Word[], audio: Float32Array, rate: number): Word[] {
  const { rms, floor } = loudness(audio, rate)
  const frame = (t: number) => Math.min(rms.length - 1, Math.max(0, Math.floor(t / 0.02)))
  const speechIn = (a: number, b: number) => {
    for (let f = frame(a); f <= frame(b); f++) if (rms[f] > floor) return true
    return false
  }
  const out: Word[] = []
  for (const w of words) {
    if (!rms.length || speechIn(w.from, w.to)) {
      out.push(w)
      continue
    }
    let f = frame(w.from)
    const stop = frame(w.from - 3)
    while (f > stop && rms[f] <= floor) f--
    if (f <= stop) continue
    const end = (f + 1) * 0.02
    out.push({ ...w, from: Math.min(end, Math.max(out.at(-1)?.from ?? 0, end - Math.min(0.4, w.to - w.from))), to: end })
  }
  return out
}

/**
 * The stretches with sound, in seconds from the start of `audio`: pauses of `minGap` or longer are left
 * out, and `pad` seconds are kept on each side of the sound so words aren't clipped.
 */
export function speechRanges(audio: Float32Array, rate: number, minGap = 0.6, pad = 0.12): [number, number][] {
  const { rms, floor } = loudness(audio, rate)
  const runs: [number, number][] = []
  for (let f = 0; f < rms.length; f++) {
    if (rms[f] <= floor) continue
    const last = runs.at(-1)
    if (last && f * 0.02 - last[1] < minGap) last[1] = (f + 1) * 0.02
    else runs.push([f * 0.02, (f + 1) * 0.02])
  }
  const end = rms.length * 0.02
  const out: [number, number][] = []
  for (const [a, b] of runs) {
    const r: [number, number] = [Math.max(0, a - pad), Math.min(end, b + pad)]
    const last = out.at(-1)
    if (last && r[0] <= last[1]) last[1] = r[1]
    else out.push(r)
  }
  return out
}

export const lineText = (words: Word[], l: Line) => words.slice(l.a, l.b).map((w) => w.text.trim()).join(' ')

/** Replace a line's text. Same word count keeps the timing; otherwise spread it evenly. */
export function editLine(words: Word[], l: Line, text: string): Word[] {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  const old = words.slice(l.a, l.b)
  let next: Word[]
  if (parts.length === old.length) next = old.map((w, i) => ({ ...w, text: parts[i] }))
  else {
    const from = old[0].from
    const step = (old[old.length - 1].to - from) / Math.max(1, parts.length)
    next = parts.map((p, i) => ({ text: p, from: from + i * step, to: from + (i + 1) * step }))
  }
  return [...words.slice(0, l.a), ...next, ...words.slice(l.b)]
}

type Timing = { segs: Seg[]; speed: number; reverse: boolean }

/** Source time to output time, or null if that moment was cut. */
export function outTime(st: Timing, src: number): number | null {
  const s0 = starts(st.segs)
  const i = st.segs.findIndex((s) => src >= s.from && src < s.to)
  if (i < 0) return null
  const e = s0[i] + src - st.segs[i].from
  return (st.reverse ? editLength(st.segs) - e : e) / st.speed
}

export type TimedWord = { text: string; from: number; to: number }
export type TimedLine = { text: string; from: number; to: number; line: Line; words: TimedWord[] }

/** Lines and their words on the output timeline. Words that were cut away are dropped. */
export function timedLines(words: Word[], st: Timing): TimedLine[] {
  return captionLines(words).flatMap((line) => {
    const tw = words.slice(line.a, line.b).flatMap((w) => {
      const a = outTime(st, w.from)
      if (a === null) return []
      const b = outTime(st, Math.max(w.from, w.to - 0.001)) ?? a + 0.3 / st.speed
      return [{ text: w.text.trim(), from: Math.min(a, b), to: Math.max(a, b) }]
    })
    if (!tw.length) return []
    tw.sort((x, y) => x.from - y.from)
    return [{ text: tw.map((w) => w.text).join(' '), from: tw[0].from, to: Math.max(...tw.map((w) => w.to)), line, words: tw }]
  })
}

/** Index of the word being spoken at output time `t` (it stays lit until the next word starts). */
export const activeWord = (l: TimedLine, t: number) => {
  let i = -1
  l.words.forEach((w, k) => t >= w.from && (i = k))
  return i
}

const stamp = (t: number) => {
  const ms = Math.round(t * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
}

export function toSrt(words: Word[], st: Timing): string {
  return timedLines(words, st)
    .sort((x, y) => x.from - y.from)
    .map((l, i) => `${i + 1}\n${stamp(l.from)} --> ${stamp(l.to)}\n${l.text}\n`)
    .join('\n')
}

// --- burned-in captions: an ASS subtitle file that ffmpeg's libass draws -------------------

export type CaptionStyle = 'plain' | 'highlight' | 'pop' | 'karaoke'
export const CAPTION_STYLES: Record<CaptionStyle, string> = { plain: 'Plain', highlight: 'Word highlight', pop: 'Pop', karaoke: 'Karaoke' }

/** Shared look, so the preview overlay and libass draw the same thing (sizes relative to the frame). */
export const CAPTION_LOOK = { font: 'Inter ExtraBold', size: 0.095, outline: 0.08, shadow: 0.04, marginV: 0.12, marginH: 0.06, hl: '#FFD43B' }
/** libass sizes a font by its Windows line height (OS/2 winAscent + winDescent), 1.43 em for Inter; CSS sizes by the em. */
export const ASS_EM = 1.43

const assColor = (hex: string) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase()
const WHITE = '&H00FFFFFF'
const HL = assColor(CAPTION_LOOK.hl)
const clean = (t: string) => t.replace(/[{}]/g, '').replace(/\\/g, '/')
const at = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100))
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

export function toAss(lines: TimedLine[], style: CaptionStyle, w: number, h: number): string {
  const L = CAPTION_LOOK
  const size = Math.round(Math.min(w, h) * L.size)
  // Karaoke: sung words turn primary (highlight), unsung stay secondary (white).
  const [primary, secondary] = style === 'karaoke' ? [HL, WHITE] : [WHITE, WHITE]
  const head = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${w}`, `PlayResY: ${h}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${L.font},${size},${primary},${secondary},&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${Math.round(size * L.outline)},${Math.round(size * L.shadow)},2,${Math.round(w * L.marginH)},${Math.round(w * L.marginH)},${Math.round(h * L.marginV)},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ]
  const ev = (a: number, b: number, text: string) => `Dialogue: 0,${at(a)},${at(b)},Default,,0,0,0,,${text}`
  const events = lines.flatMap((l) => {
    const ws = l.words.map((x) => clean(x.text))
    if (style === 'plain') return [ev(l.from, l.to, ws.join(' '))]
    if (style === 'karaoke') {
      const cs = (s: number) => Math.max(1, Math.round(s * 100))
      const gap = l.words[0].from - l.from
      const body = ws.map((x, i) => `{\\kf${cs((l.words[i + 1]?.from ?? l.to) - l.words[i].from)}}${x}`).join(' ')
      return [ev(l.from, l.to, `${gap > 0.005 ? `{\\k${cs(gap)}}` : ''}${body}`)]
    }
    // highlight / pop: one event per word, the current word lit (and popping).
    return ws.map((_, i) => {
      const a = i === 0 ? l.from : l.words[i].from
      const b = l.words[i + 1]?.from ?? l.to
      const lit = style === 'pop' ? `{\\c${HL}\\fscx125\\fscy125\\t(0,150,\\fscx100\\fscy100)}` : `{\\c${HL}}`
      return ev(a, b, ws.map((x, k) => (k === i ? `${lit}${x}{\\r}` : x)).join(' '))
    })
  })
  return [...head, ...events, ''].join('\n')
}
