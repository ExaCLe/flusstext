import { pickDiarization } from '@shared/diarization'
import { useApp } from './store'

/** Sind ein Segmentierungs- und ein Stimmprofil-Modell installiert? */
export function useDiarizationReady(): boolean {
  return useApp((s) => {
    if (!s.settings) return false
    const installed = new Set(s.models.filter((m) => m.installed).map((m) => m.id))
    const { seg, emb } = pickDiarization((id) => installed.has(id), s.settings)
    return !!seg && !!emb
  })
}
