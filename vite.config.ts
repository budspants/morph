import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// LAN IPv4 addresses, so the phone-test certificate matches what the phone types in.
const lanIps = Object.values(networkInterfaces()).flat().filter((n) => n?.family === 'IPv4' && !n.internal).map((n) => n!.address)
const src = (p: string) => fileURLToPath(new URL(`./src/${p}`, import.meta.url))

export default defineConfig({
  // PHONE=true: HTTPS on your Wi-Fi so a real phone can test (iOS only allows the share sheet on secure pages).
  plugins: [react(), tailwindcss(), process.env.PHONE === 'true' && basicSsl({ name: 'morph-dev', domains: ['localhost', ...lanIps] })],
  resolve: {
    alias: {
      '@personal': src('app/personal-stub.ts'),
    },
  },
  // ffmpeg.wasm spawns its worker via new URL(import.meta.url); pre-bundling breaks that.
  // transformers.js is only imported by the Whisper worker; pre-bundle it at startup, or Vite
  // finds it mid-session and reloads the page in the middle of a caption run.
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'], include: ['@huggingface/transformers'] },
  worker: { format: 'es' }, // the Whisper worker code-splits
  // BIG_ASSET_BASE=https://…: the .wasm files (14–32 MB, over Cloudflare Pages' 25 MB file limit) load from
  // that host instead; scripts/split-big-assets.mjs moves them to dist-big/ for upload. Unset: served as usual.
  ...(process.env.BIG_ASSET_BASE && {
    experimental: {
      renderBuiltUrl: (file: string) => (file.endsWith('.wasm') ? `${process.env.BIG_ASSET_BASE!.replace(/\/$/, '')}/${file}` : { relative: false }),
    },
  }),
  server: {
    port: Number(process.env.PORT) || 5173,
    watch: { ignored: ['**/dist*/**', '**/test-results/**'] }, // build output shouldn't reload the page
  },
  build: { outDir: 'dist' },
})
