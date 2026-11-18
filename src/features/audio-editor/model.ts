// The audio editor's document. The original audio is never touched: an edit is a new
// immutable snapshot of this state, so undo/redo is just moving through a list of them.
import { useCallback, useRef, useState } from 'react'

/** A piece of a source file placed on the timeline. `xfade`: seconds it overlaps the previous piece. */
export type Seg = { src: number; from: number; to: number; xfade?: number }

export type EffectId = 'none' | 'slowed' | 'sped' | 'nightcore' | '8d' | 'car' | 'underwater' | 'hall' | 'airpods'

export type EditState = {
  segs: Seg[]
  fadeIn: number
  fadeOut: number
  gainDb: number
  effect: EffectId
  speed: number
  keepPitch: boolean
  pitch: number // semitones
  eq: number[] // 5 bands, dB
  loudness: 0 | -14 | -16 // 0 = off, else target LUFS
  meta: { title: string; artist: string; album: string }
}

export const initialState = (duration: number, title: string): EditState => ({
  segs: [{ src: 0, from: 0, to: duration }],
  fadeIn: 0,
  fadeOut: 0,
  gainDb: 0,
  effect: 'none',
  speed: 1,
  keepPitch: true,
  pitch: 0,
  eq: [0, 0, 0, 0, 0],
  loudness: 0,
  meta: { title, artist: '', album: '' },
})

const segLen = (s: Seg) => s.to - s.from
/** Edit-timeline length in seconds (before speed changes). */
export const editLength = (segs: Seg[]) => segs.reduce((n, s, i) => n + segLen(s) - (i ? (s.xfade ?? 0) : 0), 0)

/** Timeline start of each segment. */
export function starts(segs: Seg[]): number[] {
  const out: number[] = []
  let t = 0
  segs.forEach((s, i) => {
    t -= i ? (s.xfade ?? 0) : 0
    out.push(t)
    t += segLen(s)
  })
  return out
}

const MIN = 0.01 // drop slivers shorter than 10 ms

/** Split pieces so that `t` is a boundary. */
export function splitAt(segs: Seg[], t: number): Seg[] {
  const st = starts(segs)
  return segs.flatMap((s, i) => {
    const local = t - st[i]
    if (local <= MIN || local >= segLen(s) - MIN) return [s]
    const cut = s.from + local
    return [{ ...s, to: cut }, { src: s.src, from: cut, to: s.to }]
  })
}

/** Remove [a, b] from the timeline; everything after slides left (ripple delete). */
export function cutRange(segs: Seg[], a: number, b: number): Seg[] {
  const split = splitAt(splitAt(segs, a), b)
  const st = starts(split)
  const kept = split.filter((s, i) => !(st[i] >= a - MIN && st[i] + segLen(s) <= b + MIN))
  return kept.length ? kept.map((s, i) => (i === 0 ? { ...s, xfade: undefined } : s)) : segs
}

/** Keep only [a, b]. */
export function keepRange(segs: Seg[], a: number, b: number): Seg[] {
  const total = editLength(segs)
  return cutRange(cutRange(segs, b, total), 0, a)
}

/** Remove whole pieces by index (multi-select delete). */
export function deleteSegs(segs: Seg[], idx: Set<number>): Seg[] {
  const kept = segs.filter((_, i) => !idx.has(i))
  return kept.length ? kept.map((s, i) => (i === 0 ? { ...s, xfade: undefined } : s)) : segs
}

/** Unlimited undo/redo. `merge` folds rapid changes (a slider drag) into one step. */
export function useHistory<T>(first: T) {
  const [h, setH] = useState({ past: [] as T[], now: first, future: [] as T[] })
  const lastMerge = useRef<{ key: string; at: number } | null>(null)

  const set = useCallback((next: T | ((cur: T) => T), merge?: string) => {
    const m = lastMerge.current
    const folding = !!merge && m?.key === merge && Date.now() - m.at < 800
    lastMerge.current = merge ? { key: merge, at: Date.now() } : null
    setH((cur) => {
      const value = typeof next === 'function' ? (next as (c: T) => T)(cur.now) : next
      if (value === cur.now) return cur
      return { past: folding ? cur.past : [...cur.past, cur.now], now: value, future: [] }
    })
  }, [])
  const undo = useCallback(() => {
    lastMerge.current = null
    setH((cur) => (cur.past.length ? { past: cur.past.slice(0, -1), now: cur.past[cur.past.length - 1], future: [cur.now, ...cur.future] } : cur))
  }, [])
  const redo = useCallback(() => {
    lastMerge.current = null
    setH((cur) => (cur.future.length ? { past: [...cur.past, cur.now], now: cur.future[0], future: cur.future.slice(1) } : cur))
  }, [])
  const reset = useCallback((value: T) => {
    lastMerge.current = null
    setH({ past: [], now: value, future: [] })
  }, [])

  return { state: h.now, set, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 }
}
