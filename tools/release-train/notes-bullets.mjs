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
