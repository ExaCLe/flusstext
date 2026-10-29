// Geräteabhängige Sicht auf den gemeinsamen Katalog: Empfehlung, Ressourcenhinweis und Fähigkeit sind getrennt.
import { CATALOG } from '../../../../src/shared/catalog'
import type { DownloadProgress, ModelDef, Settings } from '../../../../src/shared/types'
import type { NativeModel } from '../contracts'

export type Platform = 'ios' | 'android' | 'macos'

export interface DeviceInfo {
  memoryBytes: number
  cpuThreads: number
}

export const isPhone = (p: Platform): boolean => p !== 'macos'

/** Fürs Telefon empfohlene Spracherkennung: klein genug für Diktat und lange Aufnahmen. */
export const PHONE_SUGGESTIONS: Record<string, string> = {
  'nemo-fastconformer-de': 'Empfohlen fürs Telefon: Deutsch, 108 MB, sehr schnell und sparsam.',
  'whisper-base': 'Empfohlen fürs Telefon: mehrsprachig mit Spracherkennung, nur 60 MB.'
}

/** Windows-Programme (whisper.cpp-EXE) laufen auf keinem dieser Geräte und werden ausgeblendet. */
export function visibleOnDevice(def: ModelDef): boolean {
  return def.kind !== 'runtime'
}

export function catalogFor(): ModelDef[] {
  return CATALOG.filter(visibleOnDevice)
}

function gb(bytes: number): string {
  return `${(bytes / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`
}

/** Grobe Speicherschätzung während der Erkennung (Gewichte + Laufzeitpuffer). */
export function estimatedMemoryBytes(def: ModelDef): number {
  const weights = def.sizeMB * 1e6
  return def.engine === 'onnx' ? weights * 1.6 : weights * 1.3 + 150e6
}

export function resourceNote(def: ModelDef, platform: Platform, device: DeviceInfo): string | undefined {
  const mem = estimatedMemoryBytes(def)
  const tight = device.memoryBytes > 0 && mem > device.memoryBytes * 0.45
  const ramHint = tight ? ` Bei ${gb(device.memoryBytes)} Arbeitsspeicher kann das System die App dabei beenden.` : ''
  if (!isPhone(platform)) {
    return tight ? `Braucht etwa ${gb(mem)} Arbeitsspeicher.${ramHint}` : undefined
  }
  if (def.kind === 'asr') {
    if (def.engine === 'onnx') {
      return `Läuft auf dem Telefon nur über die CPU und braucht etwa ${gb(mem)} Arbeitsspeicher – sehr langsam, eher für kurze Dateien am Ladegerät.${ramHint}`
    }
    if (def.sizeMB >= 400) {
      return `Groß für ein Telefon: etwa ${gb(mem)} Arbeitsspeicher, deutlich langsamer und wärmer – am besten für Dateien am Ladegerät.${ramHint}`
    }
    if (def.sizeMB >= 150) return `Mittelgroß: auf neueren Telefonen gut nutzbar, auf älteren spürbar langsamer.${ramHint}`
    return undefined
  }
  if ((def.kind === 'segmentation' || def.kind === 'embedding') && def.sizeMB >= 70) {
    return 'Großes Sprechermodell: die Sprechererkennung dauert auf dem Telefon merklich länger.'
  }
  return undefined
}

export function toNativeModel(
  def: ModelDef,
  platform: Platform,
  device: DeviceInfo,
  installed: boolean,
  download?: DownloadProgress
): NativeModel {
  const phone = isPhone(platform)
  const recommendation = phone ? PHONE_SUGGESTIONS[def.id] : undefined
  const note = resourceNote(def, platform, device)
  return {
    ...def,
    // Desktop-Empfehlungen (große Modelle) gelten am Telefon nicht für die Spracherkennung
    recommended: phone && def.kind === 'asr' ? !!recommendation : def.recommended,
    installed,
    download,
    available: true,
    ...(recommendation ? { recommendation } : {}),
    ...(note ? { resourceNote: note } : {})
  }
}

/** Dateien, die nach der Installation vorhanden sein müssen. */
export function requiredFiles(def: ModelDef): string[] {
  if (!def.archive) return def.files.map((f) => f.name)
  if (def.kind === 'segmentation') return [def.mainFile ?? 'model.onnx']
  switch (def.sherpaType) {
    case 'nemo_transducer':
    case 'transducer':
      return ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt']
    case 'canary':
    case 'cohere':
      return ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']
    default:
      return []
  }
}

export function downloadTotal(def: ModelDef): number {
  return def.archive?.size ?? (def.files.reduce((n, f) => n + (f.size ?? 0), 0) || def.sizeMB * 1e6)
}

/** Speicherbedarf während der Installation: Archiv und entpackter Inhalt liegen kurz gleichzeitig vor. */
export function requiredDiskBytes(def: ModelDef): number {
  const total = downloadTotal(def)
  return Math.round((def.archive ? total * 2.1 : total * 1.05) + 50e6)
}

/** Einstellungen nach einer Installation: erstes passendes Modell automatisch wählen. */
export function selectionAfterInstall(def: ModelDef, s: Settings, isInstalled: (id: string) => boolean): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  if (def.kind === 'asr') {
    if (!s.transcriptionModel || !isInstalled(s.transcriptionModel)) patch.transcriptionModel = def.id
    if (s.dictationModel && !isInstalled(s.dictationModel)) patch.dictationModel = null
  }
  if (def.kind === 'embedding' && !isInstalled(s.diarization.embeddingModel)) patch.diarization = { embeddingModel: def.id }
  if (def.kind === 'segmentation' && !isInstalled(s.diarization.segmentationModel)) patch.diarization = { segmentationModel: def.id }
  return Object.keys(patch).length ? patch : null
}

/** Einstellungen nach dem Entfernen eines Modells bzw. beim Start auf installierte Modelle abgleichen. */
export function selectionRepair(s: Settings, isInstalled: (id: string) => boolean, platform: Platform): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}
  if (!s.transcriptionModel || !isInstalled(s.transcriptionModel)) {
    const asr = catalogFor().filter((m) => m.kind === 'asr' && isInstalled(m.id))
    const pick = (isPhone(platform) ? asr.find((m) => PHONE_SUGGESTIONS[m.id]) : asr.find((m) => m.recommended && m.engine === 'sherpa')) ?? asr[0]
    const next = pick?.id ?? null
    if (next !== s.transcriptionModel) patch.transcriptionModel = next
  }
  if (s.dictationModel && !isInstalled(s.dictationModel)) patch.dictationModel = null
  return Object.keys(patch).length ? patch : null
}
