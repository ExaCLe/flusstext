import { net } from 'electron'
import { createWriteStream, renameSync, rmSync } from 'node:fs'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Use Chromium networking so Windows proxy/PAC settings and certificate trust apply. */
export async function fetchTo(
  url: string,
  target: string,
  signal: AbortSignal,
  onBytes: (n: number) => void,
  onLength?: (n: number) => void,
  idleTimeoutMs = 60_000
): Promise<void> {
  const controller = new AbortController()
  const requestSignal = AbortSignal.any([signal, controller.signal])
  const part = `${target}.part`
  let timer: NodeJS.Timeout | undefined
  let timedOut = false
  let response: Response | undefined
  const resetTimeout = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, idleTimeoutMs)
  }

  try {
    resetTimeout()
    response = await net.fetch(url, {
      signal: requestSignal,
      redirect: 'follow',
      // Allow Chromium's proxy authentication and Windows client certificates.
      credentials: 'include',
      cache: 'no-store',
      headers: { 'User-Agent': 'Flusstext/0.1' }
    })
    resetTimeout()
    if (!response.ok || !response.body) throw new Error(`Download fehlgeschlagen (HTTP ${response.status})`)
    // Corporate gateways sometimes return a login/block page with HTTP 200.
    if (/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') ?? '')) {
      throw new Error('Der Server oder Firmenproxy liefert eine Webseite statt der Modelldatei. Bitte den Download freigeben lassen.')
    }
    const length = Number(response.headers.get('content-length') ?? 0)
    if (length > 0) onLength?.(length)
    let received = 0
    let prefix = Buffer.alloc(0)
    const progress = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        resetTimeout()
        received += chunk.length
        if (prefix.length < 512) {
          prefix = Buffer.concat([prefix, chunk.subarray(0, 512 - prefix.length)])
          if (/^\s*(?:<!doctype\s+html|<html(?:\s|>)|<head(?:\s|>)|<body(?:\s|>))/i.test(prefix.toString('utf8'))) {
            callback(new Error('Der Server oder Firmenproxy liefert eine Webseite statt der Modelldatei. Bitte den Download freigeben lassen.'))
            return
          }
        }
        onBytes(chunk.length)
        callback(null, chunk)
      }
    })
    await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(part), { signal: requestSignal })
    requestSignal.throwIfAborted()
    // Content-Length describes the encoded body when compression is in use.
    if (!received || (length > 0 && !response.headers.get('content-encoding') && received !== length)) {
      throw new Error('Die Modelldatei ist unvollständig. Bitte erneut herunterladen.')
    }
    renameSync(part, target)
  } catch (error) {
    if (signal.aborted) throw error
    const message = timedOut
      ? 'Keine Daten empfangen (Zeitüberschreitung). Bitte VPN, Firmenproxy und Download-Freigabe prüfen.'
      : downloadError(error)
    throw new Error(`${new URL(url).hostname}: ${message}`, { cause: error })
  } finally {
    clearTimeout(timer)
    // Also stop responses rejected before the pipeline takes ownership.
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {})
    rmSync(part, { force: true })
  }
}

/** Include nested Node/Chromium errors rather than reducing everything to "fetch failed". */
export function downloadError(error: unknown): string {
  const messages: string[] = []
  let current = error
  for (let i = 0; current && i < 4; i++) {
    if (!(current instanceof Error)) {
      messages.push(String(current))
      break
    }
    messages.push(current.message, String((current as NodeJS.ErrnoException).code ?? ''))
    current = current.cause
  }
  const detail = messages.join(' ')
  if (/ENOSPC/i.test(detail)) return 'Nicht genug Speicherplatz'
  if (/CERT_|certificate|SELF_SIGNED|UNABLE_TO_VERIFY|ISSUER/i.test(detail)) {
    return 'Das TLS-Zertifikat wird nicht vertraut. Bitte das Firmenzertifikat durch die IT in Windows einrichten lassen.'
  }
  if (/HTTP 407|PROXY_AUTH|INVALID_AUTH_CREDENTIALS/i.test(detail)) {
    return 'Der Firmenproxy benötigt eine Anmeldung. Bitte die Proxy-Anmeldung bzw. Freigabe mit der IT prüfen.'
  }
  if (/PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES|MANDATORY_PROXY_CONFIGURATION_FAILED|PAC_SCRIPT_FAILED/i.test(detail)) {
    return 'Der Firmenproxy ist nicht erreichbar oder blockiert den Download. Bitte Windows-Proxy/PAC und Freigabe prüfen.'
  }
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|ERR_(?:NAME_NOT_RESOLVED|CONNECTION_|INTERNET_DISCONNECTED|NETWORK_|TIMED_OUT)/i.test(detail)) {
    return 'Keine Verbindung. Bitte VPN, Windows-Proxy und Download-Freigabe prüfen und erneut versuchen.'
  }
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 300 ? message.slice(0, 300) + '…' : message
}
