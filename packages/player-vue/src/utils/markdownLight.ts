/**
 * markdownLight — the plain rendering an admin message gets (job #821).
 *
 * Deliberately tiny: paragraphs (a blank line), line breaks, **bold**, and
 * bare https links. No HTML is ever produced or injected; the template walks
 * the runs and renders spans and anchors itself, so a message body can never
 * carry markup into a learner's page.
 */
export interface Run {
  text: string
  bold?: boolean
  href?: string
}

export type Paragraph = Run[][] // lines of runs

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,!?;:'"]/g

function run(text: string, bold: boolean): Run {
  return bold ? { text, bold: true } : { text }
}

function runsOf(line: string): Run[] {
  const out: Run[] = []
  const parts = line.split(/(\*\*[^*]+\*\*)/g)
  for (const part of parts) {
    if (!part) continue
    const bold = part.startsWith('**') && part.endsWith('**') && part.length > 4
    const text = bold ? part.slice(2, -2) : part
    let last = 0
    for (const m of text.matchAll(URL_RE)) {
      const at = m.index ?? 0
      if (at > last) out.push(run(text.slice(last, at), bold))
      out.push({ ...run(m[0], bold), href: m[0] })
      last = at + m[0].length
    }
    if (last < text.length) out.push(run(text.slice(last), bold))
  }
  return out
}

export function renderMarkdownLight(body: string): Paragraph[] {
  return body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split('\n').map(runsOf))
}
