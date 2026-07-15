/**
 * renderBoardMarkdown — the narrow markdown-to-blocks renderer for board
 * reports (docs/board/reports/*.md). The corpus is bounded and authored by
 * one person (headings, paragraphs, bullet/numbered lists, **bold**, and
 * {{metric:...}} tokens) — a hand-written splitter here is simpler and
 * cheaper than adding a general markdown dependency for four block shapes.
 * Shared by the live view (BoardReportView) and the frozen view
 * (BoardSnapshotView) — only the metrics source differs.
 */

import { parseBoardTokens, type ResolvedMetric } from './boardTokens'

export type InlineSegment =
  | { type: 'text'; text: string; bold?: boolean }
  | { type: 'metric'; metric: ResolvedMetric; bold?: boolean }
  | { type: 'unknown'; slug: string; bold?: boolean }

export type BoardBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; segments: InlineSegment[] }
  | { kind: 'paragraph'; segments: InlineSegment[] }
  | { kind: 'list'; ordered: boolean; items: InlineSegment[][] }

const BOLD_RE = /(\*\*[^*]+\*\*)/g
const HEADING_RE = /^(#{1,3})\s+(.*)$/
const BULLET_RE = /^[-*]\s+/
const NUMBERED_RE = /^\d+\.\s+/

// Bold-split FIRST, then token-parse each part — so a token wrapped in bold
// markers (`**{{metric:x}}**`, which the token regex alone would split
// unevenly) resolves correctly and the resulting segment carries bold:true.
function parseInline(text: string, metrics: Record<string, ResolvedMetric>): InlineSegment[] {
  const result: InlineSegment[] = []
  for (const part of text.split(BOLD_RE)) {
    if (!part) continue
    const bold = part.startsWith('**') && part.endsWith('**')
    const inner = bold ? part.slice(2, -2) : part
    for (const seg of parseBoardTokens(inner, metrics)) {
      result.push(bold ? { ...seg, bold: true } : seg)
    }
  }
  return result
}

export function renderBoardMarkdown(markdown: string, metrics: Record<string, ResolvedMetric>): BoardBlock[] {
  const blocks: BoardBlock[] = []
  const rawBlocks = markdown.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)

  for (const raw of rawBlocks) {
    const lines = raw.split('\n').map(l => l.trim())
    const headingMatch = lines.length === 1 ? lines[0].match(HEADING_RE) : null

    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        segments: parseInline(headingMatch[2], metrics),
      })
      continue
    }

    const isBulletList = lines.every(l => BULLET_RE.test(l))
    const isNumberedList = lines.every(l => NUMBERED_RE.test(l))

    if (isBulletList || isNumberedList) {
      const stripRe = isNumberedList ? NUMBERED_RE : BULLET_RE
      blocks.push({
        kind: 'list',
        ordered: isNumberedList,
        items: lines.map(l => parseInline(l.replace(stripRe, ''), metrics)),
      })
      continue
    }

    blocks.push({ kind: 'paragraph', segments: parseInline(lines.join(' '), metrics) })
  }

  return blocks
}
