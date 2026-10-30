// Spracherkennung auf dem Mac: die native Host-Engine dekodiert, erkennt und diarisiert.
// Die Telefon-Adapter (sherpa-onnx RN, whisper.rn, onnxruntime-react-native) werden hier nicht geladen.
import { removePath, type AppPaths } from './fs'
import { decodeQta } from './decode'
import { engineCall } from './engine-call'
import type { NativeHost } from './host'
import { parseHostTranscription, type AsrSpec, type CancelToken, type DiarizationSpec, type EngineSegment, type SpeechEngine, type SpeechResult, type TranscribeRequest } from './speech-types'
import type { Settings } from '../../../src/shared/types'

class HostSpeech implements SpeechEngine {
  readonly kind = 'host' as const

  constructor(private paths: AppPaths, private host: NativeHost) {}

  private async call(path: string, asr: AsrSpec, settings: Settings, diarization: DiarizationSpec | undefined, token: CancelToken): Promise<SpeechResult> {
    token.throwIfCancelled()
    const audio = await decodeQta(this.paths, this.host, path, token)
    try {
      const raw = await engineCall(this.host, 'transcribe', {
        path: audio.path,
        modelId: asr.modelId,
        modelDir: asr.modelDir,
        settings: { ...settings, language: asr.language, threads: asr.threads, useGpu: asr.useGpu },
        ...(diarization ? { diarization } : {})
      }, token)
      return parseHostTranscription(raw)
    } finally { if (audio.temp) await removePath(audio.path) }
  }

  async transcribe(req: TranscribeRequest): Promise<SpeechResult> {
    req.onProgress?.(req.diarization ? 'diarizing' : 'transcribing', 0)
    const res = await this.call(req.path, req.asr, req.settings, req.diarization, req.token)
    req.onProgress?.('transcribing', 1)
    return res
  }

  async preload(): Promise<void> {
    // Die Host-Engine lädt Modelle selbst beim ersten Aufruf.
  }

  async assignSpeakers(path: string, _segments: EngineSegment[], asr: AsrSpec, spec: DiarizationSpec, settings: Settings, token: CancelToken): Promise<EngineSegment[]> {
    return (await this.call(path, asr, settings, spec, token)).segments
  }

  async release(): Promise<void> {}
}

export function createSpeechEngine(paths: AppPaths, host: NativeHost): SpeechEngine {
  return new HostSpeech(paths, host)
}
