/**
 * parseHtwCopy — reads the published "How This Works" markdown document and
 * lifts the learner-facing prose out of it, back into the two ExplainerSection
 * shapes the app already renders.
 *
 * The document is the editable artefact: Aran edits the words in Popty, Popty
 * publishes the whole markdown file, and the app reads it here. The document
 * itself states the contract — "The headings and the `###`/`##` structure
 * markers are how we map your edits back into the app, so please leave those
 * alone" — so this parser treats headings as the JOIN KEY between document and
 * code, and everything under a heading as editable prose.
 *
 * Three things deliberately never come from the document, because they are code
 * rather than copy:
 *   · FIGURE names — the union ExplainerFigureName maps to components, so a
 *     name the document invented would not compile. The italic
 *     "*A drawing sits here: …*" lines describe a drawing for the editor's
 *     benefit; they are not copy and never reach body[].
 *   · LINK urls and titles — these carry a framing constraint documented in
 *     learnerExplainers.ts: every url must be on a host the in-app browser will
 *     frame, which is why rte.ie is recorded as a source but deliberately not
 *     linked. Only the learner-visible LABEL comes from the document.
 *   · EDITORIAL notes — the "*(⚠ SETTLED — …)*" markers, the front matter, the
 *     "Where a learner meets this" section and the "What's missing" section are
 *     addressed to the editor, never to a learner, and are dropped.
 *
 * Nothing here throws on odd input by design, but callers must still treat it
 * as fallible: anything it cannot recover simply comes back missing, and the
 * merge below leaves the hardcoded string in place.
 */
import type { ExplainerBlock, ExplainerSection } from './learnerExplainers'

/** A block as the document has it — prose only, no figures and no urls. */
export interface ParsedBlock {
  heading: string
  body: string[]
  points: string[]
  /** Learner-visible link labels, in the order the document's table lists them. */
  linkLabels: string[]
}

export interface ParsedSection {
  linkLabel?: string
  intro?: string
  blocks: ParsedBlock[]
}

/** Keyed by the ExplainerSection ids the app models. */
export type ParsedCopy = Partial<Record<ExplainerSection['id'], ParsedSection>>

/** '## How this works' → the section id the app models. Anything else is not a section. */
const SECTION_IDS: Record<string, ExplainerSection['id']> = {
  'how this works': 'how-this-works',
  'why this works': 'why-this-works',
}

/**
 * 'Part 2a — What a go is' → 'What a go is'. The document numbers its headings
 * so an editor can navigate it; the app never shows the numbering.
 * Both the em dash and a plain hyphen are accepted, since an editor typing the
 * heading again by hand will not reliably produce an em dash.
 */
function stripPartPrefix(heading: string): string {
  return heading.replace(/^Part\s+\S+\s*[—–-]\s*/i, '').trim()
}

/** '*(⚠ SETTLED — …)*' and '*A drawing sits here: …*' — italic, whole-line, editorial. */
function isItalicAside(line: string): boolean {
  return /^\*[^*].*\*$/.test(line)
}

/** '**Intro line, shown at the top…:**' — a bold whole-line label for the editor. */
function isBoldLabel(line: string): boolean {
  return /^\*\*.+\*\*:?$/.test(line)
}

/** '|---|---|' — a table's rule row. */
function isTableRule(line: string): boolean {
  return /^\|[\s\-:|]+\|$/.test(line)
}

function splitRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
}

/**
 * Pull the section blocks out of one '## …' section's lines.
 *
 * Note what makes the exclusions natural rather than a skip-list: sections the
 * app does not model ('## Where a learner meets this') are never entered at
 * all, so '### The Library entry screen' is out of scope by scoping; and
 * '### The player screen (a small picture, tap to open)' is dropped at the
 * merge step because no hardcoded block carries that heading — the code's block
 * list decides what a block is, and the document supplies its words.
 */
function parseSection(lines: string[]): ParsedSection {
  const section: ParsedSection = { blocks: [] }

  let current: ParsedBlock | null = null
  let paragraph: string[] = []
  // The intro blockquote is the one that follows the bold 'Intro line…' label.
  let expectIntro = false
  // Table rows only count as links once past the rule row.
  let inLinkTable = false

  const flushParagraph = (): void => {
    if (!paragraph.length) return
    const text = paragraph.join(' ').trim()
    paragraph = []
    if (text && current) current.body.push(text)
  }

  for (const raw of lines) {
    const line = raw.trim()

    if (!line) {
      flushParagraph()
      continue
    }

    if (line.startsWith('### ')) {
      flushParagraph()
      inLinkTable = false
      current = { heading: stripPartPrefix(line.slice(4)), body: [], points: [], linkLabels: [] }
      section.blocks.push(current)
      continue
    }

    if (line === '---') {
      flushParagraph()
      continue
    }

    // '*(Section link label: "How this works")*'
    const labelMatch = line.match(/^\*\(Section link label:\s*"(.+)"\)\*$/)
    if (labelMatch) {
      section.linkLabel = labelMatch[1]
      continue
    }

    if (isBoldLabel(line)) {
      flushParagraph()
      expectIntro = /intro line/i.test(line)
      continue
    }

    if (line.startsWith('>')) {
      flushParagraph()
      const quoted = line.replace(/^>\s?/, '').trim()
      if (expectIntro && quoted && !section.intro) section.intro = quoted
      expectIntro = false
      continue
    }

    if (isItalicAside(line)) {
      flushParagraph()
      continue
    }

    if (line.startsWith('|')) {
      flushParagraph()
      if (isTableRule(line)) {
        inLinkTable = true
        continue
      }
      // Rows before the rule are the header; rows after are the link rows.
      if (inLinkTable && current) {
        const label = splitRow(line)[0]
        if (label) current.linkLabels.push(label)
      }
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph()
      if (current) current.points.push(line.replace(/^[-*]\s+/, '').trim())
      continue
    }

    // Numbered lists only occur in the player-screen figure description, which
    // is not a block; carrying them as prose would be wrong anywhere else too.
    if (/^\d+\.\s+/.test(line)) {
      flushParagraph()
      continue
    }

    paragraph.push(line)
  }

  flushParagraph()
  return section
}

/**
 * Split the whole document into the sections the app models, ignoring the
 * editorial front matter and any '##' section that is not one of them.
 */
export function parseHtwCopy(markdown: string): ParsedCopy {
  const lines = markdown.split(/\r?\n/)
  const out: ParsedCopy = {}

  let id: ExplainerSection['id'] | null = null
  let buffer: string[] = []

  const flushSection = (): void => {
    if (id) out[id] = parseSection(buffer)
    id = null
    buffer = []
  }

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/)
    // '###' also matches '##', so guard on it explicitly.
    if (heading && !line.startsWith('###')) {
      flushSection()
      id = SECTION_IDS[heading[1].trim().toLowerCase()] ?? null
      continue
    }
    if (id) buffer.push(line)
  }
  flushSection()

  return out
}

/**
 * Merge one parsed section over its hardcoded counterpart, field by field.
 *
 * The hardcoded section is the SHAPE and the fallback: it decides which blocks
 * exist, in what order, with which figures and which link urls. The document
 * supplies words, and only where it actually has them — a block the document is
 * missing, or has emptied, keeps every hardcoded string it had. Nothing here
 * can produce an empty panel.
 */
export function applyParsedSection(base: ExplainerSection, parsed?: ParsedSection): ExplainerSection {
  if (!parsed) return base

  const byHeading = new Map<string, ParsedBlock>()
  for (const block of parsed.blocks) byHeading.set(block.heading.toLowerCase(), block)

  const blocks: ExplainerBlock[] = base.blocks.map((block) => {
    const found = byHeading.get(block.heading.toLowerCase())
    if (!found) return block

    const merged: ExplainerBlock = { ...block }
    if (found.body.length) merged.body = found.body
    if (found.points.length) merged.points = found.points
    // Labels are positional against the code's rows, which own url and title.
    if (block.links && found.linkLabels.length === block.links.length) {
      merged.links = block.links.map((link, i) => ({ ...link, label: found.linkLabels[i] }))
    }
    return merged
  })

  return {
    ...base,
    linkLabel: parsed.linkLabel || base.linkLabel,
    intro: parsed.intro || base.intro,
    blocks,
  }
}

/**
 * The whole job in one call: markdown in, the two sections the app renders out,
 * each one the hardcoded section with the document's words merged over it.
 */
export function buildSectionsFromMarkdown(
  markdown: string,
  base: { howThisWorks: ExplainerSection; whyThisWorks: ExplainerSection },
): { howThisWorks: ExplainerSection; whyThisWorks: ExplainerSection } {
  const parsed = parseHtwCopy(markdown)
  return {
    howThisWorks: applyParsedSection(base.howThisWorks, parsed['how-this-works']),
    whyThisWorks: applyParsedSection(base.whyThisWorks, parsed['why-this-works']),
  }
}
