import { AnimatePresence, motion } from 'motion/react'
import { FileAudio2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useApp } from '../lib/store'

const EXT = /\.(mp3|wav|m4a|aac|flac|ogg|opus|oga|wma|webm|mp4|m4v|mov|mkv|avi|wmv|mpeg|mpg|3gp|amr|aiff?|caf)$/i

export async function transcribePaths(paths: string[]): Promise<void> {
  const { settings, models, navigate, toast } = useApp.getState()
  const model = models.find((m) => m.id === settings?.transcriptionModel)
  if (!model?.installed) {
    toast('Bitte zuerst ein Transkriptionsmodell herunterladen', 'error')
    navigate({ name: 'models' })
    return
  }
  const files = paths.filter((p) => EXT.test(p))
  if (!files.length) {
    toast('Keine unterstützten Audio- oder Videodateien', 'error')
    return
  }
  await window.api.jobs.add(files, {})
  navigate({ name: 'library' })
  toast(files.length === 1 ? 'Transkription gestartet' : `${files.length} Dateien in der Warteschlange`, 'success')
}

/** Dateien irgendwo ins Fenster ziehen, um sie zu transkribieren. */
export function GlobalDrop(): ReactNode {
  const [over, setOver] = useState(false)
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setOver(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const overFn = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setOver(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      const paths = files.map((f) => window.api.system.pathForFile(f)).filter(Boolean)
      if (paths.length) void transcribePaths(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', overFn)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', overFn)
      window.removeEventListener('drop', drop)
    }
  }, [])

  return (
    <AnimatePresence>
      {over && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none fixed inset-0 z-[150] flex items-center justify-center bg-bg/70 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.96 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
            className="flex h-full w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-accent/60 bg-accent-soft"
          >
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-lg">
              <FileAudio2 className="size-6" />
            </div>
            <div className="text-[17px] font-semibold">Zum Transkribieren loslassen</div>
            <div className="mt-1 text-[13px] text-muted">Audio- und Videodateien · mehrere gleichzeitig möglich</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
