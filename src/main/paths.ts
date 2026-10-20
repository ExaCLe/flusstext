import { app } from 'electron'
import { join, sep } from 'node:path'
import { mkdirSync } from 'node:fs'

const localAppData = process.env.LOCALAPPDATA ?? app.getPath('userData')

export const paths = {
  data: app.getPath('userData'),
  settings: join(app.getPath('userData'), 'settings.json'),
  transcripts: join(app.getPath('userData'), 'transcripts'),
  recordings: join(app.getPath('userData'), 'recordings'),
  dictations: join(app.getPath('userData'), 'dictations.json'),
  /** Modelle sind groß -> nicht ins Roaming-Profil */
  models: join(localAppData, 'Flusstext', 'models'),
  tmp: join(app.getPath('temp'), 'flusstext')
}

for (const dir of [paths.transcripts, paths.recordings, paths.models, paths.tmp]) {
  mkdirSync(dir, { recursive: true })
}

/** Pfad zu Binärdateien, die beim Packen aus dem asar entpackt werden. */
export function unpacked(p: string): string {
  return p.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}
