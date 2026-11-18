import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'

const BUCKET = 256 // samples per peak pair (see analyze.peaks)

/**
 * Zoomable waveform. Only the visible slice is drawn, so long files stay light.
 * Tap = move playhead, drag = select a range. All times are output seconds.
 */
export function Waveform({ peaks, sampleRate, duration, zoom, playhead, selection, bounds, beats, onSeek, onSelect }: {
  peaks: Float32Array
  sampleRate: number
  duration: number
  zoom: number // px per second
  playhead: number
  selection: [number, number] | null
  bounds: number[] // piece boundaries
  beats?: number[]
  onSeek: (t: number) => void
  onSelect: (sel: [number, number] | null) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState({ left: 0, width: 0 })
  const drag = useRef<{ x0: number; t0: number; moved: boolean } | null>(null)
  const total = Math.max(1, duration * zoom)

  useEffect(() => {
    const el = scroller.current!
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => (ro.disconnect(), el.removeEventListener('scroll', update))
  }, [])

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current!
    const x = playhead * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.25)
  }, [playhead, zoom])

  useEffect(() => {
    const c = canvas.current!
    const dpr = window.devicePixelRatio || 1
    const w = view.width
    const h = c.clientHeight
    c.width = Math.max(1, w * dpr)
    c.height = Math.max(1, h * dpr)
    const g = c.getContext('2d')!
    g.scale(dpr, dpr)
    g.clearRect(0, 0, w, h)
    const css = getComputedStyle(c)
    const accent = css.getPropertyValue('--color-accent').trim() || '#7c5cff'
    const accent2 = css.getPropertyValue('--color-accent-2').trim() || '#3de1ff'
    const tAt = (x: number) => (view.left + x) / zoom
    const xAt = (t: number) => t * zoom - view.left

    if (selection) {
      g.fillStyle = 'rgba(124,92,255,0.22)'
      g.fillRect(xAt(selection[0]), 0, (selection[1] - selection[0]) * zoom, h)
    }
    // Peaks: one bar per pixel, min/max over the buckets under it.
    const grad = g.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, accent)
    grad.addColorStop(1, accent2)
    g.fillStyle = grad
    const mid = h / 2
    const pairs = peaks.length / 2
    for (let x = 0; x < w; x++) {
      const a = Math.floor((tAt(x) * sampleRate) / BUCKET)
      const b = Math.max(a + 1, Math.floor((tAt(x + 1) * sampleRate) / BUCKET))
      if (a >= pairs) break
      let lo = 0
      let hi = 0
      for (let i = a; i < Math.min(b, pairs); i++) {
        if (peaks[i * 2] < lo) lo = peaks[i * 2]
        if (peaks[i * 2 + 1] > hi) hi = peaks[i * 2 + 1]
      }
      g.fillRect(x, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95))
    }
    if (beats && zoom > 20) {
      g.fillStyle = 'rgba(255,255,255,0.12)'
      for (const t of beats) if (xAt(t) >= 0 && xAt(t) <= w) g.fillRect(xAt(t), h - 6, 1, 6)
    }
    g.fillStyle = 'rgba(255,255,255,0.55)'
    for (const t of bounds) if (xAt(t) >= 0 && xAt(t) <= w) g.fillRect(xAt(t) - 0.5, 0, 1, h)
    g.fillStyle = '#fff'
    g.fillRect(xAt(playhead) - 1, 0, 2, h)
  }, [peaks, sampleRate, zoom, view, playhead, selection, bounds, beats])

  const timeAt = (e: RPointerEvent) => {
    const r = scroller.current!.getBoundingClientRect()
    return Math.max(0, Math.min(duration, (e.clientX - r.left + scroller.current!.scrollLeft) / zoom))
  }

  return (
    <div
      ref={scroller}
      className="relative h-36 touch-pan-x overflow-x-auto overflow-y-hidden rounded-card bg-surface-1 [scrollbar-width:thin]"
      role="slider"
      aria-label="Waveform. Tap to move the playhead, drag to select."
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(playhead)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onSeek(Math.min(duration, playhead + (e.shiftKey ? 5 : 1)))
        if (e.key === 'ArrowLeft') onSeek(Math.max(0, playhead - (e.shiftKey ? 5 : 1)))
      }}
      onPointerDown={(e) => {
        if (e.pointerType === 'touch' && !e.isPrimary) return
        drag.current = { x0: e.clientX, t0: timeAt(e), moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        if (!d.moved && Math.abs(e.clientX - d.x0) < 6) return
        if (!d.moved) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        d.moved = true
        const t = timeAt(e)
        onSelect([Math.min(d.t0, t), Math.max(d.t0, t)])
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (d && !d.moved) {
          onSelect(null)
          onSeek(timeAt(e))
        }
      }}
    >
      <div style={{ width: total }} className="h-full" />
      <canvas ref={canvas} className="pointer-events-none sticky left-0 top-0 -mt-36 block h-36 w-full" style={{ width: view.width }} />
    </div>
  )
}
