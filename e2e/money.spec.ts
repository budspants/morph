import { expect, test, type Page } from '@playwright/test'

// Ads and the one-time "Remove ads" unlock. The second dev server (playwright.config.ts) has test values
// for AdSense and Lemon Squeezy; Google's script and the licence API are mocked here.
const MONEY = 'http://localhost:5181/'

async function mock(page: Page, productId = 4242) {
  await page.route('https://pagead2.googlesyndication.com/**', (r) => r.fulfill({ contentType: 'text/javascript', body: '' }))
  await page.route('https://api.lemonsqueezy.com/v1/licenses/activate', async (r) => {
    const key = new URLSearchParams(r.request().postData() ?? '').get('license_key')
    const ok = key === 'GOOD-KEY'
    await r.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(ok ? { activated: true, instance: { id: 'i1' }, meta: { product_id: productId } } : { activated: false, error: 'license_key not found.' }),
    })
  })
}

test('normal build shows no ads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /drop anything/i })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Advertisement' })).toHaveCount(0)
})

test('ad shows; a licence key removes it for good', async ({ page }) => {
  await mock(page)
  await page.goto(MONEY)
  const ad = page.getByRole('complementary', { name: 'Advertisement' })
  await expect(ad).toBeVisible()
  await expect(ad.locator('ins.adsbygoogle')).toHaveAttribute('data-ad-client', 'ca-pub-0000000000000000')

  await page.getByRole('button', { name: 'Remove ads – $10 once' }).click()
  await expect(page.getByRole('link', { name: 'Buy for $10' })).toHaveAttribute('href', 'https://example.test/checkout')
  const key = page.getByLabel('Licence key')
  await key.fill('WRONG')
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByRole('alert')).toHaveText('license_key not found.')
  await expect(ad).toBeVisible()

  await key.fill('GOOD-KEY')
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(ad).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: /drop anything/i })).toBeVisible()
  await expect(ad).toHaveCount(0)
})

test('a key for another product is refused', async ({ page }) => {
  await mock(page, 9999)
  await page.goto(MONEY)
  await page.getByRole('button', { name: 'Remove ads – $10 once' }).click()
  await page.getByLabel('Licence key').fill('GOOD-KEY')
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.getByRole('alert')).toHaveText('That key is for a different product.')
  await expect(page.getByRole('complementary', { name: 'Advertisement' })).toBeVisible()
})
