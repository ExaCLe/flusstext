import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { useApp } from '../lib/store'

export function Toasts(): ReactNode {
  const toasts = useApp((s) => s.toasts)
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-2 rounded-full bg-[#0c0c0d] px-4 py-2 text-[13px] font-medium text-[#ecedee] shadow-[0_0_0_1px_#33353b,0_12px_32px_-8px_rgba(0,0,0,0.5)]"
          >
            {t.tone === 'success' && <CircleCheck className="size-4 text-[#5be49b]" />}
            {t.tone === 'error' && <CircleAlert className="size-4 text-[#f97066]" />}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
