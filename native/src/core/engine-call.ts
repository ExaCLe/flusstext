import { uuid } from './domain/text'
import type { NativeHost } from './host'
import { CancelledError, type CancelToken } from './speech-types'

/** Release the caller immediately on cancellation, even when native computation cannot be interrupted. */
export async function engineCall(host: NativeHost, method: string, params: Record<string, unknown>, token: CancelToken, onAbandonedResult?: () => Promise<void>): Promise<unknown> {
  token.throwIfCancelled()
  const requestId = uuid()
  let abort: (error: Error) => void = () => undefined
  const cancelled = new Promise<never>((_, reject) => { abort = reject })
  const pending = host.engineCall(method, { ...params, requestId })
  if (onAbandonedResult) void pending.then(() => { if (token.cancelled) return onAbandonedResult() }).catch(() => undefined)
  const off = token.onCancel(() => {
    abort(new CancelledError())
    void host.engineCall('cancel', { requestId }).catch(() => undefined)
  })
  try {
    const result = await Promise.race([pending, cancelled])
    token.throwIfCancelled()
    return result
  } finally { off() }
}
