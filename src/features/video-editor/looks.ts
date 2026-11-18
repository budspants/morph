// Colour looks. Each look is a list of CSS filter functions; the preview uses them as-is and
// the export turns each into the same maths in ffmpeg (the 3x3 matrices from the CSS Filter
// Effects spec), so what you see is what you export.

type Op = ['grayscale' | 'sepia' | 'saturate' | 'brightness' | 'contrast', number] | ['hue-rotate', number]

export type LookId = 'none' | 'vivid' | 'warm' | 'cool' | 'fade' | 'bw' | 'noir'

export const LOOKS: Record<LookId, { label: string; ops: Op[] }> = {
  none: { label: 'None', ops: [] },
  vivid: { label: 'Vivid', ops: [['saturate', 1.4], ['contrast', 1.1]] },
  warm: { label: 'Warm', ops: [['sepia', 0.3], ['saturate', 1.25]] },
  cool: { label: 'Cool', ops: [['hue-rotate', -12], ['saturate', 1.1], ['brightness', 1.03]] },
  fade: { label: 'Fade', ops: [['contrast', 0.85], ['brightness', 1.08], ['saturate', 0.8]] },
  bw: { label: 'B&W', ops: [['grayscale', 1], ['contrast', 1.1]] },
  noir: { label: 'Noir', ops: [['grayscale', 1], ['contrast', 1.45], ['brightness', 0.9]] },
}

export const cssFilter = (id: LookId) => LOOKS[id].ops.map(([f, v]) => (f === 'hue-rotate' ? `hue-rotate(${v}deg)` : `${f}(${v})`)).join(' ') || 'none'

type M = [number, number, number, number, number, number, number, number, number]

function matrix([f, v]: Op): M | null {
  const a = 1 - v
  switch (f) {
    case 'grayscale':
      return [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a]
    case 'sepia':
      return [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a, 0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a, 0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a]
    case 'saturate':
      return [0.213 + 0.787 * v, 0.715 - 0.715 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 + 0.285 * v, 0.072 - 0.072 * v, 0.213 - 0.213 * v, 0.715 - 0.715 * v, 0.072 + 0.928 * v]
    case 'hue-rotate': {
      const c = Math.cos((v * Math.PI) / 180)
      const s = Math.sin((v * Math.PI) / 180)
      return [
        0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
        0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
        0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
      ]
    }
    case 'brightness':
      return [v, 0, 0, 0, v, 0, 0, 0, v]
    default:
      return null
  }
}

const f4 = (x: number) => x.toFixed(4)

/** ffmpeg filters for a look (empty for none). Each step clips like the browser does. */
export function ffLook(id: LookId): string[] {
  return LOOKS[id].ops.map((op) => {
    const m = matrix(op)
    if (m) {
      const k = ['rr', 'rg', 'rb', 'gr', 'gg', 'gb', 'br', 'bg', 'bb']
      return `colorchannelmixer=${k.map((n, i) => `${n}=${f4(m[i])}`).join(':')}`
    }
    const c = op[1] // contrast: (v - 0.5) * c + 0.5
    const e = `val*${f4(c)}+${f4(127.5 * (1 - c))}`
    return `lutrgb=r='${e}':g='${e}':b='${e}'`
  })
}
