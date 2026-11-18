// One AdSense slot, plus the "Remove ads" offer. Renders nothing until VITE_ADSENSE_CLIENT and
// VITE_ADSENSE_SLOT are set, and nothing for people who bought "Remove ads".
// Consent (EU/UK) comes from Google's own consent message, switched on in AdSense > Privacy & messaging.
import { useEffect, useRef, useState } from 'react'
import { activate, claimed, PRO_CHECKOUT, PRO_PRICE, proCode, usePro } from './pro'

const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT as string | undefined
const SLOT = import.meta.env.VITE_ADSENSE_SLOT as string | undefined
let scriptAdded = false

export function Ad() {
  const pro = usePro()
  const ref = useRef<HTMLModElement>(null)
  const on = !!CLIENT && !!SLOT && !pro
  const [thanks, setThanks] = useState(() => pro && claimed.result === 'unlocked')
  useEffect(() => {
    if (!on) return
    if (!scriptAdded) {
      const s = document.createElement('script')
      s.async = true
      s.crossOrigin = 'anonymous'
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`
      document.head.append(s)
      scriptAdded = true
    }
    if (ref.current?.dataset.adsbygoogleStatus) return // StrictMode runs effects twice; fill each slot once
    try {
      const w = window as unknown as { adsbygoogle?: unknown[] }
      ;(w.adsbygoogle ??= []).push({})
    } catch {
      // ad blockers make this throw; the app works the same without ads
    }
  }, [on])
  if (thanks)
    return (
      <div role="status" className="flex w-full max-w-sm flex-col gap-2 self-center rounded-card bg-surface-1 p-4 text-sm">
        <p className="font-semibold">Ads removed. Thank you!</p>
        <p className="text-text-2">To remove ads on your other devices too, enter this code there under “Remove ads”:</p>
        <code className="rounded-control bg-surface-3 px-3 py-2 text-xs break-all select-all">{proCode()}</code>
        <button onClick={() => ((claimed.result = null), setThanks(false))} className="min-h-11 self-end px-3 text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent">Done</button>
      </div>
    )
  if (!on) return null
  return (
    <aside aria-label="Advertisement" className="flex flex-col items-center gap-1">
      <span className="text-[11px] tracking-wide text-text-2 uppercase">Ad</span>
      <ins ref={ref} className="adsbygoogle block w-full" style={{ display: 'block', minHeight: 90 }} data-ad-client={CLIENT} data-ad-slot={SLOT} data-ad-format="auto" data-full-width-responsive="true" />
      <RemoveAds />
    </aside>
  )
}

function RemoveAds() {
  // Coming back from checkout but the check failed: open with the code and the reason.
  const failed = claimed.result && claimed.result !== 'unlocked' ? claimed : null
  const [open, setOpen] = useState(!!failed)
  const [key, setKey] = useState(failed?.code ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(failed?.result ?? null)
  if (!PRO_CHECKOUT) return null
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="min-h-11 px-3 text-sm text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent">
        Remove ads – {PRO_PRICE} once
      </button>
    )
  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-card bg-surface-1 p-4 text-sm">
      <p>Pay once and MORPH never shows ads on this device again. After paying you come straight back here, ad-free.</p>
      <a href={PRO_CHECKOUT} rel="noopener" className="grid min-h-11 place-items-center rounded-full bg-accent font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-white">
        Buy for {PRO_PRICE}
      </a>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(await activate(key))
          setBusy(false)
        }}
      >
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Code from another device (cs_…)" aria-label="Purchase code" autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-full bg-surface-3 px-4 outline-none focus-visible:ring-2 focus-visible:ring-accent" />
        <button disabled={busy || !key.trim()} className="min-h-11 rounded-full bg-surface-3 px-4 font-medium outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent">
          {busy ? 'Checking…' : 'Activate'}
        </button>
      </form>
      {error && <p role="alert" className="text-danger">{error}</p>}
    </div>
  )
}
