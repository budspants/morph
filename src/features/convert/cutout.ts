// Remove a photo's background in the cutout worker. HEIC and very large photos are first turned into a
// PNG of at most 2048 px, which every browser can decode and phones have memory for.
import type { FromCutout, ToCutout } from './cutout.worker'
import { convertImage } from './images'
import type { Opts } from './presets'

let worker: Worker | null = null
const getWorker = () => (worker ??= new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' }))

export function removeBackground(file: File, opts: Opts, onProgress: (ratio: number) => void) {
  let stop = () => {}
  const result = (async () => {
    const image = await convertImage(file, { format: 'png', quality: 1, maxSide: 2048 })
    const w = getWorker()
    return new Promise<Blob>((resolve, reject) => {
      stop = () => {
        w.terminate() // the only way to stop the model mid-run; the next run reloads it
        worker = null
        reject(new DOMException('Cancelled', 'AbortError'))
      }
      w.onmessage = ({ data }: MessageEvent<FromCutout>) => {
        if (data.type === 'download') onProgress(Math.min(0.9, data.ratio * 0.9))
        else if (data.type === 'working') onProgress(0.95)
        else if (data.type === 'error') reject(new Error(data.message))
        else resolve(data.png)
      }
      w.onerror = (e) => reject(new Error(e.message || 'Background removal failed'))
      w.postMessage({ image, bg: opts.bg ?? 'none' } satisfies ToCutout)
    })
  })()
  return { result, cancel: () => stop() }
}
