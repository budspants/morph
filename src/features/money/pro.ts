// "Remove ads": a one-time purchase on Lemon Squeezy gives a licence key; activating it here keeps ads off
// on this device. Off until VITE_PRO_CHECKOUT_URL is set. The key is checked once, at activation.
import { useSyncExternalStore } from 'react'

export const PRO_CHECKOUT = import.meta.env.VITE_PRO_CHECKOUT_URL as string | undefined
export const PRO_PRICE = (import.meta.env.VITE_PRO_PRICE as string | undefined) ?? '$10'
const PRODUCT = import.meta.env.VITE_PRO_PRODUCT_ID as string | undefined
const KEY = 'morph.pro'
const EVENT = 'morph-pro'

export function isPro(): boolean {
  try {
    return !!localStorage.getItem(KEY)
  } catch {
    return false
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

/** Activate a licence key. Returns an error message, or null when ads are now off. */
export async function activate(licenseKey: string): Promise<string | null> {
  let data: { activated?: boolean; error?: string; instance?: { id?: string }; meta?: { product_id?: number } } | null = null
  try {
    const res = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ license_key: licenseKey.trim(), instance_name: 'morph-web' }),
    })
    data = await res.json()
  } catch {
    return 'Couldn’t reach the licence server. Check your connection and try again.'
  }
  if (!data?.activated) return data?.error ?? 'That key didn’t work.'
  if (PRODUCT && String(data.meta?.product_id) !== PRODUCT) return 'That key is for a different product.'
  try {
    localStorage.setItem(KEY, JSON.stringify({ key: licenseKey.trim(), instance: data.instance?.id }))
  } catch {
    return 'This browser won’t let MORPH save the key (private mode?).'
  }
  window.dispatchEvent(new Event(EVENT))
  return null
}
