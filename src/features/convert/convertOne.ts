// One file through one preset. Shared by the single-file flow and the batch queue.
import { runJob } from '../../engine/ffmpeg'
import { removeBackground } from './cutout'
import { convertImage } from './images'
import { engineOut, outFormat, renamed, type Ctx, type Opts, type Preset } from './presets'

export type Output = { blob: Blob; name: string }
export type Running = { result: Promise<Output>; cancel: () => void }

const SUFFIX: Record<string, string> = { frames: '-frames', ringtone: '-ringtone', shrink: '-small', vertical: '-vertical' }

export function convertOne(file: File, preset: Preset, opts: Opts, ctx: Ctx, onProgress: (ratio: number) => void): Running {
  const fmt = outFormat(preset, opts, ctx.kind)
  const base = renamed(opts.rename, file.name.replace(/\.[^.]+$/, ''), ctx) + (opts.rename ? '' : (SUFFIX[preset.baseId ?? preset.id] ?? ''))
  const name = `${base || 'morph'}.${fmt.ext}`
  if (preset.engine === 'cutout') {
    const job = removeBackground(file, opts, onProgress)
    return { result: job.result.then((blob) => ({ blob, name })), cancel: job.cancel }
  }
  if (preset.engine === 'image') {
    return { result: convertImage(file, opts).then((blob) => ({ blob, name })), cancel: () => {} }
  }
  const job = runJob(file, engineOut(preset, opts, ctx.kind), (i, o) => preset.args!(i, o, opts, ctx), onProgress)
  const frames = (preset.baseId ?? preset.id) === 'frames'
  return {
    result: job.result
      .then((bytes) => (frames ? webpZipToJpgZip(bytes) : bytes))
      .then((bytes) => ({ blob: new Blob([bytes as BlobPart], { type: fmt.mime }), name })),
    cancel: job.cancel,
  }
}

// Frames arrive as a zip of WEBPs (see presets.ts); re-encode each as JPG with a canvas.
async function webpZipToJpgZip(zip: Uint8Array): Promise<Uint8Array> {
  const { unzipSync, zipSync } = await import('fflate')
  const out: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    const jpg = await convertImage(new File([data as BlobPart], name, { type: 'image/webp' }), { format: 'jpg', quality: 0.92 })
    out[name.replace(/\.webp$/, '.jpg')] = new Uint8Array(await jpg.arrayBuffer())
  }
  return zipSync(out, { level: 0 })
}
