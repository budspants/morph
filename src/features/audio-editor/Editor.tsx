import { motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../design/Button'
import { Chip, IconBtn, Slider, Toggle } from '../../design/Controls'
import { Morphy } from '../../design/Morphy'
import { runJob } from '../../engine/ffmpeg'
import { saveFile } from '../convert/export'
import { formatBytes, formatClock, formatDuration } from '../convert/format'
import { detectBpm, detectKey, findLoop, findSilence, peaks as getPeaks, snap } from './analyze'
import { cutRange, deleteSegs, editLength, initialState, keepRange, splitAt, starts, useHistory, type EditState, type EffectId } from './model'
import { Waveform } from './Waveform'
import { assemble, EFFECTS, EQ_BANDS, exportEdit, EXPORTS, outRate, renderPreview, type ExportFormat } from './render'

const MAX_SECONDS = 20 * 60 // decoded audio lives in memory; longer files would crash phones

let audioCtx: AudioContext | null = null
const ctx = () => (audioCtx ??= new AudioContext())

/** Decode with the browser; fall back to ffmpeg (e.g. audio inside video containers Safari can't open). */
async function decode(file: Blob & { name?: string }): Promise<AudioBuffer> {
  try {
    return await ctx().decodeAudioData(await file.arrayBuffer())
  } catch {
    const f = file instanceof File ? file : new File([file], file.name ?? 'in', { type: file.type })
    const wav = await runJob(f, 'dec.wav', (i, o) => ['-i', i, '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', o], () => {}).result
    return ctx().decodeAudioData(wav.slice().buffer)
  }
}
const decodeBytes = (b: ArrayBuffer) => ctx().decodeAudioData(b)

type Props = { file: File; onClose: () => void; onExported: (blob: Blob, name: string) => void }

export function Editor({ file, onClose, onExported }: Props) {
  const [srcs, setSrcs] = useState<AudioBuffer[] | null>(null)
  const [error, setError] = useState('')
  const h = useHistory<EditState>(initialState(0, ''))
  const st = h.state

  // Load
  useEffect(() => {
    let alive = true
    decode(file)
      .then((buf) => {
        if (!alive) return
        if (buf.duration > MAX_SECONDS) return setError(`That’s ${formatDuration(buf.duration)} long. The editor handles up to 20 minutes for now; trim it in the converter first.`)
        setSrcs([buf])
        h.reset(initialState(buf.duration, file.name.replace(/\.[^.]+$/, '')))
      })
      .catch(() => alive && setError("Couldn't read the audio in that file."))
    return () => {
      alive = false
    }
    // h.reset is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  if (error)
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
        <Morphy mood="oops" size={80} />
        <p className="max-w-sm text-text-2">{error}</p>
        <Button onClick={onClose}>Back</Button>
      </div>
    )
  if (!srcs || !st.segs[0]?.to)
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3" aria-busy>
        <Morphy mood="idle" size={72} />
        <p className="text-text-2">Opening {file.name}…</p>
      </div>
    )
  return <Workspace file={file} srcs={srcs} setSrcs={setSrcs} h={h} onClose={onClose} onExported={onExported} />
}

type H = ReturnType<typeof useHistory<EditState>>

function Workspace({ file, srcs, setSrcs, h, onClose, onExported }: Props & { srcs: AudioBuffer[]; setSrcs: (s: AudioBuffer[]) => void; h: H }) {
  const st = h.state
  const set = h.set
  const [preview, setPreview] = useState<AudioBuffer | null>(null)
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [sel, setSel] = useState<[number, number] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [zoom, setZoom] = useState(0) // 0 = fit
  const [loop, setLoop] = useState(false)
  const [abOriginal, setAbOriginal] = useState(false)
  const [panel, setPanel] = useState<'adjust' | 'eq' | 'tools' | 'info'>('adjust')
  const [analysis, setAnalysis] = useState<{ bpm?: number; beats?: number[]; key?: string; running?: boolean }>({})
  const [snapOn, setSnapOn] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('mp3')
  const [cover, setCover] = useState<File | null>(null)
  const [exporting, setExporting] = useState<number | null>(null)
  const [done, setDone] = useState<{ blob: Blob; name: string; saved?: boolean } | null>(null)
  const [width, setWidth] = useState(600)
  const wrap = useRef<HTMLDivElement>(null)
  const node = useRef<{ src: AudioBufferSourceNode; at: number; from: number } | null>(null)

  // Re-render the preview after each edit (debounced; stale results dropped).
  const renderSeq = useRef(0)
  useEffect(() => {
    const seq = ++renderSeq.current
    setBusy(true)
    const t = setTimeout(() => {
      renderPreview(srcs, st, decodeBytes)
        .then((b) => seq === renderSeq.current && setPreview(b))
        .catch((e) => console.error('preview failed', e))
        .finally(() => seq === renderSeq.current && setBusy(false))
    }, 120)
    return () => clearTimeout(t)
  }, [srcs, st])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dur = preview?.duration ?? editLength(st.segs) / outRate(st)
  const pxPerSec = zoom || Math.max(1, width / Math.max(0.1, dur))
  const peakData = useMemo(() => (preview ? getPeaks(preview) : new Float32Array(0)), [preview])
  const rate = outRate(st)
  const toEdit = (t: number) => t * rate
  const bounds = useMemo(() => starts(st.segs).slice(1).map((t) => t / rate), [st.segs, rate])

  // Beats belong to one preview; drop them when the audio changes.
  useEffect(() => setAnalysis({}), [preview])

  // --- playback -----------------------------------------------------------------------
  const stop = useCallback(() => {
    if (node.current) {
      node.current.src.onended = null
      node.current.src.stop()
      node.current = null
    }
    setPlaying(false)
  }, [])
  const play = useCallback(
    (from = playhead) => {
      const buf = abOriginal ? srcs[0] : preview
      if (!buf) return
      stop()
      const c = ctx()
      void c.resume()
      const src = new AudioBufferSourceNode(c, { buffer: buf })
      src.connect(c.destination)
      const [a, b] = loop && sel ? sel : [0, buf.duration]
      if (loop && sel) {
        src.loop = true
        src.loopStart = a
        src.loopEnd = b
      }
      const start = Math.min(Math.max(from, loop && sel ? a : 0), buf.duration - 0.01)
      src.start(0, start)
      src.onended = () => (setPlaying(false), (node.current = null))
      node.current = { src, at: c.currentTime, from: start }
      setPlaying(true)
    },
    [abOriginal, srcs, preview, loop, sel, playhead, stop],
  )
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const n = node.current
      if (n) {
        let t = n.from + (ctx().currentTime - n.at)
        if (n.src.loop) t = n.src.loopStart + ((t - n.src.loopStart) % (n.src.loopEnd - n.src.loopStart))
        setPlayhead(Math.min(t, dur))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, dur])
  // New audio while playing: restart from the same spot so you hear the change.
  useEffect(() => {
    if (node.current) play(playhead)
    // only when the audio itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, abOriginal])
  useEffect(() => stop, [stop])

  // --- edits ----------------------------------------------------------------------------
  const selEdit = sel && ([toEdit(sel[0]), toEdit(sel[1])] as const)
  const cut = () => selEdit && (set((s) => ({ ...s, segs: cutRange(s.segs, ...selEdit) })), setSel(null))
  const trim = () => selEdit && (set((s) => ({ ...s, segs: keepRange(s.segs, ...selEdit) })), setSel(null), setPlayhead(0))
  const split = () => set((s) => ({ ...s, segs: splitAt(s.segs, toEdit(playhead)) }))
  const delPicked = () => (set((s) => ({ ...s, segs: deleteSegs(s.segs, picked) })), setPicked(new Set()))
  const effect = (id: EffectId) => set((s) => ({ ...s, effect: s.effect === id ? 'none' : id }))
  const onSelect = (r: [number, number] | null) => setSel(r && snapOn ? [snap(r[0], analysis.beats), snap(r[1], analysis.beats)] : r)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) h.redo()
        else h.undo()
      } else if (e.key === ' ') {
        e.preventDefault()
        if (playing) stop()
        else play()
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) cut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function analyse() {
    if (!preview) return
    setAnalysis({ running: true })
    const [b, key] = await Promise.all([detectBpm(preview), detectKey(preview)])
    setAnalysis({ bpm: b?.bpm, beats: b?.beats, key: key ?? undefined })
  }
  function autoLoop() {
    if (!preview || !analysis.beats) return
    const l = findLoop(preview, analysis.beats)
    if (!l) return
    setSel(l)
    setLoop(true)
    setPlayhead(l[0])
  }
  function removeSilence() {
    const dry = assemble(srcs, st)
    const gaps = findSilence(dry)
    if (!gaps.length) return
    // Leave a little air either side; cut from the end so earlier times stay valid.
    set((s) => ({ ...s, segs: [...gaps].reverse().reduce((segs, [a, b]) => cutRange(segs, a + 0.15, b - 0.15), s.segs) }))
  }
  async function addFile(f: File, xfade: number) {
    const buf = await decode(f)
    setSrcs([...srcs, buf])
    set((s) => ({ ...s, segs: [...s.segs, { src: srcs.length, from: 0, to: buf.duration, xfade: Math.min(xfade, buf.duration / 2) }] }))
  }
  async function doExport() {
    if (!preview) return
    stop()
    setExporting(0)
    try {
      const blob = await exportEdit(preview, st, format, cover, (r) => setExporting(r))
      const name = `${st.meta.title.trim() || file.name.replace(/\.[^.]+$/, '')}.${format}`
      onExported(blob, name)
      setDone({ blob, name })
    } finally {
      setExporting(null)
    }
  }

  if (done)
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
        <Morphy mood="happy" size={88} />
        <p className="text-xl font-semibold [overflow-wrap:anywhere]">{done.name}</p>
        <p className="tabular text-text-2">{formatBytes(done.blob.size)} · also in your Library</p>
        <div className="mt-4 flex w-full max-w-sm flex-col gap-3">
          <Button variant="primary" onClick={async () => (await saveFile(done.blob, done.name)) && setDone({ ...done, saved: true })}>
            {done.saved ? '✓ Saved · save again' : 'Save'}
          </Button>
          <Button onClick={() => setDone(null)}>Keep editing</Button>
        </div>
      </div>
    )

  return (
    <div ref={wrap} className="flex flex-col gap-4 pb-24">
      <div className="flex items-center gap-2">
        <button onClick={onClose} aria-label="Close editor" className="grid size-11 place-items-center rounded-full text-text-2 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{file.name}</p>
          <p className="tabular text-xs text-text-2" aria-live="polite">
            {formatClock(playhead)} / {formatClock(dur)}{busy ? ' · updating…' : ''}
          </p>
        </div>
        <IconBtn label="Undo" disabled={!h.canUndo} onClick={h.undo} d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
        <IconBtn label="Redo" disabled={!h.canRedo} onClick={h.redo} d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
      </div>

      {preview ? (
        <Waveform
          peaks={peakData}
          sampleRate={preview.sampleRate}
          duration={preview.duration}
          zoom={pxPerSec}
          playhead={playhead}
          selection={sel}
          bounds={bounds}
          beats={analysis.beats}
          onSeek={(t) => (setPlayhead(t), playing && play(t))}
          onSelect={onSelect}
        />
      ) : (
        <div className="h-36 animate-pulse rounded-card bg-surface-1" />
      )}

      {st.segs.length > 1 && (
        <div className="flex gap-1" aria-label="Pieces">
          {st.segs.map((s, i) => (
            <button
              key={i}
              aria-pressed={picked.has(i)}
              aria-label={`Piece ${i + 1}, ${formatDuration(s.to - s.from)}`}
              onClick={() => setPicked((p) => (p.has(i) ? new Set([...p].filter((x) => x !== i)) : new Set(p).add(i)))}
              style={{ flexGrow: s.to - s.from }}
              className={`h-7 min-w-3 rounded-md text-[10px] outline-none focus-visible:ring-2 focus-visible:ring-accent ${picked.has(i) ? 'bg-accent text-white' : 'bg-surface-3 text-text-2'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => (playing ? stop() : play())}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid size-14 place-items-center rounded-full bg-accent text-white shadow-glow outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}</svg>
        </motion.button>
        <Toggle on={loop} onClick={() => setLoop((l) => !l)} disabled={!sel}>Loop</Toggle>
        <Toggle on={abOriginal} onClick={() => setAbOriginal((a) => !a)}>{abOriginal ? 'Hearing original' : 'A/B'}</Toggle>
        <span className="flex-1" />
        <IconBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(width / Math.max(0.1, dur), (z || pxPerSec) / 2))} d="M5 12h14" />
        <IconBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(2000, (z || pxPerSec) * 2))} d="M12 5v14M5 12h14" />
      </div>

      {(sel || picked.size > 0) && (
        <div className="flex flex-wrap gap-2">
          {sel && <Chip onClick={trim}>Keep selection</Chip>}
          {sel && <Chip onClick={cut}>Cut selection</Chip>}
          {picked.size > 0 && <Chip onClick={delPicked}>Delete {picked.size} piece{picked.size > 1 ? 's' : ''}</Chip>}
          <Chip onClick={() => (setSel(null), setPicked(new Set()))}>Clear</Chip>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm text-text-2">One-tap effects</p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {(Object.keys(EFFECTS) as EffectId[]).filter((id) => id !== 'none').map((id) => (
            <Toggle key={id} on={st.effect === id} onClick={() => effect(id)}>{EFFECTS[id].label}</Toggle>
          ))}
        </div>
      </div>

      <div className="flex gap-1 rounded-full bg-surface-1 p-1" role="tablist">
        {(['adjust', 'eq', 'tools', 'info'] as const).map((p) => (
          <button key={p} role="tab" aria-selected={panel === p} onClick={() => setPanel(p)} className={`min-h-10 flex-1 rounded-full text-sm font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-accent ${panel === p ? 'bg-surface-3 text-white' : 'text-text-2'}`}>
            {p === 'eq' ? 'EQ' : p}
          </button>
        ))}
      </div>

      {panel === 'adjust' && (
        <div className="flex flex-col gap-4">
          <Slider label="Fade in" value={st.fadeIn} min={0} max={10} step={0.1} unit="s" onChange={(v) => set((s) => ({ ...s, fadeIn: v }), 'fadeIn')} />
          <Slider label="Fade out" value={st.fadeOut} min={0} max={10} step={0.1} unit="s" onChange={(v) => set((s) => ({ ...s, fadeOut: v }), 'fadeOut')} />
          <Slider label="Volume" value={st.gainDb} min={-12} max={12} step={0.5} unit="dB" onChange={(v) => set((s) => ({ ...s, gainDb: v }), 'gain')} />
          <Slider label="Speed" value={st.speed} min={0.5} max={2} step={0.05} unit="×" onChange={(v) => set((s) => ({ ...s, speed: v }), 'speed')} />
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            Keep pitch when changing speed
            <input type="checkbox" checked={st.keepPitch} onChange={(e) => set((s) => ({ ...s, keepPitch: e.target.checked }))} className="size-5 accent-[var(--color-accent)]" />
          </label>
          <Slider label="Pitch" value={st.pitch} min={-12} max={12} step={1} unit=" st" onChange={(v) => set((s) => ({ ...s, pitch: v }), 'pitch')} />
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="mr-1 text-text-2">Loudness</span>
            {([[0, 'Off'], [-14, 'Streaming −14'], [-16, 'Podcast −16']] as const).map(([v, l]) => (
              <Toggle key={v} on={st.loudness === v} onClick={() => set((s) => ({ ...s, loudness: v }))}>{l}</Toggle>
            ))}
          </div>
        </div>
      )}

      {panel === 'eq' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {([['Flat', [0, 0, 0, 0, 0]], ['Bass boost', [6, 3, 0, 0, 0]], ['Vocal', [-2, -1, 3, 4, 1]], ['Bright', [0, 0, 0, 3, 6]], ['Lo-fi', [3, 0, -2, -6, -12]]] as const).map(([l, v]) => (
              <Chip key={l} onClick={() => set((s) => ({ ...s, eq: [...v] }))}>{l}</Chip>
            ))}
          </div>
          {EQ_BANDS.map((f, i) => (
            <Slider key={f} label={f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`} value={st.eq[i]} min={-12} max={12} step={0.5} unit="dB" onChange={(v) => set((s) => ({ ...s, eq: s.eq.map((x, k) => (k === i ? v : x)) }), `eq${i}`)} />
          ))}
        </div>
      )}

      {panel === 'tools' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Chip onClick={split}>Split at playhead</Chip>
            <Chip onClick={removeSilence}>Remove silences</Chip>
            <Chip onClick={analyse} disabled={!preview || analysis.running}>{analysis.running ? 'Listening…' : 'Find BPM & key'}</Chip>
            <Chip onClick={autoLoop} disabled={!analysis.beats}>Find a loop</Chip>
            <Toggle on={snapOn} onClick={() => setSnapOn((v) => !v)} disabled={!analysis.beats}>Snap to beat</Toggle>
          </div>
          {(analysis.bpm || analysis.key) && (
            <p className="tabular text-sm">
              {analysis.bpm && <><span className="text-text-2">BPM</span> {analysis.bpm}</>}
              {analysis.key && <><span className="ml-4 text-text-2">Key</span> {analysis.key}</>}
            </p>
          )}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-full bg-surface-2 px-4 text-sm font-medium outline-none focus-within:ring-2 focus-within:ring-accent hover:bg-surface-3">
            + Add a file at the end (2 s crossfade)
            <input type="file" accept="audio/*,video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && void addFile(e.target.files[0], 2)} />
          </label>
        </div>
      )}

      {panel === 'info' && (
        <div className="flex flex-col gap-3">
          {(['title', 'artist', 'album'] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-sm capitalize text-text-2">
              {k}
              <input value={st.meta[k]} onChange={(e) => set((s) => ({ ...s, meta: { ...s.meta, [k]: e.target.value } }), `meta-${k}`)} className="min-h-11 rounded-control bg-surface-2 px-4 text-base text-white outline-none focus-visible:ring-2 focus-visible:ring-accent" />
            </label>
          ))}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-full bg-surface-2 px-4 text-sm font-medium focus-within:ring-2 focus-within:ring-accent hover:bg-surface-3">
            {cover ? `Cover: ${cover.name}` : '+ Cover art (JPG or PNG)'}
            <input type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => setCover(e.target.files?.[0] ?? null)} />
          </label>
        </div>
      )}

      <div className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] -mx-4 sm:bottom-0 flex flex-col gap-2 bg-linear-to-t from-bg from-70% to-transparent px-4 pt-6 pb-[max(16px,env(safe-area-inset-bottom))]">
        <div className="flex gap-2">
          {(Object.keys(EXPORTS) as ExportFormat[]).map((f) => (
            <Toggle key={f} on={format === f} onClick={() => setFormat(f)}>{f.toUpperCase()}</Toggle>
          ))}
        </div>
        <Button variant="primary" onClick={doExport} disabled={!preview || busy || exporting !== null} className="disabled:bg-surface-3 disabled:text-text-2 disabled:shadow-none">
          {exporting !== null ? `Exporting… ${Math.round(exporting * 100)}%` : `Export ${format.toUpperCase()}${preview ? ` · ${formatDuration(preview.duration)}` : ''}`}
        </Button>
        {preview && <p className="tabular text-center text-xs text-text-2">about {formatBytes((preview.duration * (format === 'wav' ? 1411 : format === 'flac' ? 900 : 192) * 1000) / 8)}</p>}
      </div>
    </div>
  )
}

