// The conversion queue (spec: batch queue). One file is just a queue of one.
// Files run one at a time: there is a single ffmpeg engine and phones have little memory.
import { useCallback, useRef, useState } from 'react'
import { EngineError } from '../../engine/ffmpeg'
import { convertOne, type Output, type Running } from './convertOne'
import { recordPick } from './prefs'
import { kindOf, type Ctx, type Opts, type Preset } from './presets'
import { probeDuration } from './probe'

export const MAX_FILES = 50

export type Choice = { preset: Preset; opts: Opts }
export type Item = {
  id: string
  file: File
  ctx: Ctx
  choice?: Choice
  status: 'waiting' | 'working' | 'done' | 'error'
  progress: number
  out?: Output
  error?: { title: string; fix: string }
  ms?: number
}

export function explain(err: unknown): { title: string; fix: string } {
  const log = err instanceof EngineError ? err.log : String(err)
  if (/does not contain any stream|matches no streams|Output file is empty|Output file #0 does not contain/i.test(log))
    return { title: 'That file has no sound.', fix: 'Try a video or audio file with audio in it.' }
  if (/Invalid data found|could not find codec|moov atom not found|decode|NotSupported|InvalidState/i.test(log))
    return { title: "Couldn't read that file.", fix: 'It may be damaged, or a format this device can’t open.' }
  if (/memory|out of bounds|RangeError/i.test(log))
    return { title: 'That file’s a bit chunky for this device.', fix: 'Try a shorter clip, a smaller size, or use a computer.' }
  if (/fetch|load|wasm/i.test(log))
    return { title: "The converter didn't start.", fix: 'Reload the page and try again.' }
  return { title: 'Something went wrong.', fix: 'Try again. If it keeps happening, try another file.' }
}

let seq = 0

export function useBatch(onDone?: (item: Item) => void) {
  const [items, setItemsState] = useState<Item[]>([])
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const ref = useRef<Item[]>([])
  const current = useRef<{ id: string; job: Running } | null>(null)
  const pausedRef = useRef(false)
  const workMs = useRef(0) // time spent on finished files, for the overall ETA
  const curStart = useRef(0)
  /** Milliseconds spent converting so far, including the file in progress. */
  const elapsed = useCallback(() => workMs.current + (current.current ? performance.now() - curStart.current : 0), [])

  const update = useCallback((fn: (list: Item[]) => Item[]) => {
    ref.current = fn(ref.current)
    setItemsState(ref.current)
  }, [])
  const patch = useCallback((id: string, p: Partial<Item>) => update((l) => l.map((it) => (it.id === id ? { ...it, ...p } : it))), [update])

  /** Adds files; returns how many were refused (unsupported type or over the limit). */
  const add = useCallback(
    (files: File[]) => {
      let refused = 0
      const fresh: Item[] = []
      for (const file of files) {
        const kind = kindOf(file)
        if (!kind || ref.current.length + fresh.length >= MAX_FILES) {
          refused++
          continue
        }
        fresh.push({ id: `f${++seq}`, file, ctx: { kind, size: file.size, name: file.name }, status: 'waiting', progress: 0 })
      }
      update((l) => [...l, ...fresh])
      for (const it of fresh)
        if (it.ctx.kind !== 'image') void probeDuration(it.file).then((duration) => duration && patch(it.id, { ctx: { ...it.ctx, duration } }))
      return refused
    },
    [update, patch],
  )

  const remove = useCallback((id: string) => update((l) => l.filter((it) => it.id !== id)), [update])
  const reorder = useCallback((ids: string[]) => update((l) => ids.map((id) => l.find((it) => it.id === id)!).filter(Boolean)), [update])
  const choose = useCallback(
    (pred: (it: Item) => boolean, choice: Choice | undefined) =>
      update((l) => l.map((it) => (pred(it) && it.status !== 'done' ? { ...it, choice } : it))),
    [update],
  )
  const clear = useCallback(() => {
    current.current?.job.cancel()
    current.current = null
    pausedRef.current = false
    setPaused(false)
    setRunning(false)
    workMs.current = 0
    update(() => [])
  }, [update])

  const start = useCallback(async () => {
    if (current.current) return
    pausedRef.current = false
    setPaused(false)
    setRunning(true)
    // Re-read the list every loop so reorders and removals during the run are respected.
    for (;;) {
      if (pausedRef.current) break
      const it = ref.current.find((i) => i.status === 'waiting' && i.choice)
      if (!it) break
      const { preset, opts } = it.choice!
      recordPick({ kind: it.ctx.kind, preset: preset.id, at: Date.now(), ext: it.file.name.split('.').pop()?.toLowerCase() ?? '' })
      patch(it.id, { status: 'working', progress: 0, error: undefined })
      const t0 = (curStart.current = performance.now())
      const ctx = { ...it.ctx, index: ref.current.findIndex((i) => i.id === it.id) + 1, count: ref.current.length } // for {n} in renames
      const job = convertOne(it.file, preset, opts, ctx, (progress) => patch(it.id, { progress }))
      current.current = { id: it.id, job }
      try {
        const out = await job.result
        if (current.current?.id !== it.id) continue // cancelled or paused meanwhile
        const ms = performance.now() - t0
        workMs.current += ms
        patch(it.id, { status: 'done', progress: 1, out, ms })
        onDone?.(ref.current.find((i) => i.id === it.id)!)
      } catch (err) {
        if (current.current?.id !== it.id || (err as Error).name === 'AbortError') continue
        console.error(err)
        patch(it.id, { status: 'error', error: explain(err) })
      } finally {
        if (current.current?.id === it.id) current.current = null
      }
    }
    setRunning(false)
  }, [patch, onDone])

  /** Pause stops the current file now; it starts over on resume. */
  const pause = useCallback(() => {
    pausedRef.current = true
    setPaused(true)
    const cur = current.current
    current.current = null
    if (cur) {
      cur.job.cancel()
      patch(cur.id, { status: 'waiting', progress: 0 })
    }
    setRunning(false)
  }, [patch])

  /** Stop now and go back to choosing: unfinished files lose their preset. */
  const stop = useCallback(() => {
    pausedRef.current = true
    const cur = current.current
    current.current = null
    cur?.job.cancel()
    update((l) => l.map((it) => (it.status === 'waiting' || it.status === 'working' ? { ...it, status: 'waiting', progress: 0, choice: undefined } : it)))
    setPaused(false)
    setRunning(false)
  }, [update])

  const retry = useCallback((id: string) => patch(id, { status: 'waiting', progress: 0, error: undefined }), [patch])
  /** Back to choosing a preset for this file. */
  const reset = useCallback((id: string) => patch(id, { status: 'waiting', progress: 0, error: undefined, choice: undefined }), [patch])

  return { items, running, paused, add, remove, reorder, choose, clear, start, pause, stop, retry, reset, elapsed }
}

/** Seconds left for the whole queue, from the speed so far (media seconds per second). */
export function batchEta(items: Item[], workMs: number): number | undefined {
  const weight = (it: Item) => it.ctx.duration ?? 2
  let done = 0
  let left = 0
  for (const it of items) {
    if (!it.choice) continue
    if (it.status === 'done') done += weight(it)
    else if (it.status === 'working') {
      done += weight(it) * it.progress
      left += weight(it) * (1 - it.progress)
    } else if (it.status === 'waiting') left += weight(it)
  }
  if (done <= 0 || workMs < 1500) return undefined
  return left / (done / (workMs / 1000))
}
