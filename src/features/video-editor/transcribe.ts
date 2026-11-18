// Auto captions: ffmpeg pulls 16 kHz mono audio, Whisper (in a worker) turns it into words.
import { runJob } from '../../engine/ffmpeg'
import type { Word } from './captions'
import type { FromWorker, ToWorker, WhisperModel } from './whisper.worker'

export type Status = { stage: 'audio' } | { stage: 'download'; ratio: number } | { stage: 'listening' }

// One worker for the whole session, so the model stays loaded between runs.
let worker: Worker | null = null
const getWorker = () => (worker ??= new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' }))

/** Source seconds [from, to] as 16 kHz mono samples (for Whisper and pause detection). */
export function extractAudio(file: File, [from, to]: [number, number]) {
  const job = runJob(file, 'speech.f32', (i, o) => ['-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', i, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', o], () => {})
  return { result: job.result.then((bytes) => new Float32Array(bytes.slice().buffer)), cancel: job.cancel } // own, 4-byte-aligned copy we can transfer
}

/** Transcribe source seconds [from, to]. Word times come back in source seconds. */
export function transcribe(file: File, [from, to]: [number, number], model: WhisperModel, language: string | undefined, onStatus: (s: Status) => void) {
  let cancelled = false
  let stop = () => {}
  const result = (async (): Promise<Word[]> => {
    onStatus({ stage: 'audio' })
    const job = extractAudio(file, [from, to])
    stop = job.cancel
    const audio = await job.result
    if (cancelled) throw new DOMException('Cancelled', 'AbortError')
    const w = getWorker()
    return new Promise<Word[]>((resolve, reject) => {
      stop = () => {
        // Killing the worker is the only way to stop Whisper mid-run; the next run reloads it.
        w.terminate()
        worker = null
        reject(new DOMException('Cancelled', 'AbortError'))
      }
      w.onmessage = ({ data }: MessageEvent<FromWorker>) => {
        if (data.type === 'download') onStatus({ stage: 'download', ratio: data.ratio })
        else if (data.type === 'listening') onStatus({ stage: 'listening' })
        else if (data.type === 'error') reject(new Error(data.message))
        else resolve(data.words.map((x) => ({ ...x, from: x.from + from, to: x.to + from })))
      }
      w.onerror = (e) => reject(new Error(e.message || 'Whisper worker failed'))
      w.postMessage({ audio, model, language } satisfies ToWorker, [audio.buffer])
    })
  })()
  return {
    result,
    cancel() {
      cancelled = true
      stop()
    },
  }
}
