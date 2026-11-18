// "Follow face": find the main face every ⅓ s with MediaPipe's face detector (on this device, files bundled,
// no CDN), then smooth it into a calm camera path that only pans when the face really moves.
import { FaceDetector } from '@mediapipe/tasks-vision'
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import modelAssetPath from './models/blaze_face_short_range.tflite?url'
import type { TrackPoint } from './model'

const STEP = 1 / 3 // seconds between looks
const HOLD = 0.08 // the face must move this far (fraction of the width) before the frame follows
const PAN = 0.6 // seconds a pan takes

/** Face centres over source seconds [from, to]; [] when no face was found. */
export async function trackFaces(url: string, [from, to]: [number, number], onProgress: (ratio: number) => void, signal: { cancelled: boolean }): Promise<TrackPoint[]> {
  const detector = await FaceDetector.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, { baseOptions: { modelAssetPath, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 })
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = url
  try {
    await new Promise((ok, fail) => ((v.onloadeddata = ok), (v.onerror = () => fail(new Error('video did not load')))))
    const raw: { t: number; x: number | null }[] = []
    for (let t = from; t <= to && !signal.cancelled; t += STEP) {
      await new Promise((ok) => ((v.onseeked = ok), (v.currentTime = t)))
      const faces = detector.detect(v).detections.flatMap((d) => (d.boundingBox ? [d.boundingBox] : []))
      const big = faces.sort((a, b) => b.width * b.height - a.width * a.height)[0] // the biggest face is the speaker
      raw.push({ t, x: big ? (big.originX + big.width / 2) / v.videoWidth : null })
      onProgress((t - from) / Math.max(STEP, to - from))
    }
    return smoothTrack(raw)
  } finally {
    detector.close()
    v.removeAttribute('src')
  }
}

/** Fill gaps, drop flicker (median of 5), then hold still until the face moves more than HOLD, and pan over PAN s. */
export function smoothTrack(raw: { t: number; x: number | null }[]): TrackPoint[] {
  const first = raw.find((p) => p.x !== null)
  if (!first) return []
  let last = first.x!
  const filled = raw.map((p) => (last = p.x ?? last))
  const med = filled.map((_, i) => {
    const w = filled.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b)
    return w[Math.floor(w.length / 2)]
  })
  const out: TrackPoint[] = [{ t: raw[0].t, x: med[0] }]
  let cur = med[0]
  let busyUntil = -Infinity
  raw.forEach((p, i) => {
    if (p.t < busyUntil || Math.abs(med[i] - cur) <= HOLD) return
    out.push({ t: p.t, x: cur }, { t: p.t + PAN, x: med[i] })
    cur = med[i]
    busyUntil = p.t + PAN
  })
  return out
}
