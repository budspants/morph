import type { ComponentType } from 'react'

// What a personal-only module can add to the app (see vite.config.ts).
// HomeTop renders above the drop zone on Home; null in the public build.
export type PersonalSlots = { HomeTop: ComponentType | null }
