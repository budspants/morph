// Self-check for functions/api/unlock.ts against a fake Stripe API. Run: npm run test:unlock
import assert from 'node:assert/strict'
import { onRequestGet } from '../functions/api/unlock.ts'
const sessions: Record<string, object> = {
  cs_test_paid000000000: { payment_status: 'paid', payment_link: 'plink_ours' },
  cs_test_unpaid0000000: { payment_status: 'unpaid', payment_link: 'plink_ours' },
  cs_test_other00000000: { payment_status: 'paid', payment_link: 'plink_other' },
}
let auth = ''
globalThis.fetch = (async (url: string, init: { headers: Record<string, string> }) => {
  auth = init.headers.Authorization
  if (url.includes('cs_test_boom')) return new Response('', { status: 500 })
  const s = sessions[url.split('/').pop()!]
  return s ? new Response(JSON.stringify(s)) : new Response('{}', { status: 404 })
}) as typeof fetch
const env = { STRIPE_SECRET_KEY: 'rk_test_x', STRIPE_PAYMENT_LINK: 'plink_ours' }
const call = async (q: string, e: object = env) => {
  const r = await onRequestGet({ request: new Request(`https://usemorph.app/api/unlock?session=${q}`), env: e as typeof env })
  return [r.status, ((await r.json()) as { ok: boolean }).ok] as const
}
assert.deepEqual(await call('cs_test_paid000000000'), [200, true]); assert.equal(auth, 'Bearer rk_test_x')
assert.deepEqual(await call('cs_test_unpaid0000000'), [403, false])
assert.deepEqual(await call('cs_test_other00000000'), [403, false])
assert.deepEqual(await call('cs_test_missing000000'), [404, false])
assert.deepEqual(await call('cs_test_boom000000000'), [424, false])
assert.deepEqual(await call('../../v1/customers'), [400, false])
assert.deepEqual(await call('cs_test_paid000000000', { STRIPE_SECRET_KEY: '' }), [424, false])
console.log('all 7 cases ok')
