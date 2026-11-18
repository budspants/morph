// Background removal, on this device, in its own worker. The model downloads once from Hugging Face and
// the browser keeps it; the photo never leaves the device.
import { pipeline, RawImage, type BackgroundRemovalPipeline } from '@huggingface/transformers'
import { downloadProgress } from '../../engine/onnx'

export type ToCutout = { image: Blob; bg: 'none' | 'white' | 'black' }
export type FromCutout = { type: 'download'; ratio: number } | { type: 'working' } | { type: 'done'; png: Blob } | { type: 'error'; message: string }

// MODNet: people, 7 MB, Apache-2.0 (commercial use allowed).
// shortcut: people only. BiRefNet-lite (MIT, any object) ran out of wasm memory (std::bad_alloc) even on a Mac;
// retry it with WebGPU once that's dependable on phones.
let pipe: Promise<BackgroundRemovalPipeline> | null = null
const post = (m: FromCutout) => self.postMessage(m)

function load() {
  if (!pipe) {
    pipe = pipeline('background-removal', 'Xenova/modnet', { device: 'wasm', dtype: 'q8', progress_callback: downloadProgress((ratio) => post({ type: 'download', ratio })) }) as Promise<BackgroundRemovalPipeline>
    pipe.catch(() => (pipe = null))
  }
  return pipe
}

self.onmessage = async ({ data }: MessageEvent<ToCutout>) => {
  try {
    const remove = await load()
    post({ type: 'working' })
    const out = (await remove(await RawImage.fromBlob(data.image))) as RawImage
    const rgba = out.rgba()
    const canvas = new OffscreenCanvas(rgba.width, rgba.height)
    const ctx = canvas.getContext('2d')!
    if (data.bg !== 'none') {
      ctx.fillStyle = data.bg
      ctx.fillRect(0, 0, rgba.width, rgba.height)
    }
    // drawImage blends over the fill; putImageData would replace it.
    ctx.drawImage(await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.data), rgba.width, rgba.height)), 0, 0)
    post({ type: 'done', png: await canvas.convertToBlob({ type: 'image/png' }) })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) })
  }
}
