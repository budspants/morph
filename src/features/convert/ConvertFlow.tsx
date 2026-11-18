import { Ad } from '../money/Ad'
import { OutputPreview } from './OutputPreview'
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react'
import { Button } from '../../design/Button'
import { Morphy } from '../../design/Morphy'
import { ProgressRing } from '../../design/ProgressRing'
import type { Output } from './convertOne'
import { saveAll, saveFile } from './export'
import { formatBytes, formatDuration, formatElapsed, formatEta, formatSpan } from './format'
import { OptionsSheet } from './OptionsSheet'
import { SmartDrop } from './SmartDrop'
import { customPresets, optsFor, rememberOpts, saveCustomPreset } from './prefs'
import { outFormat, presetsFor, timeEstimate, type Ctx, type Kind, type Preset } from './presets'
import { batchEta, MAX_FILES, useBatch, type Choice, type Item } from './useBatch'

/** Tool landing pages (scripts/seo-pages.mjs) set <html data-headline>, e.g. "Compress a video to a size". */
const HEADLINE = typeof document !== 'undefined' ? document.documentElement.dataset.headline : undefined

const KIND_LABEL: Record<Kind, [string, string]> = { video: ['video', 'videos'], audio: ['audio file', 'audio files'], image: ['image', 'images'] }

/**
 * Home: drop zone, presets, batch queue, results.
 * `top`: optional content above the drop zone.
 * `onOutput`: called with every finished file (the library stores them).
 * `below`: shown under the drop zone on the idle screen (recent files).
 */
export function ConvertFlow({ top, below, onOutput, onEdit }: {
  top?: ReactNode
  below?: ReactNode
  /** Open a finished audio/video file in the editor. */
  onEdit?: (file: File, mode?: 'audio' | 'video') => void
  onOutput?: (out: Output, item: Item) => void
}) {
  const onDone = useCallback((it: Item) => it.out && onOutput?.(it.out, it), [onOutput])
  const b = useBatch(onDone)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState('')
  const [sheet, setSheet] = useState<{ preset: Preset; ctx: Ctx; apply: (c: Choice) => void } | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const [custom, setCustom] = useState(customPresets)
  const inputRef = useRef<HTMLInputElement>(null)
  const { add } = b

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files.length) return
      const refused = add(files)
      setNotice(
        refused
          ? refused === files.length
            ? 'That file type isn’t supported yet. Try a video, audio or image file.'
            : `${refused} file${refused > 1 ? 's' : ''} skipped (unsupported, or over ${MAX_FILES}).`
          : '',
      )
    },
    [add],
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])]
      if (files.length) addFiles(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addFiles])

  const { items } = b
  const single = items.length === 1 ? items[0] : undefined
  const finished = items.length > 0 && items.every((i) => i.status === 'done' || i.status === 'error')
  const screen = !items.length ? 'idle' : b.running || b.paused ? 'working' : finished ? 'done' : 'ready'
  // A light tap when a file finishes (Android; iPhone browsers have no vibration API).
  const doneOk = screen === 'done' && items.every((it) => it.status === 'done')
  useEffect(() => {
    if (doneOk) navigator.vibrate?.(12)
  }, [doneOk])

  const presetsForKind = (k: Kind) => [...custom.filter((p) => p.kinds.includes(k)), ...presetsFor(k)]

  function runSingle(it: Item, c: Choice) {
    rememberOpts(c.preset, c.opts)
    b.choose((x) => x.id === it.id, c)
    void b.start()
  }
  const openSheet = (preset: Preset, ctx: Ctx, apply: (c: Choice) => void) => setSheet({ preset, ctx, apply })
  const save = async (it: Item) => {
    if (it.out && (await saveFile(it.out.blob, it.out.name))) setSaved((s) => new Set(s).add(it.id))
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles([...e.dataTransfer.files])
  }

  return (
    <div
      className="flex min-h-[70dvh] flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,audio/*,image/*,.mkv,.mov,.webm,.flac,.ogg,.opus,.m4a,.heic,.heif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          addFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
      <AnimatePresence mode="wait">
        <motion.section
          key={`${screen}-${single ? 1 : 'n'}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-1 flex-col gap-4"
          aria-live="polite"
        >
          {screen === 'idle' && (
            <>
              {top}
              {HEADLINE && <h1 className="text-center text-2xl font-semibold tracking-tight text-balance">{HEADLINE}</h1>}
              <motion.button
                onClick={() => inputRef.current?.click()}
                whileTap={{ scale: 0.98 }}
                animate={{ scale: dragging ? 1.02 : 1 }}
                className={`flex min-h-56 flex-1 flex-col items-center justify-center gap-3 rounded-sheet border border-dashed p-8 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
                  dragging ? 'border-accent bg-accent/10 shadow-glow' : 'border-white/15 bg-surface-1'
                }`}
              >
                <Morphy mood={dragging ? 'catch' : 'idle'} />
                <span className="text-2xl font-semibold tracking-tight">{dragging ? 'Let go' : 'Drop anything'}</span>
                <span className="text-text-2">or tap to choose videos, audio or images</span>
              </motion.button>
              {notice && <p className="text-center text-sm text-danger">{notice}</p>}
              <p className="text-center text-sm text-text-2">
                <LockIcon /> Files never leave your device
              </p>
              <Ad />
              {below}
            </>
          )}

          {/* ---------- one file: the 3-tap flow ---------- */}
          {screen === 'ready' && single && (
            <>
              <FileCard file={single.file} duration={single.ctx.duration} onClear={b.clear} />
              <SmartDrop item={single} presets={presetsForKind(single.ctx.kind)} run={(c) => runSingle(single, c)} />
              <p className="text-sm text-text-2">Turn it into</p>
              <PresetGrid
                presets={presetsForKind(single.ctx.kind)}
                ctx={single.ctx}
                onPick={(p) => (p.askFirst ? openSheet(p, single.ctx, (c) => runSingle(single, c)) : runSingle(single, { preset: p, opts: optsFor(p) }))}
                onOptions={(p) => openSheet(p, single.ctx, (c) => runSingle(single, c))}
              />
              {onEdit && single.ctx.kind === 'video' && (
                <Button onClick={() => onEdit(single.file, 'video')}>Edit video instead</Button>
              )}
            </>
          )}

          {screen === 'working' && single && (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <ProgressRing value={single.progress > 0 ? single.progress : undefined} />
              <p className="text-lg font-semibold">{single.progress > 0 ? 'Morphing…' : 'Warming up…'}</p>
              <p className="tabular h-6 text-text-2">{etaText(single, b.elapsed()) ?? single.file.name}</p>
              <Button onClick={b.stop} className="mt-6 w-full max-w-xs">
                Cancel
              </Button>
              <div className="mt-6 w-full">
                <Ad />
              </div>
            </div>
          )}

          {screen === 'done' && single?.status === 'done' && single.out && (
            <div className="flex flex-1 flex-col">
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
                {/^(image|video)\//.test(single.out.blob.type) ? <OutputPreview blob={single.out.blob} /> : <Morphy mood="happy" size={88} />}
                <p className="mt-2 text-xl font-semibold [overflow-wrap:anywhere]">{single.out.name}</p>
                <p className="tabular text-text-2">
                  {formatBytes(single.out.blob.size)} · done in {formatElapsed((single.ms ?? 0) / 1000)}
                </p>
                {single.out.blob.type.startsWith('audio/') && (
                  <div className="mt-3 flex w-full justify-center">
                    <OutputPreview blob={single.out.blob} />
                  </div>
                )}
                <p role="status" className="h-6 text-sm font-medium text-accent">
                  {saved.has(single.id) && '✓ Saved'}
                </p>
                {single.choice?.preset.guide && <p className="max-w-sm text-sm text-text-2">{single.choice.preset.guide(single.choice.opts)}</p>}
              </div>
              <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
                <Button variant="primary" onClick={() => save(single)}>
                  {saved.has(single.id) ? 'Save again' : 'Save'}
                </Button>
                {onEdit && single.out.blob.type.startsWith('video/') && (
                  <Button onClick={() => onEdit(new File([single.out!.blob], single.out!.name, { type: single.out!.blob.type }), 'video')}>Edit video</Button>
                )}
                {onEdit && /^(audio|video)\//.test(single.out.blob.type) && (
                  <Button onClick={() => onEdit(new File([single.out!.blob], single.out!.name, { type: single.out!.blob.type }), 'audio')}>Edit audio</Button>
                )}
                <Button onClick={b.clear}>Convert another</Button>
              </div>
            </div>
          )}

          {screen === 'done' && single?.status === 'error' && (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Morphy mood="oops" size={80} />
              <p className="text-xl font-semibold">{single.error?.title}</p>
              <p className="max-w-sm text-text-2">{single.error?.fix}</p>
              <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
                <Button variant="primary" onClick={() => b.reset(single.id)}>
                  Try again
                </Button>
                <Button onClick={b.clear}>Choose another file</Button>
              </div>
            </div>
          )}

          {/* ---------- several files: the batch queue ---------- */}
          {items.length > 1 && (
            <Batch
              b={b}
              screen={screen}
              saved={saved}
              presetsForKind={presetsForKind}
              onAddMore={() => inputRef.current?.click()}
              onOptions={openSheet}
              onSave={save}
              onSaveAll={async () => {
                const done = items.filter((i) => i.out)
                if (await saveAll(done.map((i) => i.out!))) setSaved(new Set(done.map((i) => i.id)))
              }}
            />
          )}
        </motion.section>
      </AnimatePresence>

      <AnimatePresence>
        {sheet && (
          <OptionsSheet
            key={sheet.preset.id}
            preset={sheet.preset}
            initial={optsFor(sheet.preset)}
            ctx={sheet.ctx}
            onClose={() => setSheet(null)}
            onRun={(opts) => {
              setSheet(null)
              rememberOpts(sheet.preset, opts)
              sheet.apply({ preset: sheet.preset, opts })
            }}
            onSave={(opts) => {
              saveCustomPreset(sheet.preset, `My ${sheet.preset.title.toLowerCase()} · ${outFormat(sheet.preset, opts, sheet.ctx.kind).label}`, opts)
              setCustom(customPresets())
              setSheet(null)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function etaText(it: Item, elapsedMs: number) {
  if (it.progress < 0.03) return undefined
  return formatEta((elapsedMs / 1000 / it.progress) * (1 - it.progress))
}

function PresetGrid({ presets, ctx, selected, onPick, onOptions }: {
  presets: Preset[]
  ctx: Ctx
  selected?: string
  onPick: (p: Preset) => void
  onOptions: (p: Preset) => void
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {presets.map((p) => (
        <PresetCard key={p.id} p={p} ctx={ctx} selected={selected === p.id} onPick={() => onPick(p)} onOptions={() => onOptions(p)} />
      ))}
    </div>
  )
}

function PresetCard({ p, ctx, selected, onPick, onOptions }: { p: Preset; ctx: Ctx; selected: boolean; onPick: () => void; onOptions: () => void }) {
  const id = useId()
  const opts = useMemo(() => optsFor(p), [p])
  const size = p.estimate?.(opts, ctx)
  const secs = timeEstimate(p, opts, ctx)
  const detail = [
    p.askFirst ? 'Pick a size' : outFormat(p, opts, ctx.kind).label,
    !p.askFirst && size ? `about ${formatBytes(size)}` : '',
    secs ? `~${formatSpan(secs)}` : '',
  ].filter(Boolean).join(' · ')
  return (
    <div className={`flex items-stretch rounded-card transition-colors ${selected ? 'bg-accent/15 ring-2 ring-accent' : 'bg-surface-2 hover:bg-surface-3'}`}>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={onPick}
        aria-pressed={selected || undefined}
        className="flex min-w-0 flex-1 items-center gap-4 rounded-card p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-control bg-accent/15 text-accent">
          <PresetIcon name={p.icon} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span id={id} className="text-lg font-semibold">{p.title}</span>
          <span className="tabular truncate text-sm text-text-2">{detail}</span>
        </span>
      </motion.button>
      {p.fields.length > 0 && (
        <button
          type="button"
          onClick={onOptions}
          aria-label="Options"
          aria-describedby={id}
          className="grid w-12 shrink-0 place-items-center rounded-r-card text-text-2 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" {...icon} aria-hidden>
            <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" />
            <circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
          </svg>
        </button>
      )}
    </div>
  )
}

type B = ReturnType<typeof useBatch>

// Sticky actions sit on a solid fade so cards never show through.
const FOOTER = 'sticky bottom-[calc(57px+env(safe-area-inset-bottom))] -mx-4 sm:bottom-0 mt-2 flex flex-col gap-2 bg-linear-to-t from-bg from-70% to-transparent px-4 pt-6 pb-[max(16px,env(safe-area-inset-bottom))]'

function Batch({ b, screen, saved, presetsForKind, onAddMore, onOptions, onSave, onSaveAll }: {
  b: B
  screen: string
  saved: Set<string>
  presetsForKind: (k: Kind) => Preset[]
  onAddMore: () => void
  onOptions: (p: Preset, ctx: Ctx, apply: (c: Choice) => void) => void
  onSave: (it: Item) => void
  onSaveAll: () => void
}) {
  const { items } = b
  const kinds = [...new Set(items.map((i) => i.ctx.kind))]
  const [group, setGroup] = useState<Partial<Record<Kind, string>>>({})
  const doneCount = items.filter((i) => i.status === 'done').length
  const failed = items.filter((i) => i.status === 'error').length
  const missing = items.filter((i) => i.status === 'waiting' && !i.choice)
  const eta = batchEta(items, b.elapsed())
  const overall = items.reduce((s, i) => s + (i.status === 'done' || i.status === 'error' ? 1 : i.status === 'working' ? i.progress : 0), 0) / items.length

  // A group pick applies to every file of that kind, except files given their own preset.
  const applyGroup = (k: Kind, c: Choice) => {
    rememberOpts(c.preset, c.opts)
    setGroup((g) => ({ ...g, [k]: c.preset.id }))
    b.choose((it) => it.ctx.kind === k && (!it.choice || it.choice.preset.id === group[k]), c)
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {screen === 'done'
            ? `${doneCount} done${failed ? ` · ${failed} failed` : ''}`
            : screen === 'working'
              ? `Converting ${Math.min(items.length, doneCount + failed + 1)} of ${items.length}`
              : `${items.length} files`}
        </h2>
        <span className="tabular text-sm text-text-2">
          {screen === 'working' ? (b.paused ? 'Paused' : eta !== undefined ? formatEta(eta) : 'Warming up…') : ''}
        </span>
      </div>
      {screen === 'working' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(overall * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Overall progress">
          <div className="h-full rounded-full bg-linear-to-r from-accent to-accent-2 transition-[width] duration-300" style={{ width: `${overall * 100}%` }} />
        </div>
      )}

      <Reorder.Group axis="y" values={items.map((i) => i.id)} onReorder={b.reorder} className="flex flex-col gap-2">
        {items.map((it) => (
          <Row
            key={it.id}
            it={it}
            editable={screen === 'ready'}
            saved={saved.has(it.id)}
            presets={presetsForKind(it.ctx.kind)}
            onChoose={(p) => b.choose((x) => x.id === it.id, p ? { preset: p, opts: optsFor(p) } : undefined)}
            onRemove={() => b.remove(it.id)}
            onSave={() => onSave(it)}
            onRetry={() => {
              b.retry(it.id)
              void b.start()
            }}
          />
        ))}
      </Reorder.Group>

      {screen === 'ready' && (
        <>
          {items.length < MAX_FILES && (
            <button type="button" onClick={onAddMore} className="min-h-11 self-start rounded-full px-1 text-sm font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent">
              + Add more files
            </button>
          )}
          {kinds.map((k) => {
            const ofKind = items.filter((i) => i.ctx.kind === k)
            const total = ofKind.reduce((s, i) => s + (i.ctx.duration ?? 0), 0)
            const ctx: Ctx = { ...ofKind[0].ctx, size: ofKind.reduce((s, i) => s + i.file.size, 0), duration: total || undefined }
            return (
              <div key={k} className="flex flex-col gap-3">
                <p className="text-sm text-text-2">{kinds.length > 1 ? `For the ${ofKind.length > 1 ? `${ofKind.length} ` : ''}${KIND_LABEL[k][ofKind.length > 1 ? 1 : 0]}` : `Turn all ${ofKind.length} into`}</p>
                <PresetGrid
                  presets={presetsForKind(k)}
                  ctx={ctx}
                  selected={group[k]}
                  onPick={(p) => (p.askFirst ? onOptions(p, ctx, (c) => applyGroup(k, c)) : applyGroup(k, { preset: p, opts: optsFor(p) }))}
                  onOptions={(p) => onOptions(p, ctx, (c) => applyGroup(k, c))}
                />
              </div>
            )
          })}
          <div className={FOOTER}>
            <Button variant="primary" disabled={missing.length > 0} onClick={() => void b.start()} className="disabled:bg-surface-3 disabled:text-text-2 disabled:shadow-none">
              {missing.length ? `Pick a preset for ${missing.length} more` : `Convert ${items.filter((i) => i.status === 'waiting').length} files`}
            </Button>
            <Button onClick={b.clear}>Clear all</Button>
          </div>
        </>
      )}

      {screen === 'working' && (
        <div className={FOOTER}>
          {b.paused ? (
            <>
              <Button variant="primary" onClick={() => void b.start()}>Resume</Button>
              <Button onClick={b.stop}>Stop and change settings</Button>
            </>
          ) : (
            <Button onClick={b.pause}>Pause</Button>
          )}
        </div>
      )}

      {screen === 'done' && (
        <div className={FOOTER}>
          {doneCount > 0 && (
            <Button variant="primary" onClick={onSaveAll}>
              {doneCount > 1 ? `Save all ${doneCount}` : 'Save'}
            </Button>
          )}
          <Button onClick={b.clear}>Convert more</Button>
        </div>
      )}
    </>
  )
}

function Row({ it, editable, saved, presets, onChoose, onRemove, onSave, onRetry }: {
  it: Item
  editable: boolean
  saved: boolean
  presets: Preset[]
  onChoose: (p: Preset | undefined) => void
  onRemove: () => void
  onSave: () => void
  onRetry: () => void
}) {
  const drag = useDragControls()
  const pickable = presets.filter((p) => !p.askFirst || it.choice?.preset.id === p.id)
  return (
    <Reorder.Item value={it.id} dragListener={false} dragControls={drag} className="flex items-center gap-3 rounded-card bg-surface-1 p-3">
      {editable && (
        <button
          type="button"
          aria-label={`Drag to reorder ${it.file.name}`}
          onPointerDown={(e) => drag.start(e)}
          className="grid size-8 shrink-0 cursor-grab touch-none place-items-center text-text-2 active:cursor-grabbing"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
          </svg>
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{it.out?.name ?? it.file.name}</p>
        <p className="tabular truncate text-xs text-text-2">
          {it.status === 'done' && it.out ? (
            `${formatBytes(it.out.blob.size)}${saved ? ' · ✓ Saved' : ''}`
          ) : it.status === 'error' ? (
            <span className="text-danger">{it.error?.title}</span>
          ) : it.status === 'working' ? (
            `${Math.round(it.progress * 100)}%`
          ) : (
            `${formatBytes(it.file.size)}${it.ctx.duration ? ` · ${formatDuration(it.ctx.duration)}` : ''}`
          )}
        </p>
        {it.status === 'working' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(4, it.progress * 100)}%` }} />
          </div>
        )}
        {editable && it.status === 'waiting' && (
          <select
            aria-label={`Preset for ${it.file.name}`}
            value={it.choice?.preset.id ?? ''}
            onChange={(e) => onChoose(pickable.find((p) => p.id === e.target.value))}
            className="mt-2 min-h-9 w-full max-w-60 rounded-full bg-surface-3 px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Choose a preset…</option>
            {pickable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        )}
      </div>
      {it.status === 'done' && (
        <button type="button" onClick={onSave} className="min-h-9 shrink-0 rounded-full bg-surface-3 px-4 text-sm font-medium outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent">
          Save
        </button>
      )}
      {it.status === 'error' && (
        <button type="button" onClick={onRetry} className="min-h-9 shrink-0 rounded-full bg-surface-3 px-4 text-sm font-medium outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent">
          Retry
        </button>
      )}
      {editable && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${it.file.name}`} className="grid size-9 shrink-0 place-items-center rounded-full text-text-2 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </Reorder.Item>
  )
}

function FileCard({ file, duration, onClear }: { file: File; duration?: number; onClear: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-card bg-surface-1 p-4">
      <div className="grid size-11 shrink-0 place-items-center rounded-control bg-surface-3 text-accent">
        <FileIcon />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{file.name}</p>
        <p className="tabular text-sm text-text-2">
          {formatBytes(file.size)}
          {duration ? ` · ${formatDuration(duration)}` : ''}
        </p>
      </div>
      <button
        onClick={onClear}
        aria-label="Remove file"
        className="grid size-11 place-items-center rounded-full text-text-2 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

const icon = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const ICON_PATHS: Record<Preset['icon'], ReactNode> = {
  audio: <><path d="M3 18v-6a9 9 0 0 1 18 0v6" /><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z" /></>,
  studio: <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />,
  shrink: <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
  gif: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 10.5h-1a1.5 1.5 0 0 0 0 3h1v-1.5M11 10v4M14 14v-4h2.5M14 12h2" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="m10.5 9.5 3 2.5-3 2.5z" /></>,
  vertical: <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M3 8v8M21 8v8" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></>,
  frames: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>,
  ring: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  cutout: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="10" r="2.5" /><path d="M7.5 17a4.5 4.5 0 0 1 9 0" /></>,
}
const PresetIcon = ({ name }: { name: Preset['icon'] }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" {...icon} aria-hidden>
    {ICON_PATHS[name]}
  </svg>
)
const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" {...icon} className="mr-1 inline -translate-y-px" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const FileIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" {...icon} aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m10 9 5 3-5 3z" />
  </svg>
)
