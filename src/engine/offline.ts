/** Fail closed if the speech-only WASM process attempts a network operation. */
export function disableNetwork(): void {
  const denied = (): never => { throw new Error('Offline-Inferenz: Netzwerkzugriffe sind nicht erlaubt.') }
  globalThis.fetch = denied
  for (const name of ['node:http', 'node:https']) {
    const module = require(name)
    module.request = denied
    module.get = denied
  }
  const net = require('node:net')
  net.connect = denied
  net.createConnection = denied
  net.Socket.prototype.connect = denied
  require('node:dgram').createSocket = denied
  const dns = require('node:dns')
  dns.lookup = denied
  dns.resolve = denied
  dns.promises.lookup = denied
  dns.promises.resolve = denied
}
