// Katalogmodell + Einstellungen → konkrete Erkennungs- und Diarisierungs-Konfiguration.
import { diarizationThreshold, pickDiarization } from '../../../src/shared/diarization'
import type { Settings } from '../../../src/shared/types'
import type { ModelManager } from './models'
import type { AsrSpec, DiarizationSpec } from './speech-types'

export function resolveAsr(models: ModelManager, s: Settings, modelId: string | null | undefined, language?: string): AsrSpec {
  if (!modelId) throw new Error('Kein Transkriptionsmodell ausgewählt.')
  const def = models.def(modelId)
  if (!def || def.kind !== 'asr') throw new Error('Unbekanntes Modell')
  if (!models.isInstalled(modelId)) throw new Error(`${def.name} ist nicht installiert.`)
  return { modelId, def, modelDir: models.dir(modelId), language: language ?? s.language, threads: s.threads, useGpu: s.useGpu }
}

export function diarizationSpec(models: ModelManager, s: Settings, numSpeakers?: number): DiarizationSpec | undefined {
  const { seg, emb } = pickDiarization(models.isInstalled, s)
  if (!seg || !emb) return undefined
  return {
    segmentation: models.file(seg.id, seg.mainFile ?? 'model.onnx'),
    embedding: models.file(emb.id, emb.mainFile ?? 'model.onnx'),
    numSpeakers: Math.max(0, Math.round(numSpeakers ?? s.diarization.numSpeakers)),
    threshold: diarizationThreshold(emb, s)
  }
}
