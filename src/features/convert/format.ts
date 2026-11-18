export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "under 1 s", "12 s", "3:05" */
export function formatElapsed(sec: number): string {
  if (sec < 1) return 'under 1 s'
  return sec < 60 ? `${Math.round(sec)} s` : formatDuration(sec)
}

export function formatEta(sec: number): string {
  if (sec < 60) return `About ${Math.max(1, Math.round(sec))} s left`
  return `About ${Math.round(sec / 60)} min left`
}

/** "2 s" / "4 min": a job length, for estimates shown before it starts. */
export const formatSpan = (sec: number) => (sec < 60 ? `${Math.max(1, Math.round(sec))} s` : `${Math.round(sec / 60)} min`)

export function swapExt(name: string, ext: string): string {
  return `${name.replace(/\.[^./]+$/, '') || 'morph'}.${ext}`
}

/** "1:05.3": an editor playhead, to a tenth of a second. */
export function formatClock(t: number): string {
  const m = Math.floor(t / 60)
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`
}
