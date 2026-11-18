// ONNX Runtime for the on-device AI workers (captions, background removal). Its files come from our own
// bundle, not a CDN; same variant choice transformers.js makes.
import { env } from '@huggingface/transformers'
import plainMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'
import plainWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import asyncMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import asyncWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

const oldSafari = /Version\/(\d+).*Safari/.exec(navigator.userAgent)
const plain = !!oldSafari && Number(oldSafari[1]) < 26
env.backends.onnx.wasm!.wasmPaths = plain ? { mjs: plainMjs, wasm: plainWasm } : { mjs: asyncMjs, wasm: asyncWasm }
env.allowLocalModels = false

/** Download progress across all of a model's files, 0–1. */
export function downloadProgress(report: (ratio: number) => void) {
  const files = new Map<string, [number, number]>()
  return (e: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (e.status !== 'progress' || !e.file || !e.total) return
    files.set(e.file, [e.loaded ?? 0, e.total])
    const [got, all] = [...files.values()].reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0])
    report(got / all)
  }
}
