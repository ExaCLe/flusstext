#!/usr/bin/env node
// Uses Xcode's signed-in account, or an explicitly supplied App Store Connect team API key.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const args = process.argv.slice(2)
function option(name) { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const team = option('--team')
if (!team || !/^[A-Z0-9]{10}$/.test(team)) throw new Error('Pass --team <10-character Apple Developer Team ID>.')
const root = path.resolve(__dirname, '..')
const out = path.join(root, 'dist/iphone')
fs.mkdirSync(out, { recursive: true })
const archive = path.join(out, 'Flusstext.xcarchive')
const uploadOnly = args.includes('--upload-only')
if (!uploadOnly && fs.existsSync(archive)) throw new Error(`Archive already exists: ${archive}. Move it aside or use --upload-only.`)
if (uploadOnly && !fs.existsSync(archive)) throw new Error('No prepared archive exists.')
const auth = []
const key = option('--api-key-path'), keyId = option('--api-key-id'), issuer = option('--api-issuer')
if (key || keyId || issuer) {
  if (!key || !keyId || !issuer) throw new Error('API authentication requires key path, key ID and issuer ID together.')
  auth.push('-authenticationKeyPath', path.resolve(key), '-authenticationKeyID', keyId, '-authenticationKeyIssuerID', issuer)
}
const run = argv => execFileSync('/usr/bin/nice', ['-n', '10', '/usr/bin/xcodebuild', ...argv], { cwd: root, stdio: 'inherit' })
const maxJobs = Math.max(1, Math.floor(os.availableParallelism() / 2))
const jobs = Math.min(maxJobs, Math.max(1, Number(option('--jobs')) || maxJobs))
if (!uploadOnly) run(['-workspace', 'ios/FlusstextNative.xcworkspace', '-scheme', 'FlusstextNative', '-configuration', 'Release',
  '-destination', 'generic/platform=iOS', '-archivePath', archive, '-jobs', String(jobs),
  '-derivedDataPath', 'build/iphone-device',
  `DEVELOPMENT_TEAM=${team}`, 'CODE_SIGN_STYLE=Automatic', '-allowProvisioningUpdates', ...auth, 'archive'])
if (args.includes('--archive-only')) process.exit(0)
const options = path.join(out, 'ExportOptions.plist')
fs.writeFileSync(options, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string><key>destination</key><string>upload</string>
<key>teamID</key><string>${team}</string><key>signingStyle</key><string>automatic</string>
<key>manageAppVersionAndBuildNumber</key><true/><key>uploadSymbols</key><true/>
</dict></plist>`)
run(['-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options, '-exportPath', out, '-allowProvisioningUpdates', ...auth])
console.log('Upload completed. App Store Connect processing and TestFlight tester availability must still be verified.')
