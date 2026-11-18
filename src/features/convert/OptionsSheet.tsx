import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Button } from '../../design/Button'
import { formatBytes, formatSpan } from './format'
import { FORMATS, timeEstimate, type Ctx, type Field, type Opts, type Preset } from './presets'

type Choice = [label: string, value: number | string]

// Choices per field; some depend on the preset (GIF sizes are smaller than video sizes).
function choices(f: Field, p: Preset): Choice[] {
  switch (f) {
    case 'format': return (p.formats ?? []).map((id) => [FORMATS[id].label, id])
    case 'audioKbps': return [['96k', 96], ['128k', 128], ['192k', 192], ['256k', 256], ['320k', 320]]
    case 'sampleRate': return [['Keep', 0], ['44.1 kHz', 44100], ['48 kHz', 48000]]
    case 'channels': return [['Keep', 0], ['Mono', 1], ['Stereo', 2]]
    case 'height':
      if ((p.baseId ?? p.id) === 'gif') return [['240p', 240], ['360p', 360], ['480p', 480]]
      if ((p.baseId ?? p.id) === 'vertical') return [['720×1280', 1280], ['1080×1920', 1920]]
      return [['Keep', 0], ['1080p', 1080], ['720p', 720], ['480p', 480]]
    case 'fps': return (p.baseId ?? p.id) === 'gif' ? [['8', 8], ['12', 12], ['15', 15], ['24', 24]] : [['Keep', 0], ['24', 24], ['30', 30], ['60', 60]]
    case 'crf': return [['Smaller', 28], ['Balanced', 23], ['Best', 18]]
    case 'quality': return [['Smaller', 0.7], ['Balanced', 0.85], ['Best', 0.95]]
    case 'maxSide': return [['Keep', 0], ['4096', 4096], ['2048', 2048], ['1080', 1080]]
    case 'targetMB': return [['8 MB', 8], ['10 MB', 10], ['25 MB', 25], ['50 MB', 50]]
    case 'every': return [['½ s', 0.5], ['1 s', 1], ['2 s', 2], ['5 s', 5], ['10 s', 10]]
    case 'fit': return [['Blurred bars', 'blur'], ['Crop to fill', 'crop']]
    case 'bg': return [['Transparent', 'none'], ['White', 'white'], ['Black', 'black']]
    case 'size': return [['75%', 'p75'], ['50%', 'p50'], ['25%', 'p25'], ['1080 wide', 'w1080'], ['2048 wide', 'w2048'], ['Square 1080', 'c1080x1080'], ['Story 1080×1920', 'c1080x1920'], ['Post 1080×1350', 'c1080x1350']]
    case 'targetKB': return [['100 KB', 100], ['250 KB', 250], ['500 KB', 500], ['1 MB', 1000]]
    default: return []
  }
}

const LABEL: Record<Field, string> = {
  format: 'Format', audioKbps: 'Bitrate', sampleRate: 'Sample rate', channels: 'Channels', height: 'Resolution',
  fps: 'Frame rate', crf: 'Quality', quality: 'Quality', maxSide: 'Longest side', targetMB: 'Target size',
  start: 'Start at (seconds)', length: 'Length (seconds)', every: 'One frame every', fit: 'Fit',
  size: 'Size', targetKB: 'Largest file size', rename: 'Rename (optional)', bg: 'Background',
}

export function OptionsSheet({ preset, initial, ctx, onClose, onRun, onSave }: {
  preset: Preset
  initial: Opts
  ctx: Ctx
  onClose: () => void
  onRun: (o: Opts) => void
  onSave: (o: Opts) => void
}) {
  const [o, setO] = useState<Opts>(initial)
  const set = (f: Field, v: unknown) => setO((cur) => ({ ...cur, [f]: v }))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const size = preset.estimate?.(o, ctx)
  const secs = timeEstimate(preset, o, ctx)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={`${preset.title} options`}>
      <motion.button
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-sheet bg-surface-2 p-6 pb-[max(24px,env(safe-area-inset-bottom))] sm:rounded-sheet"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_, i) => i.offset.y > 120 && onClose()}
      >
        <div className="mx-auto -mt-2 mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <h2 className="text-xl font-semibold">{preset.title}</h2>
        <p className="tabular mt-1 h-5 text-sm text-text-2">
          {[size && `about ${formatBytes(size)}`, secs && `takes ~${formatSpan(secs)}`].filter(Boolean).join(' · ')}
        </p>

        <div className="mt-5 flex flex-col gap-5">
          {preset.fields.map((f) => {
            const opts = choices(f, preset)
            return (
              <fieldset key={f} className="flex flex-col gap-2">
                <legend className="mb-2 text-sm text-text-2">{LABEL[f]}</legend>
                {opts.length ? (
                  <div className="flex flex-wrap gap-2">
                    {opts.map(([label, v]) => (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={o[f] === v}
                        onClick={() => set(f, v)}
                        className={`min-h-11 rounded-full px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                          o[f] === v ? 'bg-accent text-white' : 'bg-surface-3 text-text-1 hover:bg-white/10'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    {f === 'size' && (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={16}
                        aria-label="Custom width in pixels"
                        placeholder="Width px"
                        className="tabular min-h-11 w-32 rounded-full bg-surface-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        onChange={(e) => Number(e.target.value) >= 16 && set(f, `w${Math.round(Number(e.target.value))}`)}
                      />
                    )}
                    {f === 'targetKB' && (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={10}
                        aria-label="Custom size in KB"
                        placeholder="Custom KB"
                        className="tabular min-h-11 w-32 rounded-full bg-surface-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        onChange={(e) => Number(e.target.value) >= 10 && set(f, Number(e.target.value))}
                      />
                    )}
                    {f === 'targetMB' && (
                      <input
                        type="number"
                        inputMode="decimal"
                        min={1}
                        aria-label="Custom size in MB"
                        placeholder="Custom MB"
                        className="tabular min-h-11 w-32 rounded-full bg-surface-3 px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        onChange={(e) => Number(e.target.value) > 0 && set(f, Number(e.target.value))}
                      />
                    )}
                  </div>
                ) : f === 'rename' ? (
                  <>
                    <input
                      type="text"
                      value={o.rename ?? ''}
                      placeholder="{name}-{n}"
                      aria-label="Rename pattern"
                      onChange={(e) => set(f, e.target.value)}
                      className="min-h-11 rounded-control bg-surface-3 px-4 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                    <p className="text-xs text-text-2">{'{name}'} original name · {'{n}'} 1, 2, 3… · {'{date}'} today. Example: holiday-{'{n}'}</p>
                  </>
                ) : (
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={o[f] as number | undefined ?? ''}
                    onChange={(e) => set(f, e.target.value === '' ? undefined : Number(e.target.value))}
                    className="tabular min-h-11 w-40 rounded-control bg-surface-3 px-4 outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  />
                )}
              </fieldset>
            )
          })}
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <Button variant="primary" onClick={() => onRun(o)}>Convert</Button>
          <button type="button" onClick={() => onSave(o)} className="min-h-11 text-sm font-medium text-text-2 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent rounded-control">
            Save as my preset
          </button>
        </div>
      </motion.div>
    </div>
  )
}
