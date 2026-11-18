// Text and stickers on top of the video. Each one is drawn once to a canvas at export size;
// the preview shows that exact image and the export overlays the same PNG, so they match.
import { CAPTION_LOOK } from './captions'

export type Overlay = {
  id: string
  kind: 'text' | 'sticker'
  text: string
  /** Centre, 0–1 of the output frame. */
  x: number
  y: number
  /** Font size as a share of the frame's shorter side. */
  size: number
  style: 'outline' | 'box'
  color: string
  /** Output seconds. */
  from: number
  to: number
}

export const TEXT_COLORS = ['#FFFFFF', '#FFD43B', '#FF5FA2', '#5CE1E6', '#111111']
export const STICKERS = ['😂', '🔥', '😍', '👀', '💯', '✨', '🎉', '❤️', '👍', '😭', '🤯', '🙌', '⭐', '💀', '🚀', '👇']

const EMOJI_FONT = "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif"
const TEXT_FONT = "'Inter Variable', Inter, sans-serif"

export function newOverlay(kind: Overlay['kind'], text: string, from: number, end: number): Overlay {
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind,
    text,
    x: 0.5,
    y: kind === 'text' ? 0.3 : 0.5,
    size: kind === 'text' ? 0.08 : 0.16,
    style: 'outline',
    color: '#FFFFFF',
    from,
    to: Math.min(end, from + 3),
  }
}

export type Drawn = { url: string; png: () => Promise<Blob>; w: number; h: number }

const cache = new Map<string, Drawn>()
/** Call once web fonts finish loading, so nothing stays drawn in a fallback font. */
export const clearOverlayCache = () => cache.clear()

/** Draw an overlay tightly cropped, at export resolution for a w x h frame. Cached by its look. */
export function drawOverlay(o: Overlay, frameW: number, frameH: number): Drawn {
  const key = JSON.stringify([o.kind, o.text, o.size, o.style, o.color, frameW, frameH])
  const hit = cache.get(key)
  if (hit) return hit
  const px = Math.max(8, Math.round(o.size * Math.min(frameW, frameH)))
  const font = o.kind === 'sticker' ? `${px}px ${EMOJI_FONT}` : `800 ${px}px ${TEXT_FONT}`
  const lines = (o.text || ' ').split('\n')
  const m = document.createElement('canvas').getContext('2d')!
  m.font = font
  const lineH = Math.round(px * 1.2)
  const textW = Math.max(...lines.map((l) => m.measureText(l).width))
  const box = o.kind === 'text' && o.style === 'box'
  const outline = o.kind === 'text' && !box ? Math.round(px * CAPTION_LOOK.outline) : 0
  const pad = box ? Math.round(px * 0.35) : outline + Math.round(px * 0.06)
  const c = document.createElement('canvas')
  c.width = Math.ceil(textW + pad * 2)
  c.height = Math.ceil(lineH * lines.length + pad * 2)
  const g = c.getContext('2d')!
  g.font = font
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (box) {
    g.fillStyle = o.color
    g.beginPath()
    g.roundRect(0, 0, c.width, c.height, px * 0.3)
    g.fill()
  }
  lines.forEach((l, i) => {
    const y = pad + lineH * (i + 0.5)
    if (outline) {
      g.lineJoin = 'round'
      g.lineWidth = outline * 2
      g.strokeStyle = o.color === '#111111' ? '#FFFFFF' : '#000000' // black text gets a white outline
      g.strokeText(l, c.width / 2, y)
    }
    // In a box the text is dark on light colours and white on the black box.
    g.fillStyle = box ? (o.color === '#111111' ? '#FFFFFF' : '#111111') : o.color
    g.fillText(l, c.width / 2, y)
  })
  const drawn: Drawn = {
    url: c.toDataURL('image/png'),
    png: () => new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('PNG encode failed'))), 'image/png')),
    w: c.width,
    h: c.height,
  }
  if (cache.size > 200) cache.clear()
  cache.set(key, drawn)
  return drawn
}

/** Top-left pixel position in the frame (export) for an overlay drawn at `d`. */
export const overlayXY = (o: Overlay, d: Drawn, w: number, h: number): [number, number] => [Math.round(o.x * w - d.w / 2), Math.round(o.y * h - d.h / 2)]
