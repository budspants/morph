// Remembered settings (spec: "remembered settings", "saved custom presets"). localStorage
// is fine here: losing it only resets choices to defaults.
import { presets, type Kind, type Opts, type Preset } from './presets'

const read = <T,>(key: string, fallback: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback
  } catch {
    return fallback
  }
}
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode or full: settings just aren't remembered */
  }
}

/** Last options used for a preset, on top of its defaults. */
export const optsFor = (p: Preset): Opts => ({ ...p.defaults, ...read<Opts>(`morph.opts.${p.id}`, {}) })
export const rememberOpts = (p: Preset, o: Opts) => write(`morph.opts.${p.id}`, o)

type Saved = { id: string; base: string; title: string; opts: Opts }
export function customPresets(): Preset[] {
  return read<Saved[]>('morph.presets', []).flatMap((s) => {
    const base = presets.find((p) => p.id === s.base)
    return base ? [{ ...base, id: s.id, baseId: base.id, title: s.title, defaults: { ...base.defaults, ...s.opts }, askFirst: false }] : []
  })
}
export function saveCustomPreset(base: Preset, title: string, opts: Opts) {
  const list = read<Saved[]>('morph.presets', [])
  list.unshift({ id: `my-${Date.now().toString(36)}`, base: base.baseId ?? base.id, title, opts })
  write('morph.presets', list.slice(0, 12))
}
export function deleteCustomPreset(id: string) {
  write('morph.presets', read<Saved[]>('morph.presets', []).filter((s) => s.id !== id))
}

// History for Smart Drop: which preset was picked for which kind of file, newest first.
export type Pick = { kind: Kind; preset: string; at: number; ext: string }
export const history = () => read<Pick[]>('morph.history', [])
export function recordPick(p: Pick) {
  write('morph.history', [p, ...history()].slice(0, 50))
}
