// "Remove ads": a one-time Stripe purchase (Payment Link). Stripe sends the buyer back to
// usemorph.app/?unlock={CHECKOUT_SESSION_ID}; /api/unlock (functions/api/unlock.ts) checks that session with
// the secret key on Cloudflare. The session ID is the buyer's code for their other devices.
// Off until VITE_PRO_CHECKOUT_URL (the Payment Link) is set.
import { useSyncExternalStore } from 'react'

export const PRO_CHECKOUT = import.meta.env.VITE_PRO_CHECKOUT_URL as string | undefined
export const PRO_PRICE = (import.meta.env.VITE_PRO_PRICE as string | undefined) ?? '$10'
const KEY = 'morph.pro'
const EVENT = 'morph-pro'

function read(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
export const isPro = () => !!read()
/** The buyer's code (Stripe Checkout Session ID), to unlock their other devices. */
export const proCode = () => {
  try {
    return (JSON.parse(read() ?? '{}') as { code?: string }).code ?? null
  } catch {
    return null
  }
}

export const usePro = () =>
  useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb)
      return () => window.removeEventListener(EVENT, cb)
    },
    isPro,
  )

/** Check a purchase code with the server. Returns an error message, or null when ads are now off. */
export async function activate(code: string): Promise<string | null> {
  const session = code.trim()
  let data: { ok?: boolean; error?: string } | null = null
  try {
    data = await (await fetch(`/api/unlock?session=${encodeURIComponent(session)}`)).json()
  } catch {
    return 'Couldn’t reach MORPH to check the purchase. Check your connection and try again.'
  }
  if (!data?.ok) return data?.error ?? 'That code didn’t work.'
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: session }))
  } catch {
    return 'This browser won’t let MORPH save the purchase (private mode?).'
  }
  window.dispatchEvent(new Event(EVENT))
  return null
}

/** Result of coming back from checkout this visit: 'unlocked', an error message, or null. Read by the Ad component. */
export const claimed: { result: string | null; code: string | null } = { result: null, code: null }

/** Coming back from Stripe Checkout: unlock from ?unlock=cs_…, then tidy the address bar. Run before the first render. */
export async function claimFromUrl() {
  const url = new URL(location.href)
  const code = url.searchParams.get('unlock')
  if (!code) return
  url.searchParams.delete('unlock')
  history.replaceState(null, '', url)
  claimed.code = code
  claimed.result = (await activate(code)) ?? 'unlocked'
}
