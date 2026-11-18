// Circular progress; `value` is 0–1, or undefined for an indeterminate spin.
export function ProgressRing({ value, size = 160 }: { value?: number; size?: number }) {
  const r = 70
  const c = 2 * Math.PI * r
  const pct = value === undefined ? undefined : Math.round(value * 100)
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="relative grid place-items-center"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 160 160" className={`absolute inset-0 -rotate-90 ${pct === undefined ? 'animate-spin motion-reduce:animate-none' : ''}`}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth="10" />
        <circle
          cx="80"
          cy="80"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - (value ?? 0.25))}
          style={{ transition: 'stroke-dashoffset 250ms var(--ease-out)' }}
        />
      </svg>
      <span className="tabular text-3xl font-semibold">{pct === undefined ? '' : `${pct}%`}</span>
    </div>
  )
}
