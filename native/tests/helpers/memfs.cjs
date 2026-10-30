// Speicherinternes Test-Double für @dr.pogodin/react-native-fs (nur die von der App genutzten Funktionen).
const crypto = require('node:crypto')

function createMemFs() {
  /** Pfad → Uint8Array (Datei) oder 'dir' */
  const nodes = new Map([['/', 'dir']])
  const remote = new Map() // URL → { body: Uint8Array, status, headers }
  const stopped = new Set()
  let nextJob = 1
  const parent = (p) => p.replace(/\/[^/]+$/, '') || '/'
  const bytes = (data, encoding) => {
    if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    return new Uint8Array(Buffer.from(String(data), encoding === 'base64' ? 'base64' : 'utf8'))
  }
  const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' })
  const file = (p) => {
    const n = nodes.get(p)
    if (!(n instanceof Uint8Array)) throw enoent(p)
    return n
  }
  const children = (p) => [...nodes.keys()].filter((k) => k !== p && parent(k) === p)
  const mkdirp = (p) => {
    if (nodes.get(p) === 'dir') return
    if (p !== '/') mkdirp(parent(p))
    nodes.set(p, 'dir')
  }
  const write = (p, data) => {
    if (nodes.get(parent(p)) !== 'dir') throw enoent(p)
    nodes.set(p, data)
  }
  const entry = (p) => {
    const n = nodes.get(p)
    return { name: p.split('/').pop(), path: p, size: n instanceof Uint8Array ? n.length : 0, isFile: () => n instanceof Uint8Array, isDirectory: () => n === 'dir' }
  }

  const api = {
    nodes,
    remote,
    async exists(p) {
      return nodes.has(p)
    },
    async mkdir(p) {
      mkdirp(p)
    },
    async readDir(p) {
      if (nodes.get(p) !== 'dir') throw enoent(p)
      return children(p).map(entry)
    },
    async readdir(p) {
      return (await api.readDir(p)).map((e) => e.name)
    },
    async unlink(p) {
      if (!nodes.has(p)) throw enoent(p)
      for (const k of [...nodes.keys()]) if (k === p || k.startsWith(p + '/')) nodes.delete(k)
    },
    async writeFile(p, data, encoding) {
      write(p, bytes(data, typeof encoding === 'string' ? encoding : encoding?.encoding))
    },
    async appendFile(p, data, encoding) {
      const prev = nodes.get(p) instanceof Uint8Array ? nodes.get(p) : new Uint8Array(0)
      const next = bytes(data, typeof encoding === 'string' ? encoding : encoding?.encoding)
      const out = new Uint8Array(prev.length + next.length)
      out.set(prev)
      out.set(next, prev.length)
      write(p, out)
    },
    async readFile(p, encoding) {
      const b = file(p)
      if (encoding === 'ArrayBuffer') return new Uint8Array(b).buffer
      return Buffer.from(b).toString(encoding === 'base64' ? 'base64' : 'utf8')
    },
    async read(p, length, position, encoding) {
      // Kopie mit exakter Länge (Buffer-Ausschnitte teilen sonst den ganzen Speicher)
      const b = new Uint8Array(file(p).subarray(position, position + length))
      if (encoding === 'ArrayBuffer') return b.buffer
      return Buffer.from(b).toString(encoding === 'base64' ? 'base64' : 'utf8')
    },
    async moveFile(from, to) {
      if (!nodes.has(from)) throw enoent(from)
      if (nodes.has(to)) throw Object.assign(new Error(`EEXIST: '${to}'`), { code: 'EEXIST' })
      if (nodes.get(parent(to)) !== 'dir') throw enoent(to)
      for (const k of [...nodes.keys()].sort()) {
        if (k === from || k.startsWith(from + '/')) {
          nodes.set(to + k.slice(from.length), nodes.get(k))
          nodes.delete(k)
        }
      }
    },
    async copyFile(from, to) {
      write(to, new Uint8Array(file(from)))
    },
    async stat(p) {
      const n = nodes.get(p)
      if (!n) throw enoent(p)
      return { size: n instanceof Uint8Array ? n.length : 0, isFile: () => n instanceof Uint8Array, isDirectory: () => n === 'dir' }
    },
    async hash(p, algorithm) {
      return crypto.createHash(algorithm).update(file(p)).digest('hex')
    },
    async getFSInfo() {
      return { freeSpace: 1e12, freeSpaceEx: 1e12, totalSpace: 2e12, totalSpaceEx: 2e12 }
    },
    stopDownload(jobId) {
      stopped.add(jobId)
    },
    downloadFile(opts) {
      const jobId = nextJob++
      const promise = (async () => {
        await new Promise((r) => setImmediate(r))
        const res = remote.get(opts.fromUrl)
        if (!res) throw new Error('UnknownHostException: Unable to resolve host')
        const headers = { 'Content-Type': 'application/octet-stream', ...(res.headers ?? {}) }
        opts.begin?.({ jobId, statusCode: res.status ?? 200, contentLength: res.contentLength ?? res.body.length, headers })
        if (stopped.has(jobId)) throw new Error('Download has been aborted')
        const out = []
        const step = Math.max(1, Math.ceil(res.body.length / 4))
        for (let at = 0; at < res.body.length; at += step) {
          if (res.hold) await res.hold
          await new Promise((r) => setImmediate(r))
          if (stopped.has(jobId)) throw new Error('Download has been aborted')
          out.push(res.body.slice(at, at + step))
          opts.progress?.({ jobId, contentLength: res.body.length, bytesWritten: Math.min(res.body.length, at + step) })
        }
        write(opts.toFile, new Uint8Array(Buffer.concat(out)))
        return { jobId, statusCode: res.status ?? 200, bytesWritten: res.body.length }
      })()
      return { jobId, promise }
    }
  }
  return api
}

module.exports = { createMemFs }
