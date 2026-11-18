import { motion, type MotionProps } from 'motion/react'
import { useId } from 'react'

// Morphy, the mascot (brand: Aurora Merge, design/brand/final). Decorative only.
export type Mood = 'idle' | 'catch' | 'happy' | 'oops'

const ROUND = 'M50 16 C74 16 89 33 88 55 C87 77 71 88 50 88 C29 88 13 77 12 55 C11 33 26 16 50 16Z'
const BODY: Record<Mood, string> = {
  idle: ROUND,
  happy: ROUND,
  catch: 'M50 22 C78 18 93 36 91 58 C89 79 72 88 50 88 C28 88 11 79 9 58 C7 36 22 18 50 22Z',
  oops: 'M50 24 C74 24 90 40 89 60 C88 80 72 88 50 88 C28 88 12 80 11 60 C10 40 26 24 50 24Z',
}

const line = { fill: 'none', stroke: '#fff', strokeLinecap: 'round' } as const

function Face({ mood }: { mood: Mood }) {
  if (mood === 'happy')
    return (
      <>
        <path d="M32 52 Q38 44 44 52 M56 52 Q62 44 68 52" {...line} strokeWidth={4} />
        <path d="M42 66 Q50 74 58 66" {...line} strokeWidth={3.5} />
      </>
    )
  if (mood === 'catch')
    return (
      <>
        <circle cx="38" cy="50" r="7" fill="#fff" />
        <circle cx="62" cy="50" r="7" fill="#fff" />
        <ellipse cx="50" cy="68" rx="5" ry="6" fill="#fff" />
      </>
    )
  if (mood === 'oops')
    return (
      <>
        <path d="M33 50 H43 M57 50 H67" {...line} strokeWidth={4} />
        <path d="M41 69 Q45.5 64 50 69 Q54.5 74 59 69" {...line} strokeWidth={3.5} />
      </>
    )
  return (
    <>
      <ellipse cx="38" cy="50" rx="4.5" ry="6.5" fill="#fff" />
      <ellipse cx="62" cy="50" rx="4.5" ry="6.5" fill="#fff" />
    </>
  )
}

// Idle breathes, catch leans in, happy hops, oops wobbles. MotionConfig reducedMotion="user" stills them.
const MOTION: Record<Mood, MotionProps> = {
  idle: { animate: { scaleY: [1, 0.97, 1], scaleX: [1, 1.03, 1] }, transition: { duration: 3.2, repeat: Infinity, ease: 'easeInOut' } },
  catch: { animate: { scale: 1.08, y: -4 }, transition: { type: 'spring', stiffness: 400, damping: 15 } },
  happy: { animate: { y: [0, -8, 0] }, transition: { duration: 0.6, repeat: 2, ease: 'easeOut' } },
  oops: { animate: { rotate: [0, -5, 4, 0] }, transition: { duration: 0.7, ease: 'easeInOut' } },
}

export function Morphy({ mood = 'idle', size = 96 }: { mood?: Mood; size?: number }) {
  const g = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden className="overflow-visible">
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="var(--color-accent-2)" />
        </linearGradient>
      </defs>
      <motion.g key={mood} style={{ originX: '50%', originY: '90%' }} {...MOTION[mood]}>
        <path d={BODY[mood]} fill={`url(#${g})`} />
        <ellipse cx="40" cy={mood === 'oops' ? 36 : 29} rx="18" ry="6.5" fill="#fff" opacity={0.28} />
        <Face mood={mood} />
      </motion.g>
      {mood === 'happy' && (
        <path d="M86 10 L88 16 L94 18 L88 20 L86 26 L84 20 L78 18 L84 16Z" fill="var(--color-accent-2)" />
      )}
    </svg>
  )
}
