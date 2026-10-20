// Dezente Start-/Stopp-Töne, synthetisch erzeugt (keine Audiodateien nötig).
let ctx: AudioContext | null = null

function tone(freqs: number[], dur = 0.09, gain = 0.06): void {
  ctx ??= new AudioContext()
  const t0 = ctx.currentTime
  freqs.forEach((f, i) => {
    const osc = ctx!.createOscillator()
    const g = ctx!.createGain()
    osc.type = 'sine'
    osc.frequency.value = f
    const start = t0 + i * dur * 0.9
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(gain, start + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur * 1.6)
    osc.connect(g).connect(ctx!.destination)
    osc.start(start)
    osc.stop(start + dur * 1.8)
  })
}

export const sounds = {
  start: () => tone([660, 990]),
  stop: () => tone([880, 587]),
  error: () => tone([330, 247], 0.12, 0.05)
}
