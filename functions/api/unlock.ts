// Cloudflare Pages Function: GET /api/unlock?session=cs_… answers whether that Stripe Checkout Session is a
// paid "Remove ads" purchase. The secret key stays here (a Pages secret), never in the browser.
// Secrets: STRIPE_SECRET_KEY (a restricted key that can only read Checkout Sessions),
// STRIPE_PAYMENT_LINK (plink_… of the Remove ads link, so other purchases on the account don't count).
interface Env {
  STRIPE_SECRET_KEY: string
  STRIPE_PAYMENT_LINK?: string
}

// No 5xx statuses: Cloudflare replaces 502/503 bodies on the custom domain with its own error page.
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const id = new URL(request.url).searchParams.get('session') ?? ''
  if (!/^cs_(live|test)_[A-Za-z0-9]{10,200}$/.test(id)) return json({ ok: false, error: 'That code doesn’t look right. It starts with cs_.' }, 400)
  if (!env.STRIPE_SECRET_KEY) return json({ ok: false, error: 'Purchases can’t be checked right now.' }, 424)
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${id}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } })
  if (res.status === 404) return json({ ok: false, error: 'No purchase found for that code.' }, 404)
  // `stripe` is Stripe's status (401 bad key, 403 missing permission), for diagnosing setup; it holds nothing secret.
  if (!res.ok) return json({ ok: false, error: 'Couldn’t check the purchase. Try again in a minute.', stripe: res.status }, 424)
  const s = (await res.json()) as { payment_status?: string; payment_link?: string | null }
  const ok = s.payment_status === 'paid' && (!env.STRIPE_PAYMENT_LINK || s.payment_link === env.STRIPE_PAYMENT_LINK)
  return ok ? json({ ok: true }) : json({ ok: false, error: 'That purchase isn’t a paid MORPH “Remove ads”.' }, 403)
}
