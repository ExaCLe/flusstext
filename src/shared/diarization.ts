import { CATALOG } from './catalog'
import type { ModelDef, Settings } from './types'

/**
 * Gewählte Diarisierungsmodelle auflösen. Ist das gewählte Modell nicht installiert,
 * wird das erste installierte Modell derselben Art verwendet.
 */
export function pickDiarization(isInstalled: (id: string) => boolean, s: Settings): { seg?: ModelDef; emb?: ModelDef } {
  const pick = (kind: 'segmentation' | 'embedding', wanted: string): ModelDef | undefined => {
    const list = CATALOG.filter((m) => m.kind === kind && isInstalled(m.id))
    return list.find((m) => m.id === wanted) ?? list[0]
  }
  return { seg: pick('segmentation', s.diarization.segmentationModel), emb: pick('embedding', s.diarization.embeddingModel) }
}

export function diarizationThreshold(emb: ModelDef | undefined, s: Settings): number {
  return Math.min(0.98, Math.max(0.1, (emb?.threshold ?? 0.6) + s.diarization.thresholdOffset))
}
