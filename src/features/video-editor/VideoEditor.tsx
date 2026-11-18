// Video editor (Phase 4): preview, thumbnail timeline, split / trim / delete, frame
// (aspect, crop position, rotate, mirror), speed, reverse, colour looks, auto captions,
// text and stickers, original volume, music with auto-ducking, undo, and export settings
// (resolution, frame rate, quality or fit-under-a-size). The browser's own <video> plays the source for the preview; ffmpeg
// renders the export, so nothing is re-encoded until you press Export.
import { Ad } from '../money/Ad'
import { motion } from 'motion/react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useObjectUrl } from '../../app/useObjectUrl'
import { Button } from '../../design/Button'
import { Chip, IconBtn, Slider, Toggle } from '../../design/Controls'
import { Morphy } from '../../design/Morphy'
import { runJob, type Job } from '../../engine/ffmpeg'
import { cutRange, deleteSegs, editLength, splitAt, starts, useHistory, type Seg } from '../audio-editor/model'
import { saveFile } from '../convert/export'
import { formatBytes, formatClock, formatDuration, formatSpan } from '../convert/format'
import { probeDuration } from '../convert/probe'
import { activeWord, ASS_EM, CAPTION_LOOK, CAPTION_STYLES, editLine, speechRanges, timedLines, toAss, toSrt, type CaptionStyle, type TimedLine } from './captions'
import { captionFonts } from './captionFonts'
import { cssFilter, LOOKS, type LookId } from './looks'
import { clearOverlayCache, drawOverlay, newOverlay, overlayXY, STICKERS, TEXT_COLORS, type Overlay } from './overlays'
import { extractAudio, transcribe, type Status } from './transcribe'
import { useSoundPreview } from './useSoundPreview'
import type { WhisperModel } from './whisper.worker'
import { estimate, exportArgs, hasAudio, cropFor, following, initialVideo, keepRanges, locate, trackAt, MAX_REVERSE, outSize, withAutoRes, type PlacedOverlay, type Quality, type Aspect, type Rotation, type VideoState } from './model'

const THUMBS = 24
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const PHONE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const LANGUAGES: [string, string][] = [['', 'Detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['pt', 'Portuguese'], ['it', 'Italian'], ['nl', 'Dutch'], ['ru', 'Russian'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese']]

type Props = { file: File; onClose: () => void; onExported: (blob: Blob, name: string) => void }

export function VideoEditor({ file, onClose, onExported }: Props) {
  const url = useObjectUrl(file)
  // Starts the engine early, so it's warm by the time you export.
  const audio = useMemo(() => hasAudio(file).catch(() => true), [file])
  const [duration, setDuration] = useState(0)
  const [srcSize, setSrcSize] = useState<[number, number]>([16, 9])
  const [error, setError] = useState('')
  const thumbs = useThumbs(url, duration)

  const h = useHistory<VideoState>(initialVideo(0))
  const segs = h.state.segs
  const total = editLength(segs)
  const vid = useRef<HTMLVideoElement>(null)
  const segsRef = useRef(segs)
  segsRef.current = segs
  const stRef = useRef(h.state)
  stRef.current = h.state
  const piece = useRef(0)
  const [t, setTState] = useState(0)
  const tRef = useRef(0)
  const setT = useCallback((x: number) => {
    tRef.current = x
    setTState(x)
  }, [])
  const [playing, setPlaying] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState<number | null>(null)
  const job = useRef<Job | null>(null)
  const [exportError, setExportError] = useState('')
  const [done, setDone] = useState<{ blob: Blob; name: string; saved?: boolean } | null>(null)
  const [hasSound, setHasSound] = useState(true)
  useEffect(() => void audio.then(setHasSound), [audio])
  const [capModel, setCapModel] = useState<WhisperModel>('tiny')
  const [language, setLanguage] = useState('')
  const [capStatus, setCapStatus] = useState<Status | null>(null)
  const [capError, setCapError] = useState('')
  const capJob = useRef<{ cancel: () => void } | null>(null)
  const [selId, setSelId] = useState<string | null>(null)
  // The music file stays outside the undo history; its settings (st.music) are inside it.
  const [musicFile, setMusicFile] = useState<File | null>(null)
  const musicUrl = useObjectUrl(musicFile ?? undefined)
  const [musicDur, setMusicDur] = useState(0)
  const mus = useRef<HTMLAudioElement>(null)
  const [pickSticker, setPickSticker] = useState(false)
  const [, setFontsReady] = useState(false)
  useEffect(() => {
    void document.fonts.load("800 64px 'Inter Variable'").then(() => (clearOverlayCache(), setFontsReady(true)))
  }, [])

  // --- playback: the <video> plays source time; we map it to edit time and hop between pieces.
  const seek = useCallback((to: number) => {
    const s = segsRef.current
    const tt = Math.max(0, Math.min(to, editLength(s)))
    const { i, src } = locate(s, tt)
    piece.current = i
    if (vid.current) vid.current.currentTime = src
    setT(tt)
  }, [setT])
  // After an edit, put the playhead back on a frame that still exists.
  useEffect(() => {
    if (duration) seek(t)
    // only when the pieces change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segs])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = () => {
      const v = vid.current
      if (!v) return
      // Browsers can't play backwards: step the playhead back each frame and seek (silent preview).
      if (stRef.current.reverse) {
        const now = performance.now()
        const next = tRef.current - ((now - last) / 1000) * stRef.current.speed
        last = now
        seek(Math.max(0, next))
        if (next <= 0) return setPlaying(false)
        raf = requestAnimationFrame(tick)
        return
      }
      const s = segsRef.current
      const i = piece.current
      if (v.currentTime >= s[i].to - 0.03) {
        if (i + 1 >= s.length) {
          v.pause()
          setPlaying(false)
          setT(editLength(s))
          return
        }
        piece.current = i + 1
        if (Math.abs(s[i + 1].from - v.currentTime) > 0.1) v.currentTime = s[i + 1].from
      }
      const j = piece.current
      setT(starts(s)[j] + Math.max(0, v.currentTime - s[j].from))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, seek, setT])

  const pause = useCallback(() => {
    vid.current?.pause()
    setPlaying(false)
  }, [])
  const play = useCallback(() => {
    const v = vid.current
    if (!v) return
    const { reverse, speed } = stRef.current
    if (reverse) {
      if (t <= 0.05) seek(total)
      return setPlaying(true)
    }
    if (t >= total - 0.05) seek(0)
    v.playbackRate = speed // keeps pitch by default, like the export's atempo
    v.play().then(() => setPlaying(true), () => setPlaying(false))
  }, [t, total, seek])
  // A speed change while playing applies straight away.
  useEffect(() => {
    if (vid.current) vid.current.playbackRate = h.state.speed
  }, [h.state.speed])

  // --- edits
  const set = h.set
  const split = () => set((s) => ({ ...s, segs: splitAt(s.segs, t) }))
  const trimStart = () => (set((s) => ({ ...s, segs: cutRange(s.segs, 0, t) })), seek(0))
  const trimEnd = () => set((s) => ({ ...s, segs: cutRange(s.segs, t, editLength(s.segs)) }))
  const delPicked = () => (set((s) => ({ ...s, segs: deleteSegs(s.segs, picked) })), setPicked(new Set()))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select, [role=slider]')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) h.redo()
        else h.undo()
      } else if (e.key === ' ') {
        e.preventDefault()
        if (playing) pause()
        else play()
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && picked.size) delPicked()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function doExport() {
    pause()
    setExportError('')
    setExporting(0)
    try {
      const a = await audio
      const st = withAutoRes(h.state, a) // a small size target may lower the resolution
      // Burned-in captions: an ASS file plus fonts, mounted next to the video for libass.
      const burn = st.burn && st.words.length > 0
      const [W, H] = outSize(st, srcSize)
      const subsFiles = burn ? [new File([toAss(timedLines(st.words, st), st.captionStyle, W, H)], 'morph-captions.ass'), ...(await captionFonts())] : []
      const end = editLength(st.segs) / st.speed
      const shown = st.overlays.filter((o) => o.from < end && o.to > o.from)
      const drawn = shown.map((o) => drawOverlay(o, W, H))
      const pngs = await Promise.all(drawn.map(async (d, k) => new File([await d.png()], `morph-overlay-${k}.png`)))
      const song = st.music && musicFile ? [new File([musicFile], `morph-music.${musicFile.name.split('.').pop() || 'audio'}`)] : []
      job.current = runJob(
        file,
        'out.mp4',
        (i, o, ex) => {
          const placed: PlacedOverlay[] = shown.map((ov, k) => {
            const [x, y] = overlayXY(ov, drawn[k], W, H)
            return { path: ex[subsFiles.length + k], x, y, from: ov.from, to: Math.min(end, ov.to) }
          })
          return exportArgs(st, srcSize, i, o, a, burn ? { ass: ex[0], fontsdir: ex[0].slice(0, ex[0].lastIndexOf('/')) } : undefined, placed, song.length ? ex[subsFiles.length + pngs.length] : undefined)
        },
        (_r, secs) => setExporting(Math.min(1, (secs * st.speed) / editLength(st.segs))),
        [...subsFiles, ...pngs, ...song],
      )
      const out = await job.current.result
      const blob = new Blob([out as BlobPart], { type: 'video/mp4' })
      const name = `${file.name.replace(/\.[^.]+$/, '') || 'video'}-edited.mp4`
      onExported(blob, name)
      setDone({ blob, name })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('video export failed', err)
        setExportError('Export failed. Try again, or make it shorter.')
      }
    } finally {
      job.current = null
      setExporting(null)
    }
  }
  // --- frame preview: CSS does what the ffmpeg filter will do.
  const st = h.state
  const [outW, outH] = outSize(st, srcSize)
  const cropping = st.aspect !== 'original' && st.fit === 'fill'
  const blurBg = st.aspect !== 'original' && st.fit === 'blur'
  const turned = st.rotate % 180 !== 0
  // object-position works in the video's own (unrotated, unmirrored) coordinates.
  const [px, py] = (() => {
    const posX = following(st) ? cropFor(st, srcSize, trackAt(st.track!, locate(segs, t).src)) : st.pos[0]
    const x = st.flip ? 1 - posX : posX
    const y = st.pos[1]
    return { 0: [x, y], 90: [y, 1 - x], 180: [1 - x, 1 - y], 270: [1 - y, x] }[st.rotate]
  })()
  const turnStyle = (fit: 'cover' | 'contain', centred = false) => ({
    width: turned ? '100cqh' : '100%',
    height: turned ? '100cqw' : '100%',
    transform: `translate(-50%, -50%)${st.flip ? ' scaleX(-1)' : ''} rotate(${st.rotate}deg)`,
    objectFit: fit,
    objectPosition: centred ? '50% 50%' : `${px * 100}% ${py * 100}%`,
  })
  const frameThumb = duration ? thumbs.srcs[Math.min(THUMBS - 1, Math.floor((locate(segs, t).src / duration) * THUMBS))] : undefined
  const bgThumb = blurBg ? frameThumb : undefined
  const look = cssFilter(st.look)
  const outT = (st.reverse ? total - t : t) / st.speed
  useSoundPreview(vid, mus, playing, outT, st.origVol, st.music, musicDur)
  const final = withAutoRes(st, hasSound)
  const [finalW, finalH] = outSize(final, srcSize)
  const est = estimate(final, srcSize, hasSound, PHONE)
  const pickMusic = (f: File) => {
    setMusicFile(f)
    setMusicDur(0)
    void probeDuration(f).then((d) => setMusicDur(d ?? 0))
    set((s) => ({ ...s, music: { name: f.name, vol: 0.8, start: 0, duck: true } }))
  }

  // Drag the picture to choose what stays in frame; a tap without a drag plays/pauses.
  const drag = useRef<{ x: number; y: number; moved: boolean; pos: [number, number] } | null>(null)
  const onFrameMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (!cropping || !d.moved) return
    const r = e.currentTarget.getBoundingClientRect()
    const [rw, rh] = turned ? [srcSize[1], srcSize[0]] : srcSize
    const k = Math.max(r.width / rw, r.height / rh)
    const ox = rw * k - r.width
    const oy = rh * k - r.height
    const clamp = (v: number) => Math.min(1, Math.max(0, v))
    set((s) => ({ ...s, track: null, pos: [ox > 1 ? clamp(d.pos[0] - dx / ox) : 0.5, oy > 1 ? clamp(d.pos[1] - dy / oy) : 0.5] }), 'pos') // dragging takes over from Follow face
  }
  const setAspect = (aspect: Aspect) => set((s) => ({ ...s, aspect, pos: [0.5, 0.5] }))
  const toggleReverse = () => (pause(), set((s) => ({ ...s, reverse: !s.reverse })))

  // --- captions
  const [cutting, setCutting] = useState(false)
  const [pauseNote, setPauseNote] = useState('')
  /** Cut every pause of 0.6 s or more (one undo step). Works from the sound, so no captions needed. */
  async function cutSilences() {
    pause()
    setCutting(true)
    setPauseNote('')
    const range: [number, number] = [Math.min(...segs.map((x) => x.from)), Math.max(...segs.map((x) => x.to))]
    try {
      const audio = await extractAudio(file, range).result
      const next = keepRanges(segs, speechRanges(audio, 16000), range[0])
      const cut = editLength(segs) - editLength(next)
      if (cut < 0.3) setPauseNote('No long pauses found.')
      else {
        set((s) => ({ ...s, segs: next }))
        seek(0)
        setPauseNote(`Cut ${cut.toFixed(1)} s of pauses. Undo brings them back.`)
      }
    } catch (err) {
      console.error('pause detection failed', err)
      setPauseNote('Couldn’t read the sound. Try again.')
    } finally {
      setCutting(false)
    }
  }

  const [reframing, setReframing] = useState<number | null>(null)
  const [reframeNote, setReframeNote] = useState('')
  const reframeJob = useRef({ cancelled: false })
  /** Follow face: find the speaker through the clip, then the crop pans to keep them centred. */
  async function followFace() {
    if (st.track) return set((s) => ({ ...s, track: null }))
    if (!url) return
    pause()
    setReframeNote('')
    setReframing(0)
    reframeJob.current = { cancelled: false }
    try {
      const { trackFaces } = await import('./reframe')
      const range: [number, number] = [Math.min(...segs.map((x) => x.from)), Math.max(...segs.map((x) => x.to))]
      const track = await trackFaces(url, range, setReframing, reframeJob.current)
      if (reframeJob.current.cancelled) return
      if (!track.length) setReframeNote('No face found, so the crop stays where you put it.')
      else set((s) => ({ ...s, track }))
    } catch (err) {
      console.error('face tracking failed', err)
      setReframeNote('Couldn’t look for faces in this video. Try again.')
    } finally {
      setReframing(null)
    }
  }
  useEffect(() => () => void (reframeJob.current.cancelled = true), [])

  async function autoCaptions() {
    pause()
    setCapError('')
    // Only the part of the source still in use.
    const range: [number, number] = [Math.min(...segs.map((x) => x.from)), Math.max(...segs.map((x) => x.to))]
    const job = transcribe(file, range, capModel, language || undefined, setCapStatus)
    capJob.current = job
    try {
      const words = await job.result
      if (!words.length) setCapError('No speech found in this clip.')
      else set((s) => ({ ...s, words }))
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('captions failed', err)
        setCapError(/fetch|network|load/i.test((err as Error).message) ? 'Couldn’t download the speech model. Check your connection and try again.' : 'Captions failed. Try again, or try the other model.')
      }
    } finally {
      capJob.current = null
      setCapStatus(null)
    }
  }
  const lines = useMemo(() => timedLines(st.words, st), [st])
  // Newest line wins where a short hold-over overlaps the next line's start.
  const caption = [...lines].reverse().find((l) => outT >= l.from && outT <= l.to)
  const seekOut = (o: number) => seek(st.reverse ? total - o * st.speed : o * st.speed)
  // --- text & stickers
  const outTotal = total / st.speed
  const sel = st.overlays.find((o) => o.id === selId)
  const setOv = (id: string, patch: Partial<Overlay>, merge?: string) => set((s) => ({ ...s, overlays: s.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) }), merge)
  const addOverlay = (kind: Overlay['kind'], text: string) => {
    const o = newOverlay(kind, text, outT > outTotal - 0.5 ? 0 : outT, outTotal)
    set((s) => ({ ...s, overlays: [...s.overlays, o] }))
    setSelId(o.id)
    setPickSticker(false)
  }
  const dropOverlay = (id: string) => (set((s) => ({ ...s, overlays: s.overlays.filter((o) => o.id !== id) })), setSelId(null))
  const ovDrag = useRef<{ id: string; x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null)
  const saveSrt = () => void saveFile(new Blob([toSrt(st.words, st)], { type: 'application/x-subrip' }), `${file.name.replace(/\.[^.]+$/, '') || 'video'}.srt`)

  const cancelExport = () => {
    job.current?.cancel()
    job.current = null
    setExporting(null)
  }

  if (error)
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
        <Morphy mood="oops" size={80} />
        <p className="max-w-sm text-text-2">{error}</p>
        <Button onClick={onClose}>Back</Button>
      </div>
    )

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
    <div className="flex flex-col gap-4 pb-24">
      <div className="flex items-center gap-2">
        <button onClick={onClose} aria-label="Close editor" className="grid size-11 place-items-center rounded-full text-text-2 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{file.name}</p>
          <p className="tabular text-xs text-text-2" aria-live="polite">
            {formatClock(outT)} / {formatClock(total / st.speed)}
          </p>
        </div>
        <IconBtn label="Undo" disabled={!h.canUndo} onClick={h.undo} d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />
        <IconBtn label="Redo" disabled={!h.canRedo} onClick={h.redo} d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
      </div>

      {musicUrl && <audio ref={mus} src={musicUrl} preload="auto" hidden />}
      <div
        className="relative mx-auto touch-none overflow-hidden rounded-card bg-black select-none"
        style={{ aspectRatio: `${outW} / ${outH}`, width: `min(100%, calc(50dvh * ${outW / outH}))`, containerType: 'size', cursor: cropping ? 'grab' : 'pointer' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, moved: false, pos: st.pos }
        }}
        onPointerMove={onFrameMove}
        onPointerUp={() => {
          if (drag.current && !drag.current.moved) {
            if (playing) pause()
            else play()
          }
          drag.current = null
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        {bgThumb && <img src={bgThumb} alt="" draggable={false} className="absolute top-1/2 left-1/2 scale-125 opacity-70" style={{ ...turnStyle('cover', true), filter: `${look === 'none' ? '' : look} blur(24px)` }} />}
        {st.overlays.map((o) => {
          const d = drawOverlay(o, outW, outH)
          const on = outT >= o.from && outT <= o.to
          if (!on && o.id !== selId) return null
          return (
            <img
              key={o.id}
              src={d.url}
              alt={o.kind === 'sticker' ? `Sticker ${o.text}` : `Text: ${o.text}`}
              draggable={false}
              className="absolute cursor-move touch-none"
              style={{
                zIndex: 2,
                left: `${(o.x - d.w / outW / 2) * 100}%`,
                top: `${(o.y - d.h / outH / 2) * 100}%`,
                width: `${(d.w / outW) * 100}%`,
                opacity: on ? 1 : 0.45, // selected but outside its time: shown faintly so you can place it
                outline: o.id === selId ? '2px dashed var(--color-accent)' : undefined,
                outlineOffset: 4,
              }}
              onPointerDown={(e) => {
                e.stopPropagation()
                e.currentTarget.setPointerCapture(e.pointerId)
                ovDrag.current = { id: o.id, x: e.clientX, y: e.clientY, ox: o.x, oy: o.y, moved: false }
              }}
              onPointerMove={(e) => {
                const d0 = ovDrag.current
                if (!d0) return
                const r = e.currentTarget.parentElement!.getBoundingClientRect()
                const dx = e.clientX - d0.x
                const dy = e.clientY - d0.y
                if (Math.abs(dx) + Math.abs(dy) > 3) d0.moved = true
                if (d0.moved) setOv(o.id, { x: Math.min(1, Math.max(0, d0.ox + dx / r.width)), y: Math.min(1, Math.max(0, d0.oy + dy / r.height)) }, `ov-move-${o.id}`)
              }}
              onPointerUp={(e) => {
                e.stopPropagation()
                if (ovDrag.current && !ovDrag.current.moved) setSelId(o.id)
                ovDrag.current = null
              }}
            />
          )
        })}
        {caption && <CaptionOverlay line={caption} t={outT} style={st.captionStyle} />}
        <video
          ref={vid}
          src={url}
          playsInline
          preload="auto"
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (!Number.isFinite(d) || !d) return setError("Couldn't read that video's length.")
            setSrcSize([e.currentTarget.videoWidth || 16, e.currentTarget.videoHeight || 9])
            // The <video> remounts after "Keep editing": keep the edit, just restore the playhead.
            if (duration) return seek(t)
            setDuration(d)
            h.reset(initialVideo(d))
          }}
          onError={() => setError("This browser can't play that video. Turn it into a Phone-friendly MP4 on Home, then edit that.")}
          onPause={() => setPlaying(false)}
          className="absolute top-1/2 left-1/2 max-w-none"
          style={{ ...turnStyle(cropping ? 'cover' : 'contain'), filter: look }}
        />
        {!duration && <div className="absolute inset-0 animate-pulse bg-surface-1" aria-busy />}
      </div>

      <div className="flex items-center gap-2">
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={() => (playing ? pause() : play())}
          disabled={!duration}
          aria-label={playing ? 'Pause' : 'Play'}
          className="grid size-14 shrink-0 place-items-center rounded-full bg-accent text-white shadow-glow outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>{playing ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}</svg>
        </motion.button>
        <Timeline segs={segs} thumbs={thumbs} duration={duration} t={t} total={total} picked={picked} onSeek={seek} />
      </div>

      {segs.length > 1 && (
        <div className="flex gap-1" aria-label="Pieces">
          {segs.map((s, i) => (
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

      <div className="flex flex-wrap gap-2">
        <Chip onClick={split} disabled={!duration}>Split at playhead</Chip>
        <Chip onClick={trimStart} disabled={!duration || t < 0.05}>Trim start to here</Chip>
        <Chip onClick={trimEnd} disabled={!duration || t > total - 0.05}>Trim end to here</Chip>
        {hasSound && <Chip onClick={cutSilences} disabled={!duration || cutting}>{cutting ? 'Finding pauses…' : 'Cut silences'}</Chip>}
        {picked.size > 0 && <Chip onClick={delPicked}>Delete {picked.size} piece{picked.size > 1 ? 's' : ''}</Chip>}
      </div>
      {pauseNote && <p role="status" className="-mt-2 text-sm text-text-2">{pauseNote}</p>}

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-2">Frame</p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {(['original', '9:16', '1:1', '4:5', '16:9'] as const).map((a) => (
            <Toggle key={a} on={st.aspect === a} onClick={() => setAspect(a)}>
              {{ original: 'Original', '9:16': '9:16 TikTok', '1:1': '1:1 Square', '4:5': '4:5 Post', '16:9': '16:9 Wide' }[a]}
            </Toggle>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {st.aspect !== 'original' && (
            <>
              <Toggle on={st.fit === 'fill'} onClick={() => set((s) => ({ ...s, fit: 'fill' }))}>Fill</Toggle>
              <Toggle on={st.fit === 'blur'} onClick={() => set((s) => ({ ...s, fit: 'blur' }))}>Blur background</Toggle>
            </>
          )}
          <Chip onClick={() => set((s) => ({ ...s, rotate: ((s.rotate + 90) % 360) as Rotation, pos: [0.5, 0.5] }))}>Rotate 90°</Chip>
          <Toggle on={st.flip} onClick={() => set((s) => ({ ...s, flip: !s.flip }))}>Mirror</Toggle>
        </div>
        {cropping && st.rotate === 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Toggle on={!!st.track} onClick={followFace}>
              {reframing !== null ? `Finding the face… ${Math.round(reframing * 100)}%` : 'Follow face'}
            </Toggle>
            {reframing !== null && <Chip onClick={() => (reframeJob.current.cancelled = true)}>Cancel</Chip>}
          </div>
        )}
        {reframeNote && <p role="status" className="text-xs text-text-2">{reframeNote}</p>}
        {cropping && <p className="text-xs text-text-2">{st.track ? 'The frame follows the speaker. Drag the picture to place it yourself instead.' : 'Drag the picture to choose what stays in frame.'}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-2">Speed</p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <Toggle on={st.reverse} onClick={toggleReverse} disabled={!st.reverse && total > MAX_REVERSE}>Reverse</Toggle>
          {SPEEDS.map((v) => (
            <Toggle key={v} on={st.speed === v} onClick={() => set((s) => ({ ...s, speed: v }))}>{v}×</Toggle>
          ))}
        </div>
        {!st.reverse && total > MAX_REVERSE && <p className="text-xs text-text-2">Reverse works on up to 1 minute. Trim it shorter first.</p>}
        {st.reverse && <p className="text-xs text-text-2">The preview plays backwards without sound; the export has sound.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-2">Look</p>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {(Object.keys(LOOKS) as LookId[]).map((id) => (
            <button
              key={id}
              aria-pressed={st.look === id}
              onClick={() => set((s) => ({ ...s, look: id }))}
              className="flex shrink-0 flex-col items-center gap-1 rounded-control text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span className={`block size-14 overflow-hidden rounded-control bg-surface-2 ring-2 ${st.look === id ? 'ring-accent' : 'ring-transparent'}`}>
                {frameThumb && <img src={frameThumb} alt="" draggable={false} className="size-full object-cover" style={{ filter: cssFilter(id) }} />}
              </span>
              <span className={st.look === id ? 'text-white' : 'text-text-2'}>{LOOKS[id].label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-2">Sound</p>
        {hasSound && (
          <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <span>
              Reduce background noise
              <span className="block text-xs text-text-2">Hiss, hum and rumble. You’ll hear it in the export.</span>
            </span>
            <input type="checkbox" checked={st.cleanVoice} disabled={st.origVol === 0} onChange={(e) => set((s) => ({ ...s, cleanVoice: e.target.checked }))} className="size-5 accent-[var(--color-accent)] disabled:opacity-40" />
          </label>
        )}
        {hasSound && <Slider label="Original sound" value={Math.round(st.origVol * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => set((s) => ({ ...s, origVol: v / 100 }), 'origVol')} />}
        {!st.music ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-full bg-surface-2 px-4 text-sm font-medium outline-none focus-within:ring-2 focus-within:ring-accent hover:bg-surface-3">
            + Add music
            <input type="file" accept="audio/*,video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && pickMusic(e.target.files[0])} />
          </label>
        ) : (
          <div className="flex flex-col gap-3 rounded-card bg-surface-1 p-3" aria-label="Music">
            <p className="truncate text-sm font-medium">♪ {st.music.name}</p>
            {!musicFile && <p className="text-xs text-text-2">The song file isn’t loaded any more. Add it again to hear and export it.</p>}
            <Slider label="Music volume" value={Math.round(st.music.vol * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => set((s) => ({ ...s, music: s.music && { ...s.music, vol: v / 100 } }), 'musicVol')} />
            {musicDur > 1 && (
              <Slider label="Song starts at" value={st.music.start} min={0} max={Math.floor(musicDur - 1)} step={0.5} unit=" s" onChange={(v) => set((s) => ({ ...s, music: s.music && { ...s.music, start: v } }), 'musicStart')} />
            )}
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              Lower the music when there’s talking
              <input
                type="checkbox"
                checked={st.music.duck}
                disabled={!hasSound || st.origVol === 0}
                onChange={(e) => set((s) => ({ ...s, music: s.music && { ...s.music, duck: e.target.checked } }))}
                className="size-5 accent-[var(--color-accent)] disabled:opacity-40"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {hasSound && st.origVol > 0 && <Chip onClick={() => set((s) => ({ ...s, origVol: 0 }))}>Replace original sound</Chip>}
              <Chip onClick={() => set((s) => ({ ...s, music: null }))}>Remove music</Chip>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-2">Text &amp; stickers</p>
        <div className="flex flex-wrap gap-2">
          <Chip onClick={() => addOverlay('text', 'Your text')} disabled={!duration}>+ Text</Chip>
          <Toggle on={pickSticker} onClick={() => setPickSticker((v) => !v)}>+ Sticker</Toggle>
          {st.overlays.map((o) => (
            <Toggle key={o.id} on={o.id === selId} onClick={() => setSelId(o.id === selId ? null : o.id)}>
              <span className="inline-block max-w-28 truncate align-bottom">{o.text.split('\n')[0] || 'Text'}</span>
            </Toggle>
          ))}
        </div>
        {pickSticker && (
          <div className="grid grid-cols-8 gap-1 rounded-card bg-surface-1 p-2">
            {STICKERS.map((e) => (
              <button key={e} aria-label={`Add sticker ${e}`} onClick={() => addOverlay('sticker', e)} className="grid aspect-square place-items-center rounded-control text-2xl outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
                {e}
              </button>
            ))}
          </div>
        )}
        {sel && (
          <div className="flex flex-col gap-3 rounded-card bg-surface-1 p-3" aria-label="Edit overlay">
            {sel.kind === 'text' && (
              <>
                <textarea
                  value={sel.text}
                  rows={2}
                  aria-label="Text"
                  onChange={(e) => setOv(sel.id, { text: e.target.value }, `ov-text-${sel.id}`)}
                  className="min-h-11 resize-none rounded-control bg-surface-2 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Toggle on={sel.style === 'outline'} onClick={() => setOv(sel.id, { style: 'outline' })}>Outline</Toggle>
                  <Toggle on={sel.style === 'box'} onClick={() => setOv(sel.id, { style: 'box' })}>Box</Toggle>
                  <span className="flex-1" />
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      aria-label={`Colour ${c}`}
                      aria-pressed={sel.color === c}
                      onClick={() => setOv(sel.id, { color: c })}
                      className={`size-9 rounded-full ring-2 outline-none focus-visible:ring-accent ${sel.color === c ? 'ring-white' : 'ring-white/15'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </>
            )}
            <Slider label="Size" value={Math.round(sel.size * 100)} min={sel.kind === 'text' ? 3 : 5} max={sel.kind === 'text' ? 20 : 40} step={1} unit="%" onChange={(v) => setOv(sel.id, { size: v / 100 }, `ov-size-${sel.id}`)} />
            <p className="tabular text-sm text-text-2">
              Shows {formatClock(sel.from)} – {formatClock(Math.min(sel.to, outTotal))}
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip onClick={() => setOv(sel.id, { from: outT, to: sel.to > outT ? sel.to : Math.min(outTotal, outT + 1) })}>Start here</Chip>
              <Chip onClick={() => setOv(sel.id, { to: Math.max(outT, sel.from + 0.1) })} disabled={outT <= sel.from}>End here</Chip>
              <Chip onClick={() => setOv(sel.id, { from: 0, to: outTotal })}>Whole video</Chip>
              <Chip onClick={() => dropOverlay(sel.id)}>Remove</Chip>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-2">Captions</p>
        {!st.words.length && !capStatus && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Toggle on={capModel === 'tiny'} onClick={() => setCapModel('tiny')}>Fast</Toggle>
              <Toggle on={capModel === 'base'} onClick={() => setCapModel('base')}>Accurate</Toggle>
              <label className="flex min-h-10 items-center gap-2 rounded-full bg-surface-2 pr-2 pl-4 text-sm">
                Language
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className="min-h-10 bg-transparent font-medium outline-none">
                  {LANGUAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>
            <Button onClick={autoCaptions} disabled={!duration || !hasSound} className="disabled:opacity-40">
              {hasSound ? 'Auto captions' : 'No sound to caption'}
            </Button>
            <p className="text-xs text-text-2">Runs on this device. The first time, it downloads the speech model ({capModel === 'tiny' ? 'about 40 MB' : 'about 80 MB'}) and keeps it for next time.</p>
          </>
        )}
        {capStatus && (
          <div className="flex items-center gap-3 rounded-card bg-surface-1 p-4" role="status">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className={`h-full rounded-full bg-accent ${capStatus.stage === 'download' ? '' : 'w-1/3 animate-pulse'}`} style={capStatus.stage === 'download' ? { width: `${Math.round(capStatus.ratio * 100)}%` } : undefined} />
            </div>
            <span className="tabular shrink-0 text-sm">
              {capStatus.stage === 'audio' ? 'Getting the sound…' : capStatus.stage === 'download' ? `Downloading model… ${Math.round(capStatus.ratio * 100)}%` : 'Listening…'}
            </span>
            <Chip onClick={() => capJob.current?.cancel()}>Cancel</Chip>
          </div>
        )}
        {capError && <p role="alert" className="text-sm text-danger">{capError}</p>}
        {st.words.length > 0 && (
          <>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {(Object.keys(CAPTION_STYLES) as CaptionStyle[]).map((k) => (
                <Toggle key={k} on={st.captionStyle === k} onClick={() => set((s) => ({ ...s, captionStyle: k }))}>{CAPTION_STYLES[k]}</Toggle>
              ))}
            </div>
            <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
              Burn captions into the video
              <input type="checkbox" checked={st.burn} onChange={(e) => set((s) => ({ ...s, burn: e.target.checked }))} className="size-5 accent-[var(--color-accent)]" />
            </label>
            <ol className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-card bg-surface-1 p-2" aria-label="Transcript">
              {lines.map((l) => (
                <li key={`${l.line.a}-${l.text}`} className={`flex items-center gap-2 rounded-control px-2 ${l === caption ? 'bg-surface-3' : ''}`}>
                  <button onClick={() => seekOut(l.from)} className="tabular min-h-10 shrink-0 text-xs text-text-2 outline-none hover:text-white focus-visible:text-accent" aria-label={`Go to ${formatClock(l.from)}`}>
                    {formatClock(l.from)}
                  </button>
                  {/* Applied on blur/Enter: regrouping lines while typing would move the cursor. */}
                  <input
                    defaultValue={l.text}
                    aria-label={`Caption at ${formatClock(l.from)}`}
                    onFocus={() => seekOut(l.from)}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    onBlur={(e) => {
                      const v = e.currentTarget.value
                      if (v.trim() && v !== l.text) set((s) => ({ ...s, words: editLine(s.words, l.line, v) }))
                    }}
                    className="min-h-10 min-w-0 flex-1 rounded-control bg-transparent px-2 text-sm outline-none focus:bg-surface-2"
                  />
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Chip onClick={saveSrt}>Download SRT</Chip>
              <Chip onClick={() => set((s) => ({ ...s, words: [] }))}>Remove captions</Chip>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2" aria-label="Export settings">
        <p className="text-sm text-text-2">Export</p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {([[0, 'Full size'], [720, '720p'], [480, '480p']] as const).map(([v, l]) => (
            <Toggle key={v} on={st.maxShort === v} onClick={() => set((s) => ({ ...s, maxShort: v }))}>{l}</Toggle>
          ))}
          <span className="w-2 shrink-0" />
          {([[0, 'Same fps'], [24, '24 fps'], [30, '30 fps'], [60, '60 fps']] as const).map(([v, l]) => (
            <Toggle key={v} on={st.fps === v} onClick={() => set((s) => ({ ...s, fps: v }))}>{l}</Toggle>
          ))}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {([['high', 'High quality'], ['standard', 'Standard'], ['small', 'Smaller file']] as [Quality, string][]).map(([v, l]) => (
            <Toggle key={v} on={!st.targetMB && st.quality === v} onClick={() => set((s) => ({ ...s, quality: v, targetMB: 0 }))}>{l}</Toggle>
          ))}
          <span className="w-2 shrink-0" />
          {[8, 25, 50].map((mb) => (
            <Toggle key={mb} on={st.targetMB === mb} onClick={() => set((s) => ({ ...s, targetMB: s.targetMB === mb ? 0 : mb }))}>Under {mb} MB</Toggle>
          ))}
        </div>
        {final.maxShort !== st.maxShort && <p className="text-xs text-text-2">To fit under {st.targetMB} MB and still look clean, it exports at {finalW}×{finalH}.</p>}
      </div>

      {exporting !== null && <Ad />}

      <div className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] -mx-4 flex flex-col gap-2 bg-linear-to-t from-bg from-70% to-transparent px-4 pt-6 pb-[max(16px,env(safe-area-inset-bottom))] sm:bottom-0">
        {exportError && <p role="alert" className="text-center text-sm text-danger">{exportError}</p>}
        {exporting !== null ? (
          <div className="flex gap-2">
            <Button variant="primary" disabled className="flex-1 disabled:opacity-100">Exporting… {Math.round(exporting * 100)}%</Button>
            <Button onClick={cancelExport}>Cancel</Button>
          </div>
        ) : (
          <Button variant="primary" onClick={doExport} disabled={!duration} className="disabled:bg-surface-3 disabled:text-text-2 disabled:shadow-none">
            Export MP4 · {formatDuration(total / st.speed)} · {finalW}×{finalH}
          </Button>
        )}
        {exporting === null && duration > 0 && (
          <p className="tabular text-center text-xs text-text-2">
            about {formatBytes(est.bytes)} · takes about {formatSpan(est.seconds)} on this {PHONE ? 'phone' : 'computer'}
          </p>
        )}
      </div>
    </div>
  )
}

/** Small frames across the whole source, grabbed by seeking a hidden <video>. */
type Thumbs = { srcs: (string | undefined)[]; aspect: number }

function useThumbs(url: string | undefined, duration: number): Thumbs {
  const [thumbs, setThumbs] = useState<Thumbs>({ srcs: [], aspect: 16 / 9 })
  useEffect(() => {
    if (!url || !duration) return
    let alive = true
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    const next = (ev: 'loadedmetadata' | 'seeked') => new Promise((r) => v.addEventListener(ev, r, { once: true }))
    ;(async () => {
      v.src = url
      await next('loadedmetadata')
      const hgt = 64
      const c = document.createElement('canvas')
      c.height = hgt
      c.width = Math.max(1, Math.round((hgt * v.videoWidth) / Math.max(1, v.videoHeight)))
      if (alive) setThumbs((cur) => ({ ...cur, aspect: c.width / hgt }))
      const g = c.getContext('2d')!
      for (let k = 0; k < THUMBS && alive; k++) {
        v.currentTime = ((k + 0.5) * duration) / THUMBS
        await next('seeked')
        g.drawImage(v, 0, 0, c.width, c.height)
        const src = c.toDataURL('image/jpeg', 0.6)
        if (alive) setThumbs((cur) => ({ ...cur, srcs: Object.assign([...cur.srcs], { [k]: src }) }))
      }
    })().catch(() => {}) // thumbnails are decoration; the editor works without them
    return () => {
      alive = false
      v.removeAttribute('src')
      v.load()
    }
  }, [url, duration])
  return thumbs
}

function Timeline({ segs, thumbs, duration, t, total, picked, onSeek }: { segs: Seg[]; thumbs: Thumbs; duration: number; t: number; total: number; picked: Set<number>; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // As many frames as fit a piece at their own shape, each the nearest grabbed frame to its spot.
  const inPiece = (s: Seg) => {
    const len = s.to - s.from
    const count = Math.max(1, Math.round((width * len) / Math.max(total, 0.001) / (64 * thumbs.aspect)))
    return [...Array(count).keys()].map((j) => Math.min(THUMBS - 1, Math.floor(((s.from + ((j + 0.5) * len) / count) / Math.max(duration, 0.001)) * THUMBS)))
  }
  const fromX = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(((e.clientX - r.left) / r.width) * total)
  }
  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Timeline"
      aria-valuemin={0}
      aria-valuemax={Math.round(total * 10) / 10}
      aria-valuenow={Math.round(t * 10) / 10}
      aria-valuetext={`${formatClock(t)} of ${formatClock(total)}`}
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), fromX(e))}
      onPointerMove={(e) => e.buttons && fromX(e)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 5 : 1
        if (e.key === 'ArrowLeft') onSeek(t - step)
        else if (e.key === 'ArrowRight') onSeek(t + step)
        else if (e.key === 'Home') onSeek(0)
        else if (e.key === 'End') onSeek(total)
        else return
        e.preventDefault()
      }}
      className="relative flex h-16 min-w-0 flex-1 cursor-pointer touch-none gap-px overflow-hidden rounded-card bg-surface-1 outline-none select-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {segs.map((s, i) => (
        <div key={i} style={{ flexGrow: s.to - s.from, flexBasis: 0 }} className={`flex min-w-1 overflow-hidden ${picked.has(i) ? 'opacity-50 ring-2 ring-accent ring-inset' : ''}`}>
          {inPiece(s).map((k, j) =>
            thumbs.srcs[k] ? <img key={j} src={thumbs.srcs[k]} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" /> : <div key={j} className="h-full min-w-0 flex-1 bg-surface-2" />,
          )}
        </div>
      ))}
      <div className="pointer-events-none absolute -inset-y-px w-1 -translate-x-1/2 rounded-full bg-white ring-1 ring-black/70" style={{ left: `${(t / Math.max(total, 0.001)) * 100}%` }} />
    </div>
  )
}

/** Live caption, drawn to match what libass burns in (same font, sizes relative to the frame). */
function CaptionOverlay({ line, t, style }: { line: TimedLine; t: number; style: CaptionStyle }) {
  const L = CAPTION_LOOK
  const em = L.size * 100 // ASS font size (a line height) in cqmin; outline and shadow scale from it
  const i = activeWord(line, t)
  return (
    <p
      className="pointer-events-none absolute text-center text-white"
      style={{
        zIndex: 1,
        left: `${L.marginH * 100}%`,
        right: `${L.marginH * 100}%`,
        bottom: `${L.marginV * 100}%`,
        fontFamily: "'Inter Variable', Inter, sans-serif",
        fontWeight: 800,
        fontSize: `${em / ASS_EM}cqmin`,
        lineHeight: ASS_EM,
        textWrap: 'balance', // libass WrapStyle 0 also balances two-line captions
        // libass draws its outline outside the glyph; a centred stroke twice as wide, under the fill, matches.
        WebkitTextStroke: `${em * L.outline * 2}cqmin black`,
        paintOrder: 'stroke fill',
        textShadow: `${em * L.shadow}cqmin ${em * L.shadow}cqmin 0 rgb(0 0 0 / 0.5)`,
      }}
    >
      {line.words.map((w, k) => {
        const lit = k === i && style !== 'plain'
        let el = <span style={lit ? { color: L.hl } : undefined}>{w.text}</span>
        if (style === 'pop' && lit)
          el = (
            <motion.span key={`${line.line.a}-${k}`} initial={{ scale: 1.25 }} animate={{ scale: 1 }} transition={{ duration: 0.15 }} className="inline-block" style={{ color: L.hl }}>
              {w.text}
            </motion.span>
          )
        if (style === 'karaoke') {
          const end = line.words[k + 1]?.from ?? line.to
          const p = k < i ? 100 : k > i ? 0 : Math.min(100, Math.max(0, ((t - w.from) / Math.max(0.01, end - w.from)) * 100))
          // A yellow copy over the white word, clipped to the sung part. Not background-clip: text: Safari paints the stroke over it.
          el = (
            <span className="relative inline-block">
              {w.text}
              <span aria-hidden className="absolute inset-0" style={{ color: L.hl, clipPath: `inset(0 ${100 - p}% 0 0)` }}>{w.text}</span>
            </span>
          )
        }
        return (
          <Fragment key={k}>
            {k > 0 && ' '}
            {el}
          </Fragment>
        )
      })}
    </p>
  )
}
