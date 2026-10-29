// Run inside Electron to exercise the real Chromium network stack, including PAC.
const { app, net, session } = require('electron')
const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, appendFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const ts = require('typescript')

const scratch = mkdtempSync(join(tmpdir(), 'flusstext-download-tests-'))
app.setPath('userData', scratch)
const report = resolve('out/tests/downloads.log')
mkdirSync(resolve('out/tests'), { recursive: true })
writeFileSync(report, '')
const log = (message) => {
  appendFileSync(report, `${message}\n`)
  console.log(message)
}
const compiled = ts.transpileModule(readFileSync(resolve('src/main/download.ts'), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
}).outputText
writeFileSync(join(scratch, 'download.cjs'), compiled)
const { fetchTo, downloadError } = require(join(scratch, 'download.cjs'))
const payload = Buffer.from('BZh9-model-data-for-download-test')
const slowPayload = Buffer.alloc(64 * 1024, 0x42)
let proxyRequests = 0
let port
const server = createServer((req, res) => {
  if (req.url === '/proxy.pac') {
    res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' })
    res.end(`function FindProxyForURL(url, host) { return host === 'model.invalid' ? 'PROXY 127.0.0.1:${port}' : 'DIRECT'; }`)
    return
  }
  if (req.url.startsWith('http://model.invalid/')) proxyRequests++
  const path = new URL(req.url, 'http://fixture.invalid').pathname
  if (path === '/auth-model' && req.headers['proxy-authorization'] !== `Basic ${Buffer.from('fixture:password').toString('base64')}`) {
    res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="download-fixture"' })
    res.end()
    return
  }
  if (path === '/redirect') {
    res.writeHead(302, { Location: '/model' })
    res.end()
  } else if (path === '/model' || path === '/auth-model') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': payload.length })
    res.end(payload)
  } else if (path === '/html') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html>Sign in to the company proxy</html>')
  } else if (path === '/hidden-html') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    res.write('<!doc')
    setTimeout(() => res.end('type html><html>Blocked</html>'), 10)
  } else if (path === '/stall-headers') {
    // Deliberately never send headers; the downloader must abort.
  } else if (path === '/stall-body') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    res.write(Buffer.alloc(4096, 0x42))
  } else if (path === '/slow') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    let offset = 0
    const timer = setInterval(() => {
      res.write(slowPayload.subarray(offset, offset + 4096))
      offset += 4096
      if (offset === slowPayload.length) { clearInterval(timer); res.end() }
    }, 50)
    res.on('close', () => clearInterval(timer))
  } else if (path === '/truncated') {
    res.writeHead(200, { 'Content-Length': payload.length + 100 })
    res.end(payload)
    setTimeout(() => res.destroy(), 20)
  } else if (path === '/empty') {
    res.end()
  } else {
    res.writeHead(path === '/proxy-auth' ? 407 : 403)
    res.end()
  }
})

app.whenReady().then(async () => {
  const watchdog = setTimeout(() => { log('FAIL download tests exceeded 20 seconds'); app.exit(1) }, 20_000)
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  port = server.address().port
  const base = `http://127.0.0.1:${port}`
  const target = join(scratch, 'model.bin')
  const check = async (name, test) => {
    rmSync(target, { force: true })
    await test()
    assert.equal(existsSync(`${target}.part`), false, 'partial download must be cleaned up')
    log(`PASS ${name}`)
  }
  const rejectDownload = async (path, pattern, timeout = 1000) => {
    await assert.rejects(fetchTo(`${base}${path}`, target, new AbortController().signal, () => {}, undefined, timeout), pattern)
    assert.equal(existsSync(target), false, 'failed download must not be installed')
  }
  let exitCode = 0
  try {
    await session.defaultSession.setProxy({ mode: 'direct' })
    await check('redirect, byte progress and content length', async () => {
      let bytes = 0
      let length = 0
      await fetchTo(`${base}/redirect`, target, new AbortController().signal, (n) => bytes += n, (n) => length = n)
      assert.deepEqual(readFileSync(target), payload)
      assert.equal(bytes, payload.length)
      assert.equal(length, payload.length)
    })
    await check('HTTP 200 proxy login page rejected', () => rejectDownload('/html', /Webseite/))
    await check('mislabeled HTML split across chunks rejected', () => rejectDownload('/hidden-html', /Webseite/))
    await check('HTTP failure rejected', () => rejectDownload('/blocked', /HTTP 403/))
    await check('proxy authentication error explained', () => rejectDownload('/proxy-auth', /Firmenproxy.*Anmeldung/))
    await check('empty file rejected', () => rejectDownload('/empty', /unvollständig/))
    await check('truncated body rejected', () => rejectDownload('/truncated', /./))
    await check('stalled connection times out', () => rejectDownload('/stall-headers', /Zeitüberschreitung/, 100))
    await check('stalled body times out', () => rejectDownload('/stall-body', /Zeitüberschreitung/, 100))
    await check('slow active download outlives inactivity timeout', async () => {
      await fetchTo(`${base}/slow`, target, new AbortController().signal, () => {}, undefined, 500)
      assert.deepEqual(readFileSync(target), slowPayload)
    })
    await check('cancellation removes partial file', async () => {
      const abort = new AbortController()
      await assert.rejects(fetchTo(`${base}/stall-body`, target, abort.signal, () => abort.abort()))
      assert.equal(existsSync(target), false)
    })
    await check('PAC routes an otherwise unresolvable model host through the proxy', async () => {
      await session.defaultSession.setProxy({ mode: 'pac_script', pacScript: `${base}/proxy.pac` })
      const resolved = await session.defaultSession.resolveProxy('http://model.invalid/model')
      assert.equal(resolved, `PROXY 127.0.0.1:${port}`)
      await fetchTo('http://model.invalid/model', target, new AbortController().signal, () => {})
      assert.deepEqual(readFileSync(target), payload)
      assert.equal(proxyRequests, 1)
    })
    await check('download reuses Chromium proxy authentication', async () => {
      // Seed Chromium's proxy auth cache using dummy credentials in a local fixture.
      await new Promise((done, fail) => {
        const request = net.request('http://model.invalid/auth-model')
        request.on('login', (info, callback) => { assert.equal(info.isProxy, true); callback('fixture', 'password') })
        request.on('error', fail)
        request.on('response', (response) => {
          response.on('error', fail)
          response.on('data', () => {})
          response.on('end', () => { try { assert.equal(response.statusCode, 200); done() } catch (error) { fail(error) } })
        })
        request.end()
      })
      await fetchTo('http://model.invalid/auth-model', target, new AbortController().signal, () => {})
      assert.deepEqual(readFileSync(target), payload)
    })
    await check('nested certificate and proxy failures retain useful guidance', async () => {
      assert.match(downloadError(new Error('fetch failed', { cause: new Error('net::ERR_CERT_AUTHORITY_INVALID') })), /Firmenzertifikat/)
      assert.match(downloadError(new Error('net::ERR_TUNNEL_CONNECTION_FAILED')), /Firmenproxy/)
    })
    log('All 14 download checks passed.')
  } catch (error) {
    log(error.stack || String(error))
    exitCode = 1
  } finally {
    clearTimeout(watchdog)
    server.closeAllConnections()
    server.close()
    rmSync(target, { force: true })
    rmSync(join(scratch, 'download.cjs'), { force: true })
    // Chromium keeps userData open until exit; the OS temp directory owns its lifecycle.
  }
  app.exit(exitCode)
}).catch((error) => { log(error.stack || String(error)); app.exit(1) })
