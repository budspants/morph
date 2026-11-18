// Ask the browser for the media duration (fast, no ffmpeg). Undefined when the
// browser can't read the container (e.g. MKV in Safari) — the UI just skips the estimate.
export function probeDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const el = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (d?: number) => {
      URL.revokeObjectURL(url)
      el.removeAttribute('src')
      resolve(d)
    }
    el.preload = 'metadata'
    el.muted = true
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : undefined)
    el.onerror = () => done()
    setTimeout(done, 3000)
    el.src = url
  })
}
