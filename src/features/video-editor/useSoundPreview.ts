// Live sound for the preview: original level, music kept in step with the playhead, and
// ducking that listens to the original sound and dips the music (same settings as export).
import { useEffect, useRef, type RefObject } from 'react'
import { DUCK, type Music } from './model'

type Graph = { ctx: AudioContext; video: HTMLMediaElement; music: HTMLMediaElement; orig: GainNode; mg: GainNode; an: AnalyserNode; buf: Float32Array<ArrayBuffer> }

// A media element can only be wired into Web Audio once, so the graph is built lazily (first
// play with ducking on) and rebuilt only if the <video> element itself is replaced.
function build(video: HTMLMediaElement, music: HTMLMediaElement): Graph {
  const ctx = new AudioContext()
  const orig = ctx.createGain()
  const an = ctx.createAnalyser()
  an.fftSize = 1024
  ctx.createMediaElementSource(video).connect(orig)
  orig.connect(an)
  orig.connect(ctx.destination)
  const mg = ctx.createGain()
  ctx.createMediaElementSource(music).connect(mg).connect(ctx.destination)
  return { ctx, video, music, orig, mg, an, buf: new Float32Array(an.fftSize) }
}

const setVolume = (el: HTMLMediaElement, v: number) => {
  el.volume = v
}

export function useSoundPreview(
  vid: RefObject<HTMLVideoElement | null>,
  mus: RefObject<HTMLAudioElement | null>,
  playing: boolean,
  outT: number,
  origVol: number,
  music: Music | null,
  musicDur: number,
) {
  const graph = useRef<Graph | null>(null)
  const outRef = useRef(outT)
  useEffect(() => {
    outRef.current = outT
  }, [outT])

  useEffect(() => {
    const v = vid.current
    const m = mus.current
    if (!v) return
    let g = graph.current && graph.current.video === v ? graph.current : null
    if (!g && playing && music?.duck && origVol > 0 && m && musicDur) {
      void graph.current?.ctx.close()
      g = graph.current = build(v, m)
    }
    // Music removed and added again: a new <audio> element, wired into the existing graph.
    if (g && m && g.music !== m) {
      g.ctx.createMediaElementSource(m).connect(g.mg)
      g.music = m
    }
    if (g) {
      void g.ctx.resume()
      g.orig.gain.value = origVol
    } else setVolume(v, Math.min(1, origVol))
    if (!playing || !music || !m || !musicDur) {
      m?.pause()
      return
    }
    setVolume(m, g ? 1 : music.vol)
    let duck = 1
    let last = performance.now()
    let raf = 0
    const tick = () => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      // Follow the playhead (cuts, seeks and speed all move it); loop like the export.
      const want = (music.start + outRef.current) % musicDur
      if (Math.abs(m.currentTime - want) > 0.3) m.currentTime = want
      if (m.paused) void m.play().catch(() => {})
      if (g) {
        let target = 1
        if (music.duck && origVol > 0) {
          g.an.getFloatTimeDomainData(g.buf)
          let sum = 0
          for (const x of g.buf) sum += x * x
          if (Math.sqrt(sum / g.buf.length) > DUCK.threshold) target = DUCK.previewGain
        }
        const tau = (target < duck ? DUCK.attackMs : DUCK.releaseMs) / 1000
        duck += (target - duck) * Math.min(1, dt / tau)
        g.mg.gain.value = music.vol * duck
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      m.pause()
    }
  }, [playing, music, origVol, musicDur, vid, mus])
}
