// Image conversion with the browser's own decoder and a canvas: much faster than ffmpeg,
// and re-encoding drops EXIF, so location data never leaves in the output.
import { runJob } from '../../engine/ffmpeg'
import { FORMATS, isHeic, type Opts } from './presets'

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file) // Safari decodes HEIC natively
  } catch (err) {
    if (!isHeic(file)) throw err
    // Chrome/Firefox can't read HEIC: load the decoder only when needed (~1 MB).
    const { default: heic2any } = await import('heic2any')
    const png = (await heic2any({ blob: file, toType: 'image/png' })) as Blob
    return createImageBitmap(png)
  }
}

/** Output width/height and the source crop, for the size option (never upscales by %/width). */
function layout(bw: number, bh: number, opts: Opts): { w: number; h: number; sx: number; sy: number; sw: number; sh: number } {
  const full = { sx: 0, sy: 0, sw: bw, sh: bh }
  const size = opts.size ?? ''
  let m: RegExpMatchArray | null
  if ((m = size.match(/^p(\d+)$/))) {
    const k = Math.min(1, Number(m[1]) / 100)
    return { w: Math.max(1, Math.round(bw * k)), h: Math.max(1, Math.round(bh * k)), ...full }
  }
  if ((m = size.match(/^w(\d+)$/))) {
    const w = Math.min(bw, Number(m[1]))
    return { w, h: Math.max(1, Math.round((bh * w) / bw)), ...full }
  }
  if ((m = size.match(/^c(\d+)x(\d+)$/))) {
    // Crop to fill: keep the centre, cut what doesn't fit the shape.
    const [w, h] = [Number(m[1]), Number(m[2])]
    const k = Math.min(bw / w, bh / h)
    const [sw, sh] = [w * k, h * k]
    return { w, h, sx: (bw - sw) / 2, sy: (bh - sh) / 2, sw, sh }
  }
  const scale = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(bw, bh)) : 1
  return { w: Math.round(bw * scale), h: Math.round(bh * scale), ...full }
}

function draw(bmp: ImageBitmap, l: ReturnType<typeof layout>, opaque: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = l.w
  canvas.height = l.h
  const ctx = canvas.getContext('2d')!
  if (opaque) {
    ctx.fillStyle = '#fff' // JPG has no transparency
    ctx.fillRect(0, 0, l.w, l.h)
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, l.sx, l.sy, l.sw, l.sh, 0, 0, l.w, l.h)
  return canvas
}

const encode = (c: HTMLCanvasElement, mime: string, q: number) => new Promise<Blob | null>((r) => c.toBlob(r, mime, q))

/** Highest quality that fits `maxBytes`; shrinks the picture if even low quality is too big. */
async function underSize(bmp: ImageBitmap, l: ReturnType<typeof layout>, mime: string, opaque: boolean, maxBytes: number): Promise<Blob> {
  let { w, h } = l
  for (let round = 0; round < 6; round++) {
    const c = draw(bmp, { ...l, w, h }, opaque)
    let [lo, hi] = [0.3, 0.95]
    let best: Blob | null = null
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2
      const b = await encode(c, mime, q)
      if (!b) throw new Error('Image encode failed')
      if (b.size <= maxBytes) [best, lo] = [b, q]
      else hi = q
    }
    if (best) return best
    const low = (await encode(c, mime, 0.3))!
    const k = Math.max(0.5, Math.sqrt(maxBytes / low.size) * 0.95) // pixels scale ~ bytes
    ;[w, h] = [Math.max(16, Math.round(w * k)), Math.max(16, Math.round(h * k))]
  }
  throw new Error('Could not get the image that small')
}

export async function convertImage(file: File, opts: Opts): Promise<Blob> {
  const fmt = FORMATS[opts.format ?? 'jpg']
  const bmp = await decode(file)
  const l = layout(bmp.width, bmp.height, opts)
  const opaque = fmt.ext === 'jpg'
  let blob: Blob | null
  try {
    blob = opts.targetKB && fmt.ext !== 'png' ? await underSize(bmp, l, fmt.mime, opaque, opts.targetKB * 1000) : await encode(draw(bmp, l, opaque), fmt.mime, opts.quality ?? 0.9)
  } finally {
    bmp.close()
  }
  if (!blob) throw new Error('Image encode failed')
  if (blob.type === fmt.mime) return blob
  // Browsers that can't encode WEBP hand back a PNG: let ffmpeg finish the job.
  const png = new File([blob], 'in.png', { type: 'image/png' })
  const out = await runJob(png, 'out.webp', (i, o) => ['-i', i, '-c:v', 'libwebp', '-quality', String(Math.round((opts.quality ?? 0.9) * 100)), o], () => {}).result
  return new Blob([out as BlobPart], { type: fmt.mime })
}
