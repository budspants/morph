// The finished file, shown before saving: images and GIFs as a picture, videos playable, audio with a
// compact player. Anything else (zips of frames) shows nothing.
import { useEffect, useRef, useState } from 'react'
import { useObjectUrl } from '../../app/useObjectUrl'
import { formatClock } from './format'

export function OutputPreview({ blob }: { blob: Blob }) {
  const url = useObjectUrl(blob)
  const kind = blob.type.split('/')[0]
  if (!url) return null
  if (kind === 'image') return <img src={url} alt="Preview of the result" className="max-h-72 max-w-full rounded-card object-contain shadow-glow" />
  if (kind === 'video') return <video src={url} controls playsInline className="max-h-72 max-w-full rounded-card bg-black shadow-glow" aria-label="Preview of the result" />
  if (kind === 'audio') return <AudioPlayer url={url} />
  return null
}

function AudioPlayer({ url }: { url: string }) {
  const ref = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  useEffect(() => {
    const a = ref.current
    return () => a?.pause()
  }, [])
  const toggle = () => {
    const a = ref.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }
  return (
    <div className="flex w-full max-w-sm items-center gap-3 rounded-full bg-surface-1 p-2 pr-5">
      <audio ref={ref} src={url} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)} />
      <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-white outline-none focus-visible:ring-2 focus-visible:ring-white active:scale-95">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M7 4.5v15l13-7.5z" />}
        </svg>
      </button>
      <input
        type="range"
        aria-label="Position"
        min={0}
        max={dur || 1}
        step={0.01}
        value={t}
        onChange={(e) => {
          if (ref.current) ref.current.currentTime = Number(e.target.value)
        }}
        className="min-w-0 flex-1 accent-[var(--color-accent)]"
      />
      <span className="tabular shrink-0 text-xs text-text-2">{formatClock(playing || t ? t : dur)}</span>
    </div>
  )
}
