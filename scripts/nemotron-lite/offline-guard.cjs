// Test-only guard: fail if inference tries any JavaScript HTTP, DNS or socket API.
const deny = () => { throw new Error('Inference attempted network access') }
globalThis.fetch = deny
for (const name of ['node:http', 'node:https']) {
  const module = require(name)
  module.request = deny
  module.get = deny
}
const net = require('node:net')
net.connect = deny
net.createConnection = deny
net.Socket.prototype.connect = deny
require('node:dgram').createSocket = deny
const dns = require('node:dns')
dns.lookup = deny
dns.resolve = deny
process.env.ORT_DISABLE_TELEMETRY = '1'
if (process.env.NEMOTRON_TEST_PACKAGED_ROOT) {
  const Module = require('node:module')
  const original = Module._resolveFilename
  const root = process.env.NEMOTRON_TEST_PACKAGED_ROOT
  Module._resolveFilename = function (request, parent, ...args) {
    const resolved = original.call(this, request, parent, ...args)
    if (parent?.filename.startsWith(root) && !Module.isBuiltin(request)) {
      if (!resolved.startsWith(root)) throw new Error('Packaged dependency resolved outside the application: '+request)
    }
    return resolved
  }
}
