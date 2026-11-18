import { motion, type HTMLMotionProps } from 'motion/react'

type Props = HTMLMotionProps<'button'> & { variant?: 'primary' | 'secondary' }

const styles = {
  primary: 'bg-accent text-white shadow-glow',
  secondary: 'bg-surface-2 text-text-1 hover:bg-surface-3',
}

// One primary per screen (spec polish checklist). Press scales to 0.97.
export function Button({ variant = 'secondary', className = '', ...props }: Props) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className={`min-h-12 rounded-control px-5 py-3 font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${styles[variant]} ${className}`}
      {...props}
    />
  )
}
