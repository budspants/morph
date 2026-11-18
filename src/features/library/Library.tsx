import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../design/Button'
import { Morphy } from '../../design/Morphy'
import { saveFile } from '../convert/export'
import { formatBytes } from '../convert/format'
import { deleteFile, storageUse, useLibrary, type LibFile } from './db'
import { useObjectUrl } from '../../app/useObjectUrl'

const when = (t: number) => {
  const d = new Date(t)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** Object URL for a blob, revoked when the component goes away. */
function Thumb({ f, className = '' }: { f: LibFile; className?: string }) {
  const url = useObjectUrl(f.kind === 'audio' ? undefined : f.blob)
  return (
    <div className={`relative grid place-items-center overflow-hidden bg-surface-3 ${className}`}>
      {f.kind === 'image' && url && <img src={url} alt="" className="size-full object-cover" loading="lazy" />}
      {f.kind === 'video' && url && <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />}
      {f.kind === 'audio' && (
        <div className="grid size-full place-items-center bg-linear-to-br from-accent/40 to-accent-2/30 text-white">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
          </svg>
        </div>
      )}
    </div>
  )
}

/** Home's "Recent" row. */
export function RecentRow({ onOpen }: { onOpen: (id: string) => void }) {
  const files = useLibrary()
  if (!files?.length) return null
  return (
    <section aria-label="Recent files" className="flex flex-col gap-2">
      <p className="text-sm text-text-2">Recent</p>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {files.slice(0, 10).map((f) => (
          <button
            key={f.id}
            onClick={() => onOpen(f.id)}
            className="flex w-28 shrink-0 flex-col gap-1.5 rounded-card text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Thumb f={f} className="aspect-square w-full rounded-card" />
            <span className="truncate px-0.5 text-xs font-medium">{f.name}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export function Library({ openId, onOpened, onEdit }: { openId?: string | null; onOpened?: () => void; onEdit?: (f: File, mode?: 'audio' | 'video') => void }) {
  const files = useLibrary()
  const [q, setQ] = useState('')
  const [grid, setGrid] = useState(() => localStorage.getItem('morph.libview') !== 'list')
  const [picked, setPicked] = useState<string | null>(null)
  const [use, setUse] = useState<{ used: number; quota: number } | null>(null)

  useEffect(() => {
    void storageUse().then(setUse)
  }, [files])
  // A file opened from Home's recent row arrives as `openId`.
  const open = files?.find((f) => f.id === (picked ?? openId)) ?? null
  const close = () => {
    setPicked(null)
    onOpened?.()
  }

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (files ?? []).filter((f) => !s || `${f.name} ${f.source} ${f.preset}`.toLowerCase().includes(s))
  }, [files, q])

  const toggle = (g: boolean) => {
    setGrid(g)
    try {
      localStorage.setItem('morph.libview', g ? 'grid' : 'list')
    } catch {
      /* not remembered */
    }
  }

  if (files === null) return <div className="h-40 animate-pulse rounded-card bg-surface-1" aria-label="Loading library" />

  if (!files.length)
    return (
      <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 text-center">
        <Morphy mood="idle" size={88} />
        <p className="text-xl font-semibold">Nothing here yet</p>
        <p className="max-w-xs text-text-2">Everything you convert shows up here, saved on this device only.</p>
      </div>
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={files.length > 1 ? `Search ${files.length} files` : "Search"}
          aria-label="Search library"
          className="min-h-11 min-w-0 flex-1 rounded-full bg-surface-2 px-4 outline-none placeholder:text-text-2 focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex rounded-full bg-surface-2 p-1" role="group" aria-label="View">
          {[true, false].map((g) => (
            <button
              key={String(g)}
              aria-pressed={grid === g}
              aria-label={g ? 'Grid view' : 'List view'}
              onClick={() => toggle(g)}
              className={`grid size-9 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent ${grid === g ? 'bg-surface-3 text-white' : 'text-text-2'}`}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                {g ? <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /> : <path d="M4 6h16M4 12h16M4 18h16" />}
              </svg>
            </button>
          ))}
        </div>
      </div>

      {use && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuenow={use.used} aria-valuemin={0} aria-valuemax={use.quota} aria-label="Storage used">
            <div className="h-full rounded-full bg-linear-to-r from-accent to-accent-2" style={{ width: `${Math.max(1, (use.used / use.quota) * 100)}%` }} />
          </div>
          <p className="tabular text-xs text-text-2">
            {formatBytes(use.used)} used · {formatBytes(Math.max(0, use.quota - use.used))} free on this device
          </p>
        </div>
      )}

      {!shown.length && <p className="py-10 text-center text-text-2">No files match “{q}”.</p>}

      {grid ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {shown.map((f) => (
            <button key={f.id} onClick={() => setPicked(f.id)} className="flex flex-col gap-1.5 rounded-card text-left outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <Thumb f={f} className="aspect-square w-full rounded-card" />
              <span className="truncate px-0.5 text-sm font-medium">{f.name}</span>
              <span className="tabular -mt-1 px-0.5 text-xs text-text-2">
                {formatBytes(f.size)} · {when(f.createdAt)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((f) => (
            <button key={f.id} onClick={() => setPicked(f.id)} className="flex items-center gap-3 rounded-card bg-surface-1 p-2 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
              <Thumb f={f} className="size-12 shrink-0 rounded-control" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.name}</span>
                <span className="tabular block truncate text-xs text-text-2">
                  {f.preset} · {formatBytes(f.size)} · {when(f.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>{open && <Preview key={open.id} f={open} onClose={close} onEdit={onEdit} />}</AnimatePresence>
    </div>
  )
}

function Preview({ f, onClose, onEdit }: { f: LibFile; onClose: () => void; onEdit?: (f: File, mode?: 'audio' | 'video') => void }) {
  const url = useObjectUrl(f.blob)
  const [confirm, setConfirm] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal aria-label={f.name}>
      <motion.button aria-label="Close" className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-sheet bg-surface-2 p-6 pb-[max(24px,env(safe-area-inset-bottom))] sm:rounded-sheet"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        {url && f.kind === 'image' && <img src={url} alt={f.name} className="max-h-[50dvh] w-full rounded-card object-contain" />}
        {url && f.kind === 'video' && <video src={url} controls playsInline className="max-h-[50dvh] w-full rounded-card bg-black" />}
        {url && f.kind === 'audio' && (
          <>
            <Thumb f={f} className="aspect-[2/1] w-full rounded-card" />
            <audio src={url} controls className="w-full" />
          </>
        )}
        <div>
          <p className="text-lg font-semibold [overflow-wrap:anywhere]">{f.name}</p>
          <p className="tabular text-sm text-text-2">
            {f.preset} · {formatBytes(f.size)} · from {f.source}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={async () => {
            if (await saveFile(f.blob, f.name)) setSaved(true)
          }}
        >
          {saved ? '✓ Saved · save again' : 'Save'}
        </Button>
        {onEdit && f.kind === 'video' && (
          <Button
            onClick={() => {
              onClose()
              onEdit(new File([f.blob], f.name, { type: f.type }), 'video')
            }}
          >
            Edit video
          </Button>
        )}
        {onEdit && f.kind !== 'image' && (
          <Button
            onClick={() => {
              onClose()
              onEdit(new File([f.blob], f.name, { type: f.type }), 'audio')
            }}
          >
            Edit audio
          </Button>
        )}
        <Button
          onClick={async () => {
            if (!confirm) return setConfirm(true)
            await deleteFile(f.id)
            onClose()
          }}
          className={confirm ? 'text-danger' : ''}
        >
          {confirm ? 'Tap again to delete for good' : 'Delete from library'}
        </Button>
      </motion.div>
    </div>
  )
}
