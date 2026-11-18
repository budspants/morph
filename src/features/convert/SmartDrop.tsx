// Smart Drop (spec: signature feature): guess what you want from the file and your history,
// ready in one tap. Plain rules for now; history beats rules.
import { motion } from 'motion/react'
import { Morphy } from '../../design/Morphy'
import { history, optsFor } from './prefs'
import { isHeic, presets, type Opts, type Preset } from './presets'
import type { Choice, Item } from './useBatch'

type Guess = { preset: Preset; opts?: Opts; line: string }
const byId = (id: string) => presets.find((p) => p.id === id)

function guess(it: Item, all: Preset[] = presets): Guess | undefined {
  const ext = it.file.name.split('.').pop()?.toLowerCase() ?? ''
  const name = it.file.name.toLowerCase()
  const label = (p: Preset) => p.title.toLowerCase()

  // 1. What you picked last time for this kind of file (same extension wins).
  const past = history().filter((h) => h.kind === it.ctx.kind)
  const last = past.find((h) => h.ext === ext) ?? past[0]
  const lastPreset = last && all.find((p) => p.id === last.preset && !p.askFirst)
  if (lastPreset) return { preset: lastPreset, line: `Same as last time: ${label(lastPreset)}?` }

  // 2. Rules.
  const mb = it.file.size / 1e6
  if (it.ctx.kind === 'image') return { preset: byId('image')!, opts: { format: 'jpg' }, line: isHeic(it.file) ? 'iPhone photo → JPG that opens anywhere?' : 'Turn it into a JPG?' }
  if (it.ctx.kind === 'audio') {
    if (/voice|memo|recording|new recording/.test(name) || ext === 'm4a') return { preset: byId('mp3')!, line: 'Voice memo → MP3?' }
    if (ext === 'wav' || ext === 'aiff' || ext === 'flac') return { preset: byId('mp3')!, line: `Big ${ext.toUpperCase()} → MP3 to save space?` }
    return { preset: byId('mp3')!, line: 'Make it an MP3?' }
  }
  if (mb > 25) return { preset: byId('shrink')!, opts: { targetMB: 25 }, line: `${Math.round(mb)} MB video → shrink to 25 MB for email?` }
  return { preset: byId('mp3')!, line: 'Just the audio, as an MP3?' }
}

export function SmartDrop({ item, presets: all, run }: { item: Item; presets: Preset[]; run: (c: Choice) => void }) {
  const g = guess(item, all)
  if (!g) return null
  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => run({ preset: g.preset, opts: { ...optsFor(g.preset), ...g.opts } })}
      className="flex items-center gap-3 rounded-card bg-linear-to-r from-accent/20 to-accent-2/10 p-4 text-left outline-none ring-1 ring-accent/40 focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Morphy mood="happy" size={44} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium uppercase tracking-wider text-accent-2">Smart Drop</span>
        <span className="block font-semibold">{g.line}</span>
      </span>
      <span className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white">Do it</span>
    </motion.button>
  )
}
