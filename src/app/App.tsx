import { MotionConfig } from 'motion/react'
import { lazy, Suspense, useCallback, useState } from 'react'
import { HomeTop } from '@personal'
import type { Output } from '../features/convert/convertOne'
import { ConvertFlow } from '../features/convert/ConvertFlow'
import type { Item } from '../features/convert/useBatch'
import { addFile, useLibrary } from '../features/library/db'
import { Morphy } from '../design/Morphy'
import { Library, RecentRow } from '../features/library/Library'

// The editor loads only when first opened, so Home stays fast.
const Editor = lazy(() => import('../features/audio-editor/Editor').then((m) => ({ default: m.Editor })))
const VideoEditor = lazy(() => import('../features/video-editor/VideoEditor').then((m) => ({ default: m.VideoEditor })))

export type EditMode = 'audio' | 'video'
const modeFor = (f: File): EditMode => (f.type.startsWith('video/') ? 'video' : 'audio')

type Tab = 'home' | 'editor' | 'library'

export default function App() {
  // Editor-tool landing pages (captions, trim) set <html data-tab="editor"> in scripts/seo-pages.mjs.
  const [tab, setTab] = useState<Tab>(() => (document.documentElement.dataset.tab === 'editor' ? 'editor' : 'home'))
  const [openId, setOpenId] = useState<string | null>(null)
  const keep = useCallback((out: Output, it: Item) => {
    void addFile(out.blob, out.name, it.file.name, it.choice?.preset.title ?? '')
  }, [])
  const opened = useCallback(() => setOpenId(null), [])
  const [editing, setEditing] = useState<{ file: File; mode: EditMode } | null>(null)
  const edit = useCallback((file: File, mode = modeFor(file)) => {
    setEditing({ file, mode })
    setTab('editor')
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-6 p-4 pb-28 sm:p-8">
        <header className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">
            morph<span className="text-accent-2">.</span>
          </h1>
          <Tabs tab={tab} setTab={setTab} className="hidden sm:flex" />
        </header>
        {/* Home stays mounted so a running batch survives a trip to the Library. */}
        <main className="flex-1" hidden={tab !== 'home'}>
          <ConvertFlow
            top={HomeTop && <HomeTop />}
            onOutput={keep}
            onEdit={edit}
            below={
              <RecentRow
                onOpen={(id) => {
                  setOpenId(id)
                  setTab('library')
                }}
              />
            }
          />
        </main>
        {tab === 'library' && (
          <main className="flex-1">
            <Library openId={openId} onOpened={opened} onEdit={edit} />
          </main>
        )}
        {tab === 'editor' && (
          <main className="flex-1">
            {editing ? (
              <Suspense fallback={<div className="h-36 animate-pulse rounded-card bg-surface-1" />}>
                {editing.mode === 'video' ? (
                  <VideoEditor
                    key={`${editing.file.name}-${editing.file.size}-${editing.file.lastModified}`}
                    file={editing.file}
                    onClose={() => setEditing(null)}
                    onExported={(blob, name) => void addFile(blob, name, editing.file.name, 'Video editor')}
                  />
                ) : (
                  <Editor
                    key={`${editing.file.name}-${editing.file.size}-${editing.file.lastModified}`}
                    file={editing.file}
                    onClose={() => setEditing(null)}
                    onExported={(blob, name) => void addFile(blob, name, editing.file.name, 'Audio editor')}
                  />
                )}
              </Suspense>
            ) : (
              <EditorStart onPick={edit} />
            )}
          </main>
        )}
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 sm:hidden">
        <Tabs tab={tab} setTab={setTab} className="flex justify-around" />
      </nav>
    </MotionConfig>
  )
}

const TABS: [Tab, string, string][] = [
  ['home', 'Home', 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  ['editor', 'Editor', 'M4 12h2M8 7v10M12 4v16M16 8v8M20 11v2'],
  ['library', 'Library', 'M4 4h6v16H4zM14 4l6 1.5-3.5 14.5-6-1.5z'],
]

function Tabs({ tab, setTab, className }: { tab: Tab; setTab: (t: Tab) => void; className: string }) {
  return (
    <div className={className} role="tablist" aria-label="Sections">
      {TABS.map(([id, label, d]) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          onClick={() => setTab(id)}
          className={`flex min-h-14 min-w-20 flex-col items-center justify-center gap-0.5 rounded-control px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-10 sm:flex-row sm:gap-2 sm:text-sm ${
            tab === id ? 'text-white' : 'text-text-2 hover:text-white'
          }`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill={tab === id ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden className={tab === id ? 'text-accent' : ''}>
            <path d={d} />
          </svg>
          {label}
        </button>
      ))}
    </div>
  )
}

/** Editor tab with nothing open: pick a file or a recent audio/video file from the library. */
function EditorStart({ onPick }: { onPick: (f: File) => void }) {
  const files = useLibrary()?.filter((f) => f.kind !== 'image').slice(0, 8) ?? []
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Morphy mood="idle" size={80} />
        <h1 className="text-xl font-semibold text-balance">{document.documentElement.dataset.headline ?? 'Edit audio or video'}</h1>
        <p className="max-w-xs text-text-2">Cut, trim and split clips, or add effects like slowed + reverb to a song. Everything stays on this device.</p>
        <label className="mt-2 flex min-h-12 cursor-pointer items-center rounded-control bg-accent px-6 font-medium text-white shadow-glow focus-within:ring-2 focus-within:ring-white">
          Choose a file
          <input type="file" accept="audio/*,video/*" className="sr-only" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
        </label>
      </div>
      {files.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-2">From your library</p>
          {files.map((f) => (
            <button key={f.id} onClick={() => onPick(new File([f.blob], f.name, { type: f.type }))} className="flex min-h-12 items-center rounded-card bg-surface-1 px-4 text-left text-sm font-medium outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent">
              <span className="truncate">{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
