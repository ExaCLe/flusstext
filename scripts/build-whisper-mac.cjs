// Pinned to the same whisper.cpp release used by the Windows runtime.
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } = require('node:fs')
const { availableParallelism } = require('node:os')
const { resolve, join } = require('node:path')

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('Build the Apple Silicon installer on an arm64 Mac.')
}
const revision = 'd1be6fde11ac6e0407606b4e42fe72d34add8037'
const checksum = '645445da884df6dbd52b30f82d7be7c01d1767c938714e477e786b88d529e9f4'
const source = resolve('build/whisper-source')
const output = resolve('build/whisper-mac')
mkdirSync(source, { recursive: true })
mkdirSync(output, { recursive: true })
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}
const archive = join(source, 'source.tar.gz')
run('curl', ['--fail', '--location', '--retry', '3', `https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/${revision}`, '-o', archive])
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== checksum) throw new Error('whisper.cpp source checksum mismatch')
run('tar', ['-xzf', archive, '--strip-components=1', '-C', source])
run('nice', ['-n', '10', 'cmake', '-S', source, '-B', join(source, 'build'),
  '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_ARCHITECTURES=arm64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
  '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_METAL=ON', '-DGGML_METAL_EMBED_LIBRARY=ON',
  '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_CURL=OFF'])
run('nice', ['-n', '10', 'cmake', '--build', join(source, 'build'), '--target', 'whisper-server',
  '--parallel', String(Math.max(1, Math.floor(availableParallelism() / 2)))])
copyFileSync(join(source, 'build/bin/whisper-server'), join(output, 'whisper-server'))
chmodSync(join(output, 'whisper-server'), 0o755)
copyFileSync(join(source, 'LICENSE'), join(output, 'LICENSE'))
writeFileSync(join(output, 'SOURCE.txt'), `whisper.cpp b5454\nhttps://github.com/ggml-org/whisper.cpp/tree/${revision}\nSource archive SHA-256: ${checksum}\nStatic CPU/Accelerate/Metal build, embedded Metal kernels, no Homebrew runtime dependencies.\n`)
