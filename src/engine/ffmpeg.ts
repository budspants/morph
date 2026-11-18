import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

// ffmpeg.wasm runs in its own Web Worker, so the UI never blocks.
// Core files are bundled with the app (no CDN): private and offline-ready.
// shortcut: single-thread core; switch to @ffmpeg/core-mt (needs COOP/COEP headers) in the Phase 2 speed pass.

let loading: Promise<FFmpeg> | null = null
// Long batches: wasm memory only grows, so start a fresh engine every few jobs.
const JOBS_PER_ENGINE = 10
let jobsOnEngine = 0

export function loadEngine(): Promise<FFmpeg> {
  loading ??= (async () => {
    const ff = new FFmpeg()
    await ff.load({ coreURL, wasmURL })
    return ff
  })().catch((err) => {
    loading = null
    throw err
  })
  return loading
}

/** Kill the worker and free all wasm memory; the next job loads a fresh engine. */
export async function resetEngine() {
  const cur = loading
  loading = null
  jobsOnEngine = 0
  if (cur) (await cur.catch(() => null))?.terminate()
}

export class EngineError extends Error {
  readonly log: string
  constructor(message: string, log: string) {
    super(message)
    this.log = log
  }
}

export type Job = { result: Promise<Uint8Array>; cancel: () => void }

/**
 * Run ffmpeg on `file`. `args(input, output)` builds the command line.
 * An `outName` with a `%` pattern (e.g. `f_%04d.jpg`) collects every numbered output into one zip.
 */
export function runJob(
  file: File,
  outName: string,
  args: (input: string, output: string, extras: string[]) => string[],
  /** `seconds`: output time written so far (useful when inputs are trimmed and `ratio` can't know the length). */
  onProgress: (ratio: number, seconds: number) => void,
  /** More input files (e.g. cover art), mounted next to `file`. */
  extra: File[] = [],
): Job {
  let cancelled = false
  let engine: FFmpeg | undefined

  const result = (async () => {
    if (jobsOnEngine >= JOBS_PER_ENGINE) await resetEngine()
    jobsOnEngine++
    const ff = (engine = await loadEngine())
    if (cancelled) throw new DOMException('Cancelled', 'AbortError')
    const log: string[] = []
    const onLog = ({ message }: { message: string }) => void log.push(message)
    const onProg = ({ progress, time }: { progress: number; time: number }) => onProgress(Math.min(1, Math.max(0, progress)), time / 1e6)
    ff.on('log', onLog)
    ff.on('progress', onProg)
    // WORKERFS reads the file in place instead of copying it into wasm memory.
    const dir = `/in-${Date.now()}`
    await ff.createDir(dir)
    await ff.mount(FFFSType.WORKERFS, { files: [file, ...extra] }, dir)
    try {
      const code = await ff.exec(args(`${dir}/${file.name}`, outName, extra.map((f) => `${dir}/${f.name}`)))
      if (code !== 0) throw new EngineError(`ffmpeg exited with ${code}`, log.join('\n'))
      if (!outName.includes('%')) return (await ff.readFile(outName)) as Uint8Array
      const prefix = outName.slice(0, outName.indexOf('%'))
      const names = (await ff.listDir('/')).filter((e) => !e.isDir && e.name.startsWith(prefix)).map((e) => e.name)
      if (!names.length) throw new EngineError('No output files', log.join('\n'))
      const files: Record<string, Uint8Array> = {}
      for (const n of names) {
        files[n] = (await ff.readFile(n)) as Uint8Array
        await ff.deleteFile(n)
      }
      const { zipSync } = await import('fflate')
      return zipSync(files, { level: 0 }) // JPGs are already compressed
    } finally {
      ff.off('log', onLog)
      ff.off('progress', onProg)
      await ff.unmount(dir).catch(() => {})
      await ff.deleteDir(dir).catch(() => {})
      await ff.deleteFile(outName).catch(() => {})
    }
  })()

  return {
    result,
    cancel() {
      cancelled = true
      // Killing the worker is the only way to stop a running exec; next job reloads.
      if (engine) {
        engine.terminate()
        loading = null
        jobsOnEngine = 0
      }
    },
  }
}
