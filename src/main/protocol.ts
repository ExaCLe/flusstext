// media://local/<pfad> – lokale Audiodateien mit Range-Unterstützung (zum Spulen) ausliefern.
import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'audio/webm',
  '.mkv': 'video/x-matroska',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac'
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'media', privileges: { stream: true, supportFetchAPI: true, bypassCSP: true, standard: true, secure: true } }])
}

export function handleMediaProtocol(): void {
  protocol.handle('media', (req) => {
    const url = new URL(req.url)
    const file = decodeURIComponent(url.pathname.slice(1))
    let size: number
    try {
      size = statSync(file).size
    } catch {
      return new Response('Nicht gefunden', { status: 404 })
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.get('range')
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m?.[1] ? Number(m[1]) : 0
      const end = m?.[2] ? Math.min(Number(m[2]), size - 1) : size - 1
      if (start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    const stream = Readable.toWeb(createReadStream(file)) as ReadableStream
    return new Response(stream, { headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  })
}
