// Lädt TypeScript-Module der App unter Node (node --test) und ersetzt native Pakete durch Test-Doubles.
const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const mocks = new Map()

/** Modul-ID (z. B. '@dr.pogodin/react-native-fs') für folgende require-Aufrufe ersetzen. */
function mock(id, value) {
  mocks.set(id, value)
}

const resolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (mocks.has(request)) return `mock:${request}`
  if ((request.startsWith('.') || path.isAbsolute(request)) && parent?.filename) {
    const base = path.resolve(path.dirname(parent.filename), request)
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return resolve.call(this, request, parent, ...rest)
}

const load = Module._load
Module._load = function (request, parent, ...rest) {
  if (mocks.has(request)) return mocks.get(request)
  return load.call(this, request, parent, ...rest)
}

Module._extensions['.ts'] = function (module, filename) {
  const source = fs.readFileSync(filename, 'utf8')
  const out = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, sourceMap: false }
  })
  module._compile(out.outputText, filename)
}

const core = (p) => path.join(__dirname, '..', '..', 'src', 'core', p)

module.exports = { mock, core }
