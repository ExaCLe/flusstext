import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'
import type { ExportFormat, ExportOptions, Segment, Transcript } from '@shared/types'

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

function ts(sec: number, sep: ',' | '.'): string {
  const ms = Math.round(sec * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`
}

function clock(sec: number): string {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  return h > 0 ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`
}

/** Aufeinanderfolgende Segmente desselben Sprechers zu Absätzen zusammenfassen. */
function paragraphs(t: Transcript): { speaker?: number; start: number; text: string }[] {
  const out: { speaker?: number; start: number; text: string }[] = []
  for (const s of t.segments) {
    const last = out[out.length - 1]
    if (last && last.speaker === s.speaker) last.text += ' ' + s.text
    else out.push({ speaker: s.speaker, start: s.start, text: s.text })
  }
  return out
}

function speakerName(t: Transcript, id?: number): string {
  if (id === undefined) return ''
  return t.speakers.find((s) => s.id === id)?.name ?? `Sprecher ${id + 1}`
}

function cueText(t: Transcript, s: Segment, o: ExportOptions): string {
  return o.speakers && s.speaker !== undefined ? `${speakerName(t, s.speaker)}: ${s.text}` : s.text
}

export async function exportTranscript(t: Transcript, format: ExportFormat, o: ExportOptions): Promise<string | Buffer> {
  const hasSpeakers = o.speakers && t.segments.some((s) => s.speaker !== undefined)
  switch (format) {
    case 'txt':
      return paragraphs(t)
        .map((p) => {
          const head = [o.timestamps ? `[${clock(p.start)}]` : '', hasSpeakers ? `${speakerName(t, p.speaker)}:` : '']
            .filter(Boolean)
            .join(' ')
          return head ? `${head} ${p.text}` : p.text
        })
        .join('\n\n')
    case 'md':
      return (
        `# ${t.title}\n\n` +
        paragraphs(t)
          .map((p) => {
            const head = [hasSpeakers ? `**${speakerName(t, p.speaker)}**` : '', o.timestamps ? `\`${clock(p.start)}\`` : '']
              .filter(Boolean)
              .join(' · ')
            return head ? `${head}\n\n${p.text}` : p.text
          })
          .join('\n\n')
      )
    case 'srt':
      return t.segments.map((s, i) => `${i + 1}\n${ts(s.start, ',')} --> ${ts(s.end, ',')}\n${cueText(t, s, o)}\n`).join('\n')
    case 'vtt':
      return (
        'WEBVTT\n\n' +
        t.segments
          .map((s) => {
            const text = o.speakers && s.speaker !== undefined ? `<v ${speakerName(t, s.speaker)}>${s.text}` : s.text
            return `${ts(s.start, '.')} --> ${ts(s.end, '.')}\n${text}\n`
          })
          .join('\n')
      )
    case 'json':
      return JSON.stringify(
        {
          title: t.title,
          createdAt: new Date(t.createdAt).toISOString(),
          duration: t.duration,
          language: t.language,
          model: t.modelId,
          speakers: t.speakers,
          segments: t.segments.map(({ start, end, text, speaker }) => ({ start, end, speaker, text }))
        },
        null,
        2
      )
    case 'docx': {
      const children: Paragraph[] = [new Paragraph({ text: t.title, heading: HeadingLevel.HEADING_1 })]
      for (const p of paragraphs(t)) {
        const runs: TextRun[] = []
        if (hasSpeakers) runs.push(new TextRun({ text: speakerName(t, p.speaker), bold: true }))
        if (o.timestamps) runs.push(new TextRun({ text: `${hasSpeakers ? '  ' : ''}${clock(p.start)}`, color: '888888' }))
        if (runs.length) children.push(new Paragraph({ children: runs, spacing: { before: 240 } }))
        children.push(new Paragraph({ children: [new TextRun(p.text)] }))
      }
      const doc = new Document({ creator: 'Flusstext', title: t.title, sections: [{ children }] })
      return Packer.toBuffer(doc)
    }
  }
}

