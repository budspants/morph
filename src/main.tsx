import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App.tsx'

import { claimFromUrl } from './features/money/pro'

// Back from Stripe Checkout (?unlock=cs_…): check the purchase before the first render, so the page opens ad-free.
await claimFromUrl()

// Offline + installable. Not in dev: a cached page would hide code changes.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
