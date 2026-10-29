#!/usr/bin/env node
// Sign every nested executable before its containing bundle, then notarize the DMG.
// Credentials stay in Keychain; this script accepts only a notarytool profile name.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
function option(name) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const identity = option('--identity')
const profile = option('--notary-profile')
const local = args.includes('--local')
if (!local && (!identity || !identity.startsWith('Developer ID Application:') || !profile)) {
  throw new Error('Distribution requires --identity "Developer ID Application: …" --notary-profile <Keychain profile>. Use --local only for an explicitly unnotarized test build.')
}
const run = (bin, argv) => execFileSync(bin, argv, { stdio: 'inherit' })
const version = require('../package.json').version
const out = path.join(root, 'dist', local ? 'local-mac' : 'signed-mac')
fs.mkdirSync(out, { recursive: true })
const stage = fs.mkdtempSync(path.join(out, 'stage-'))
const app = path.join(stage, 'Flusstext.app')
const source = path.resolve(option('--app') || path.join(root, 'build/macos/Build/Products/Release/Flusstext.app'))
const entitlements = path.join(root, 'macos/FlusstextNative-macOS/FlusstextNative.entitlements')
run('/usr/bin/ditto', [source, app])
const bundles = [], executables = []
const magic = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'])
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      walk(file)
      if (/\.(framework|app|xpc|bundle)$/.test(entry.name)) bundles.push(file)
    } else if (entry.isFile() && fs.statSync(file).size >= 4) {
      const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(4)
      try { fs.readSync(fd, bytes, 0, 4, 0) } finally { fs.closeSync(fd) }
      if (magic.has(bytes.toString('hex'))) executables.push(file)
    }
  }
}
walk(app)
function sign(file, entitlementsFile) {
  run('/usr/bin/codesign', ['--force', '--sign', local ? '-' : identity, '--options', 'runtime',
    ...(local ? ['--timestamp=none'] : ['--timestamp']),
    ...(entitlementsFile ? ['--entitlements', entitlementsFile] : []), file])
}
for (const file of executables) sign(file, /\/engine\/node$/.test(file) ? entitlements : undefined)
for (const bundle of bundles) sign(bundle)
sign(app, entitlements)
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
if (!local) {
  const zip = path.join(out, 'Flusstext-notarization.zip')
  run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
  run('/usr/bin/xcrun', ['notarytool', 'submit', zip, '--keychain-profile', profile, '--wait'])
  run('/usr/bin/xcrun', ['stapler', 'staple', app])
  run('/usr/bin/xcrun', ['stapler', 'validate', app])
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app])
  fs.unlinkSync(zip)
}
fs.symlinkSync('/Applications', path.join(stage, 'Applications'))
const dmg = path.join(out, `Flusstext-ReactNative-${version}-mac-arm64${local ? '-UNNOTARIZED' : ''}.dmg`)
if (fs.existsSync(dmg)) throw new Error(`Refusing to overwrite ${dmg}`)
run('/usr/bin/hdiutil', ['create', '-volname', 'Flusstext', '-srcfolder', stage, '-ov', '-format', 'UDZO', dmg])
if (!local) {
  sign(dmg)
  run('/usr/bin/xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile, '--wait'])
  run('/usr/bin/xcrun', ['stapler', 'staple', dmg])
  run('/usr/bin/xcrun', ['stapler', 'validate', dmg])
  run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg])
}
fs.writeFileSync(dmg + '.sha256', `${crypto.createHash('sha256').update(fs.readFileSync(dmg)).digest('hex')}  ${path.basename(dmg)}\n`)
fs.rmSync(stage, { recursive: true })
console.log(dmg)
