const test = require('node:test')
const assert = require('node:assert/strict')
const {mock,core} = require('./helpers/load.cjs')
const {createMemFs} = require('./helpers/memfs.cjs')
const fs = createMemFs()
mock('@dr.pogodin/react-native-fs',fs)
const {decodeQta} = require(core('decode'))
const {CancelToken} = require(core('speech-types'))
const {createSpeechEngine} = require(core('speech.macos'))
const wav = require(core('domain/wav'))
const paths={tmp:'/tmp'}
test.before(async()=>{await fs.mkdir('/tmp')})

test('QTA-Routing ist unabhängig von Großschreibung und erhält die Quelldatei',async()=>{
  await fs.writeFile('/source.QTA','original')
  const calls=[]
  const host={async engineCall(method,p){calls.push({method,p});await fs.writeFile(p.outputPath,wav.concatBuffers(wav.wavHeader(32000),new ArrayBuffer(32000)));return{path:p.outputPath}}}
  const result=await decodeQta(paths,host,'file:///source.QTA',new CancelToken())
  assert.equal(calls[0].method,'decodeAudio')
  assert.equal(calls[0].p.path,'/source.QTA')
  assert.ok(result.temp)
  assert.ok(result.path.endsWith('.wav'))
  assert.equal(await fs.readFile('/source.QTA'),'original')
  const untouched=await decodeQta(paths,{engineCall(){throw new Error('unexpected')}},'/source.wav',new CancelToken())
  assert.deepEqual(untouched,{path:'/source.wav',temp:false})
})

test('QTA-Dekodierfehler entfernt nur die temporäre Ausgabe',async()=>{
  await fs.writeFile('/bad.qta','source')
  let output
  const host={async engineCall(_m,p){output=p.outputPath;await fs.writeFile(output,'partial');throw new Error('Codec nicht unterstützt')}}
  await assert.rejects(decodeQta(paths,host,'/bad.qta',new CancelToken()),/Codec/)
  assert.ok(!await fs.exists(output))
  assert.equal(await fs.readFile('/bad.qta'),'source')
})

test('Mac erkennt die dekodierte WAV und entfernt sie nach der Erkennung',async()=>{
  const calls=[]
  let output
  const host={async engineCall(method,p){
    calls.push({method,p})
    if(method==='decodeAudio'){output=p.outputPath;await fs.writeFile(output,'wav');return{path:output}}
    assert.equal(p.path,output)
    return{segments:[{start:0,end:1,text:'hello'}],duration:1,peaks:[]}
  }}
  const engine=createSpeechEngine(paths,host)
  const result=await engine.transcribe({path:'/source.qta',asr:{modelId:'whisper-base',modelDir:'/model',language:'en',threads:2,useGpu:false},settings:{},token:new CancelToken()})
  assert.deepEqual(calls.map(c=>c.method),['decodeAudio','transcribe'])
  assert.equal(result.segments[0].text,'hello')
  assert.ok(!await fs.exists(output))
})

test('Eine nach JS-Abbruch bereits festgeschriebene native WAV wird ebenfalls entfernt',async()=>{
  const token=new CancelToken()
  let finish,output
  const host={engineCall(method,p){
    if(method==='cancel')return Promise.resolve(0) // native commit already began
    output=p.outputPath
    return new Promise(resolve=>{finish=async()=>{await fs.writeFile(output,'late wav');resolve({path:output})}})
  }}
  const pending=decodeQta(paths,host,'/source.qta',token)
  token.cancel()
  await assert.rejects(pending,/cancelled/)
  await finish()
  await new Promise(resolve=>setImmediate(resolve))
  assert.ok(!await fs.exists(output))
})
