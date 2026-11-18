import { expect, test, type Page } from '@playwright/test'

// Ads and the one-time "Remove ads" unlock (Stripe). The second dev server (playwright.config.ts) has test
// values for AdSense and the Payment Link; Google's script and /api/unlock (functions/api/unlock.ts) are mocked.
const MONEY = 'http://localhost:5181/'
const GOOD = 'cs_test_a1b2c3d4e5f6g7h8i9j0'

async function mock(page: Page) {
  await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }))
  await page.route('**/api/unlock?*', async (r) => {
    const ok = new URL(r.request().url()).searchParams.get('session') === GOOD
    await r.fulfill({ status: ok ? 200 : 404, contentType: 'application/json', body: JSON.stringify(ok ? { ok: true } : { ok: false, error: 'No purchase found for that code.' }) })
  })
}
const adOf = (page: Page) => page.getByRole('complementary', { name: 'Advertisement' })

test('normal build shows no ads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /drop anything/i })).toBeVisible()
  await expect(adOf(page)).toHaveCount(0)
})

test('ad shows; a purchase code from another device removes it for good', async ({ page }) => {
  await mock(page)
  await page.goto(MONEY)
  const ad = adOf(page)
  await expect(ad).toBeVisible()
  await expect(ad.locator('ins.adsbygoogle')).toHaveAttribute('data-ad-client', 'ca-pub-0000000000000000')

  await page.getByRole('button', { name: 'Remove ads – $10 once' }).click()
  await expect(page.getByRole('link', { name: 'Buy for $10' })).toHaveAttribute('href', 'https://example.test/checkout')
  const code = page.getByLabel('Purchase code')
  await code.fill('cs_test_nope0000000000')
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByRole('alert')).toHaveText('No purchase found for that code.')
  await expect(ad).toBeVisible()

  await code.fill(GOOD)
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(ad).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: /drop anything/i })).toBeVisible()
  await expect(ad).toHaveCount(0)
})

test('back from Stripe checkout: ads are gone and the code is shown once', async ({ page }) => {
  await mock(page)
  await page.goto(`${MONEY}?unlock=${GOOD}`)
  await expect(page.getByRole('status').filter({ hasText: 'Ads removed. Thank you!' })).toContainText(GOOD)
  await expect(adOf(page)).toHaveCount(0)
  expect(page.url()).toBe(MONEY) // the code is tidied out of the address bar
  await page.reload()
  await expect(page.getByRole('button', { name: /drop anything/i })).toBeVisible()
  await expect(page.getByText('Ads removed. Thank you!')).toHaveCount(0)
  await expect(adOf(page)).toHaveCount(0)
})

test('back from checkout with a bad code: the panel opens with the reason', async ({ page }) => {
  await mock(page)
  await page.goto(`${MONEY}?unlock=cs_test_bad00000000000`)
  await expect(page.getByRole('alert')).toHaveText('No purchase found for that code.')
  await expect(page.getByLabel('Purchase code')).toHaveValue('cs_test_bad00000000000')
  await expect(adOf(page)).toBeVisible()
})
