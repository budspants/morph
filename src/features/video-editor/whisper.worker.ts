// Whisper speech-to-text, on this device, in its own worker so the UI stays smooth.
// The model downloads once from Hugging Face and the browser caches it; audio never leaves.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { downloadProgress } from '../../engine/onnx'
import { snapToSpeech } from './captions'

export type WhisperModel = 'tiny' | 'base'
export type ToWorker = { audio: Float32Array; model: WhisperModel; language?: string }
export type FromWorker =
  | { type: 'download'; ratio: number }
  | { type: 'listening' }
  | { type: 'done'; words: { text: string; from: number; to: number }[] }
  | { type: 'error'; message: string }

const pipes = new Map<WhisperModel, Promise<AutomaticSpeechRecognitionPipeline>>()
const post = (m: FromWorker) => self.postMessage(m)

function load(model: WhisperModel) {
  let p = pipes.get(model)
  if (!p) {
    // shortcut: wasm + 8-bit weights only; try WebGPU in the speed pass once word timing is checked there.
    p = pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}_timestamped`, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: downloadProgress((ratio) => post({ type: 'download', ratio })),
    }) as Promise<AutomaticSpeechRecognitionPipeline>
    p.catch(() => pipes.delete(model))
    pipes.set(model, p)
  }
  return p
}

self.onmessage = async ({ data }: MessageEvent<ToWorker>) => {
  try {
    const asr = await load(data.model)
    post({ type: 'listening' })
    const out = await asr(data.audio, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(data.language ? { language: data.language } : {}),
      task: 'transcribe',
    })
    type Chunk = { text: string; timestamp: [number, number | null] }
    const chunks = ((Array.isArray(out) ? out[0] : out).chunks ?? []) as Chunk[]
    const words = chunks.filter((c) => c.text.trim()).map((c) => ({ text: c.text.trim(), from: c.timestamp[0], to: c.timestamp[1] ?? c.timestamp[0] + 0.3 }))
    post({ type: 'done', words: snapToSpeech(words, data.audio, 16000) })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) })
  }
}
