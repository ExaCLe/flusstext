const {resolve,join}=require('node:path')
const {mkdirSync,copyFileSync,cpSync,chmodSync,existsSync}=require('node:fs')
const {spawnSync}=require('node:child_process')
const {buildSync}=require('../../node_modules/esbuild')
const root=resolve(__dirname,'../..'), native=resolve(__dirname,'..'), output=join(native,'engine-resources')
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Mac runtime requires an Apple Silicon build host.')
mkdirSync(output,{recursive:true})
for(const [input,out] of [['src/engine/index.ts','engine.js'],['src/engine/nemotron-worker.ts','nemotron-worker.js'],['src/shared/catalog.ts','catalog.cjs']]) {
 buildSync({entryPoints:[join(root,input)],outfile:join(output,out),bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'warning'})
}
copyFileSync(join(native,'runtime/runner.cjs'),join(output,'runner.cjs'))
copyFileSync(process.execPath,join(output,'node'));chmodSync(join(output,'node'),0o755)
const names=['sherpa-onnx-node','sherpa-onnx-darwin-arm64','onnxruntime-web','ffmpeg-static','onnxruntime-common','protobufjs','long','flatbuffers','@protobufjs']
for(const name of names){const from=join(root,'node_modules',name);if(existsSync(from))cpSync(from,join(output,'node_modules',name),{recursive:true})}
const runtime=join(native,'build/whisper-mac/whisper-server')
if(!existsSync(runtime))throw Error('Run node scripts/build-whisper-mac.cjs from native/ first.')
copyFileSync(runtime,join(output,'whisper-server'));chmodSync(join(output,'whisper-server'),0o755)
copyFileSync(join(native,'build/whisper-mac/LICENSE'),join(output,'LICENSE-whisper.txt'))
console.log(output)
