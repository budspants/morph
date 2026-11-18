import { defineConfig, devices } from '@playwright/test'

const PORT = 5180
export const MONEY_PORT = 5181

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  // ffmpeg.wasm and Whisper are CPU-heavy; more parallel workers make the timing-based tests flaky.
  workers: 4,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'safari', use: { ...devices['Desktop Safari'] } },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      env: { PORT: String(PORT) },
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
    },
    {
      // Same app with ads and "Remove ads" switched on (test values), for e2e/money.spec.ts.
      command: 'npm run dev',
      env: {
        PORT: String(MONEY_PORT),
        VITE_ADSENSE_CLIENT: 'ca-pub-0000000000000000',
        VITE_ADSENSE_SLOT: '1234567890',
        VITE_PRO_CHECKOUT_URL: 'https://example.test/checkout',
        VITE_PRO_PRODUCT_ID: '4242',
      },
      url: `http://localhost:${MONEY_PORT}`,
      reuseExistingServer: false,
    },
  ],
})
