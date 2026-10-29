// Local-only Node speech sidecar. The React Native app owns UI, files and privacy grants.
const { parentPort, Worker } = require('node:worker_threads')
const { createServer } = require('node:net')
const { spawn, spawnSync } = require('node:child_process')
const { existsSync, readdirSync, statSync, renameSync, rmSync } = require('node:fs')
const { join, dirname } = require('node:path')

// Worker bootstrap adapts the shared speech engine's Electron message-port shape to Node.
if (parentPort) {
  process.parentPort = { postMessage: (value) => parentPort.postMessage(value), on: (_event, callback) => parentPort.on('message', (data) => callback({ data })) }
  require('./engine.js')
} else {
  let worker, whisper
  let nextId = 0
  const pending = new Map()
  const server = () => new Promise((resolve, reject) => {
    const tcp = createServer(); tcp.on('error', reject)
    tcp.listen(0, '127.0.0.1', () => { const port = tcp.address().port; tcp.close(() => resolve(port)) })
  })
  function call(method, params) {
    if (!worker) {
      worker = new Worker(__filename)
      worker.on('message', (msg) => {
        if (msg.event) return
        const task = pending.get(msg.id); if (!task) return
        pending.delete(msg.id); msg.error ? task.reject(new Error(msg.error)) : task.resolve(msg.result)
      })
      worker.on('error', (error) => { for (const p of pending.values()) p.reject(error); pending.clear() })
      worker.on('exit', (code) => { if (code) for (const p of pending.values()) p.reject(new Error(`Engine exited with ${code}`)); pending.clear() })
    }
    const id = ++nextId
    return new Promise((resolve, reject) => { pending.set(id, {resolve, reject}); worker.postMessage({id,method,params}) })
  }
  async function backend(p) {
    const { CATALOG } = require('./catalog.cjs')
    const def = CATALOG.find((d) => d.id === p.modelId)
    if (!def || def.kind !== 'asr') throw Error('Unbekanntes Transkriptionsmodell.')
    const settings = p.settings || {}
    const threads = Math.max(1, Math.min(8, Math.floor(require('node:os').availableParallelism()/2), settings.threads || 4))
    const lang = settings.language === 'auto' ? 'de' : settings.language || 'de'
    const path = (f) => join(p.modelDir, f)
    if (def.engine === 'onnx') return {type:'nemotron-lite',modelDir:p.modelDir,threads,family:def.family}
    if (def.engine === 'whispercpp') {
      const port = await server()
      const args = ['-m',path('model.bin'),'--host','127.0.0.1','--port',String(port),'-t',String(threads),'-l',lang]
      if (!settings.useGpu) args.push('-ng')
      whisper = spawn(join(__dirname,'whisper-server'),args,{stdio:['ignore','ignore','pipe'],cwd:require('node:os').tmpdir()})
      let logs='';let error
      whisper.stderr.on('data',(d)=>{logs=(logs+d).slice(-4000)})
      whisper.on('error',(e)=>{error=e})
      const start=Date.now()
      while (true) {
        if (error) throw error
        if (whisper.exitCode!==null) throw Error(`Whisper: ${logs}`)
        try {const res=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(1000)});if(res.ok)break}catch{}
        if(Date.now()-start>120000)throw Error('Whisper-Start dauert zu lange.')
        await new Promise(r=>setTimeout(r,100))
      }
      return {type:'whisper-server',url:`http://127.0.0.1:${port}`,language:settings.language||'de',family:'whisper'}
    }
    const modelConfig={tokens:path('tokens.txt'),numThreads:threads,provider:'cpu',debug:0}
    if (def.sherpaType==='nemo_transducer') {
      modelConfig.transducer={encoder:path('encoder.int8.onnx'),decoder:path('decoder.int8.onnx'),joiner:path('joiner.int8.onnx')};modelConfig.modelType='nemo_transducer'
    } else if(def.sherpaType==='canary') {
      const l=['de','en','fr','es'].includes(lang)?lang:'de'
      modelConfig.canary={encoder:path('encoder.int8.onnx'),decoder:path('decoder.int8.onnx'),srcLang:l,tgtLang:l,usePnc:1}
    } else if(def.sherpaType==='cohere') modelConfig.cohereTranscribe={encoder:path('encoder.int8.onnx'),decoder:path('decoder.int8.onnx'),language:lang,usePunct:1,useItn:1}
    else throw Error('Nicht unterstütztes Modell.')
    return {type:'sherpa',family:def.family,key:`${def.id}:${threads}:${lang}`,config:{featConfig:{sampleRate:16000,featureDim:80},modelConfig}}
  }
  async function main() {
    const [method, input] = process.argv.slice(2)
    const text = input === '--stdin' ? await new Promise((resolve,reject)=>{let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>resolve(data));process.stdin.on('error',reject)}) : input
    const p = JSON.parse(text || '{}')
    if (method==='extract') {
      const result=spawnSync('/usr/bin/tar',['-xf',p.archive,'-C',p.dir],{encoding:'utf8'})
      if (result.error || result.status!==0)throw Error(result.error?.message||result.stderr)
      if (p.stripRoot) {
        const entries=readdirSync(p.dir)
        if(entries.length===1 && statSync(join(p.dir,entries[0])).isDirectory()) {
          const inner=join(p.dir,entries[0]);for(const entry of readdirSync(inner))renameSync(join(inner,entry),join(p.dir,entry));rmSync(inner,{recursive:true})
        }
      }
      rmSync(join(p.dir,'test_wavs'),{recursive:true,force:true})
      return true
    }
    if (method!=='transcribe')throw Error('Unbekannter Engine-Aufruf.')
    if (!existsSync(p.path))throw Error('Audiodatei nicht gefunden.')
    const asr=await backend(p)
    const ffmpeg=require('ffmpeg-static')
    const models=dirname(p.modelDir)
    return call('transcribeFile',{jobId:p.requestId||'native',path:p.path,ffmpeg,asr,vadModel:join(models,'vad-silero','silero_vad.onnx'),threads:p.settings?.threads||4,diarization:p.diarization})
  }
  let closing=false
  async function cleanup() {
    if(closing)return;closing=true
    if(worker) {await call('unload',{}).catch(()=>{});await worker.terminate().catch(()=>{})}
    whisper?.kill('SIGTERM')
  }
  process.on('SIGTERM',()=>{whisper?.kill('SIGTERM');worker?.terminate().finally(()=>process.exit(130));if(!worker)process.exit(130)})
  process.on('SIGINT',()=>process.emit('SIGTERM'))
  // Shared engine diagnostics go to stderr; stdout contains exactly one RPC result.
  console.log=(...args)=>console.error(...args)
  main().then(async(result)=>{await cleanup();process.stdout.write(JSON.stringify(result)+'\n')},async(error)=>{console.error(error.stack||String(error));await cleanup();process.exitCode=1})
}
