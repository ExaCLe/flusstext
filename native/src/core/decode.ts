import { engineCall } from './engine-call'
import { uuid } from './domain/text'
import { join, removePath, toPath, type AppPaths } from './fs'
import type { NativeHost } from './host'
import type { CancelToken } from './speech-types'

/** QTA's Apple codecs must be decoded before either recognition backend reads the audio. */
export async function decodeQta(paths: AppPaths, host: NativeHost, input: string, token: CancelToken): Promise<{ path: string; temp: boolean }> {
  const path = toPath(input)
  if (!/\.qta$/i.test(path)) return { path, temp: false }
  const outputPath = join(paths.tmp, `qta-${uuid()}.wav`)
  try {
    await engineCall(host, 'decodeAudio', { path, outputPath }, token, () => removePath(outputPath))
    return { path: outputPath, temp: true }
  } catch (e) {
    await removePath(outputPath)
    throw e
  }
}
