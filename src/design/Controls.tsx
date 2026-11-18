// Small shared editor controls (audio + video editors).
import type { ReactNode } from 'react'

export function IconBtn({ label, d, onClick, disabled }: { label: string; d: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} className="grid size-11 place-items-center rounded-full bg-surface-2 outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-35">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
    </button>
  )
}
export function Chip({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="min-h-10 shrink-0 rounded-full bg-surface-2 px-4 text-sm font-medium outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-accent active:scale-97 disabled:opacity-40">
      {children}
    </button>
  )
}
export function Toggle({ children, on, onClick, disabled }: { children: ReactNode; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={on} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-97 disabled:opacity-40 ${on ? 'bg-accent text-white' : 'bg-surface-2 hover:bg-surface-3'}`}>
      {children}
    </button>
  )
}
export function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="tabular text-text-2">{value > 0 && unit === 'dB' ? '+' : ''}{value}{unit}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 accent-[var(--color-accent)]" />
    </label>
  )
}
