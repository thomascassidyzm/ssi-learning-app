/**
 * notes-bullets — THE one place that decides what a release-notes bullet is.
 *
 * This module exists because the same twenty lines were written twice, in two languages, in two
 * packages: `bulletsUnder()` in tools/release-train/release-notes.mjs (the finaliser, which
 * carries hand-edited bullets through into the shipped file) and `sectionBullets()` in
 * packages/player-vue/src/composables/trainReleaseNotes.ts (the build-time parser that puts those
 * bullets on a learner's screen). Two copies agreeing by coincidence is how the train shipped a
 * bullet truncated mid-sentence on 2026-09-05, and it is the same disease as the 2026-08-29
 * "## Other stuff and bug fixes" heading drift. Both sides now import THIS file. Do not copy it.
 *
 * Two jobs:
 *
 * 1. EXTRACTION that survives a wrapped bullet. A line under a `## ` heading that is not a new
 *    `- ` bullet, not another `## ` heading, not an HTML comment and not blank CONTINUES the
 *    bullet above it, whitespace-collapsed. The old line-based regex silently dropped everything
 *    after the first line.
 *
 * 2. A PREDICATE naming the markup the Settings "What's new" panel cannot render. The panel
 *    interpolates bullets as plain text (deliberately — no v-html sink on a learner-facing page
 *    fed by a hand-authored Supabase row), so any markdown in a bullet reaches the learner as
 *    literal punctuation. The list, decided here and nowhere else:
 *      - **bold** and __bold__
 *      - *emphasis* and _emphasis_
 *      - `inline code`
 *      - [text](url) links
 *      - a leading heading marker (`# `, `## `, …)
 *      - raw HTML tags
 *    Emphasis detection deliberately requires non-space delimiters on both sides, so ordinary
 *    prose ("5 * 3", snake_case) does not trip the gate.
 */

const HEADING = /^\s*#{1,6}\s/
const RULES = [
  { name: 'bold (**…**)', re: /\*\*[^*\n]+\*\*/ },
  { name: 'bold (__…__)', re: /__[^_\n]+__/ },
  { name: 'emphasis (*…*)', re: /(^|[\s(])\*[^\s*][^*\n]*\*(?=$|[\s.,;:!?)])/ },
  { name: 'emphasis (_…_)', re: /(^|[\s(])_[^\s_][^_\n]*_(?=$|[\s.,;:!?)])/ },
  { name: 'inline code (`…`)', re: /`[^`\n]+`/ },
  { name: 'link ([text](url))', re: /\[[^\]\n]*\]\([^)\n]*\)/ },
  { name: 'heading marker', re: HEADING },
  { name: 'raw HTML tag', re: /<\/?[a-zA-Z][^>\n]*>/ },
]

/** Names of the unrenderable markup found in one bullet. Empty array = safe for the panel. */
export function unrenderableMarkup(bullet) {
  const s = String(bullet || '')
  return RULES.filter((r) => r.re.test(s)).map((r) => r.name)
}

/** Every offending bullet, as `{ bullet, problems }` — the shape both gates report from. */
export function findUnrenderable(bullets) {
  return (bullets || [])
    .map((bullet) => ({ bullet, problems: unrenderableMarkup(bullet) }))
    .filter((x) => x.problems.length > 0)
}

/**
 * Pull the bullets out of one `## ` section of a rendered notes body, JOINING wrapped
 * continuation lines. This is the single definition of "a bullet" for the whole train.
 */
export function extractBullets(body, heading) {
  const lines = String(body || '').split('\n')
  const want = `## ${heading}`.toLowerCase()
  const start = lines.findIndex((l) => l.trim().toLowerCase() === want)
  if (start === -1) return []
  const out = []
  let current = null
  const flush = () => {
    if (current !== null) {
      const text = current.replace(/\s+/g, ' ').trim()
      if (text) out.push(text)
    }
    current = null
  }
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    const m = /^\s*-\s+(.*\S)\s*$/.exec(line)
    if (m) { flush(); current = m[1]; continue }
    const t = line.trim()
    // Blank line, HTML comment, or a new heading level ends the bullet; anything else continues it.
    if (!t || t.startsWith('<!--') || HEADING.test(t)) { flush(); continue }
    if (current !== null) current += ' ' + t
  }
  flush()
  return out
}

// ── the SHAPE rule (Tom's ruling, 2026-09-08) ───────────────────────────────────────────────
// "I think the release notes are too wordy, we just need 3x headines - no more than a sentence
// for each one / and then the read more, which is one line on each thing deemed relevant".
//
// So: at most three headlines under `## What's new`, each ONE SENTENCE; and every read-more item
// under the catch-all heading is one sentence AND short enough to be one line on a phone. This
// lives here, beside the markup predicate, for the same reason that one does — two copies of a
// rule agreeing by coincidence is how the train shipped a truncated bullet on 2026-09-05.
//
// The character ceilings are knobs, not doctrine: Tom moves either with one word.

export const MAX_HEADLINES = 3
export const HEADLINE_MAX_CHARS = 200
export const READMORE_MAX_CHARS = 140

// Notes dated before this predate the ruling and are deliberately grandfathered by the on-disk
// sweep. The finalise gate has no such exemption — every NEW note is held to the shape.
export const SHAPE_RULING_DATE = '2026-09-07'

// Words that end in a full stop without ending a sentence. Kept deliberately short: the rule is
// meant to be simple, and the tests are the proof.
const ABBREVIATIONS = /(^|\s)(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|no|approx|[a-z])$/i

/** Sentence-terminating marks in a bullet, as end offsets — decimals and abbreviations skipped. */
function terminators(s) {
  const out = []
  const re = /[.!?]+(?=\s|$)/g
  let m
  while ((m = re.exec(s)) !== null) {
    if (m[0] === '.' && ABBREVIATIONS.test(s.slice(0, m.index))) continue
    out.push(m.index + m[0].length)
  }
  return out
}

/** Is this bullet exactly one sentence — one terminator, and it closes the bullet? */
export function isOneSentence(bullet) {
  const s = String(bullet || '').trim()
  const ends = terminators(s)
  return ends.length === 1 && ends[0] === s.length
}

/**
 * What is wrong with the SHAPE of one bullet. Empty array = it fits the ruling.
 * `kind` is 'headline' (under "What's new") or 'readmore' (the catch-all section).
 */
export function shapeProblems(bullet, kind) {
  const s = String(bullet || '').trim()
  const max = kind === 'headline' ? HEADLINE_MAX_CHARS : READMORE_MAX_CHARS
  const problems = []
  if (!isOneSentence(s)) {
    problems.push(kind === 'headline'
      ? 'a headline must be exactly one sentence'
      : 'a read-more item must be exactly one sentence')
  }
  if (s.length > max) problems.push(`over ${max} characters (${s.length})`)
  return problems
}

/** Every off-shape bullet in one section, as `{ bullet, problems }` — the shape both gates report. */
export function findOffShape(bullets, kind) {
  return (bullets || [])
    .map((bullet) => ({ bullet, problems: shapeProblems(bullet, kind) }))
    .filter((x) => x.problems.length > 0)
}
