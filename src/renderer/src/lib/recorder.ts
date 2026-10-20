// Mikrofonaufnahme mit 16 kHz Mono-Float32 über ein AudioWorklet.

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1600); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i]
        if (this.n === this.buf.length) { this.port.postMessage(this.buf); this.buf = new Float32Array(1600); this.n = 0 }
      }
    }
    return true
  }
}
registerProcessor('tap', Tap)
`

export interface Recorder {
  stop(): Float32Array
  close(): void
  sampleRate: number
}

export interface RecorderOptions {
  deviceId?: string
  onChunk?: (samples: Float32Array) => void
  /** Pegel 0..1 (RMS, für Visualisierung skaliert) */
  onLevel?: (level: number) => void
  keep?: boolean
}

let workletUrl: string | null = null

export async function startRecorder(opts: RecorderOptions = {}): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: opts.deviceId && opts.deviceId !== 'default' ? { exact: opts.deviceId } : undefined,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  const ctx = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' })
  workletUrl ??= URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
  await ctx.audioWorklet.addModule(workletUrl)
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'tap')
  const chunks: Float32Array[] = []
  let total = 0
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const s = e.data
    if (opts.keep !== false) {
      chunks.push(s)
      total += s.length
    }
    opts.onChunk?.(s)
    if (opts.onLevel) {
      let sum = 0
      for (let i = 0; i < s.length; i++) sum += s[i] * s[i]
      const rms = Math.sqrt(sum / s.length)
      opts.onLevel(Math.min(1, Math.pow(rms * 6, 0.7)))
    }
  }
  src.connect(node)
  // Worklet muss am Graph hängen, sonst läuft process() nicht; stummgeschaltet ausgeben
  const mute = ctx.createGain()
  mute.gain.value = 0
  node.connect(mute).connect(ctx.destination)

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    node.port.onmessage = null
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
  }
  return {
    sampleRate: 16000,
    close,
    stop() {
      close()
      const out = new Float32Array(total)
      let o = 0
      for (const c of chunks) {
        out.set(c, o)
        o += c.length
      }
      return out
    }
  }
}

export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}
