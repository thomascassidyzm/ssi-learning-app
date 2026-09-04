/**
 * No bare English in a learner-facing template.
 *
 * WHY: on 2026-09-02 Tom opened "English for Hindi speakers" on his phone and
 * read English chrome on the settings, progress and resting screens. Not one of
 * those strings was a missing translation — they were hardcoded in the
 * template, so no translation could ever reach them. `settings.resetProgressDesc`
 * existed, was translated into all 24 languages, and sat unused next to the
 * literal "Start fresh for this course".
 *
 * A sweep fixes that once. This is what stops it regrowing: add user-visible
 * text to a learner-facing template without a t() call and CI goes red on the
 * push that did it, naming the file, the line and the string.
 *
 * THE THREE WAYS TO GO GREEN, in order of preference:
 *   1. Wire it — `{{ t('settings.something') }}` — minting the key in
 *      eng.json and enrolling it in i18n/pending-translation.json if new.
 *   2. Allowlist it — add the exact string to i18n/untranslatable.ts WITH a
 *      one-line reason. For brand marks, addresses, code formats, glyphs.
 *   3. Enrol it in the baseline — only for pre-existing text the 2026-09-03
 *      sweep could not key mechanically (interpolated sentences, text broken
 *      across inline markup). That list may only ever SHRINK: the test fails
 *      on an entry that no longer matches anything, so a fix must delete its
 *      baseline line. Do not add new work there.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { scanTemplateLiterals } from './scanTemplateLiterals'
import { isUntranslatable } from './untranslatable'
import BASELINE from './bare-english-baseline.json'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The learner-facing surface: what a Hindi speaker learning English actually
 * looks at. Directories, not a file list, so a NEW screen dropped into any of
 * them is policed from its first commit — which is the whole point.
 *
 * Deliberately OUT: components/admin, components/schools, views/admin,
 * views/schools, views/teach, views/marketing, views/methodology. Those are
 * staff and teacher surfaces, in English by current product decision, and a
 * gate that lit up several hundred of their literals on day one would be
 * switched off within the week. Widen this list when those surfaces are
 * localised, not before.
 */
const LEARNER_FACING = [
  'components',
  'components/auth',
  'components/learner',
  'components/me',
  'components/shared',
  'views',
  'views/me',
  'views/onboarding',
]

const baseline = (BASELINE as { files: Record<string, string[]> }).files

interface Hit {
  file: string
  line: number
  text: string
  kind: string
}

function scanAll(): Hit[] {
  const hits: Hit[] = []
  for (const dir of LEARNER_FACING) {
    const full = join(SRC, dir)
    if (!existsSync(full)) continue
    for (const name of readdirSync(full)) {
      if (!name.endsWith('.vue')) continue
      const rel = `${dir}/${name}`
      const source = readFileSync(join(full, name), 'utf8')
      for (const lit of scanTemplateLiterals(source)) {
        if (isUntranslatable(lit.text)) continue
        hits.push({ file: rel, line: lit.line, text: lit.text, kind: lit.kind })
      }
    }
  }
  return hits
}

describe('no bare English in learner-facing templates', () => {
  const hits = scanAll()

  it('scans a real, non-empty set of learner-facing components', () => {
    // Guards against the gate quietly scanning nothing after a directory move —
    // a check that inspects zero files passes forever and protects nothing.
    const files = new Set(hits.map((h) => h.file))
    expect(files.size).toBeGreaterThan(10)
  })

  it('has no user-visible text outside a t() call', () => {
    const unexplained = hits.filter((h) => !(baseline[h.file] ?? []).includes(h.text))
    const detail = unexplained
      .map((h) => `  ${h.file}:${h.line}  [${h.kind}]  ${h.text}`)
      .join('\n')

    expect(
      unexplained,
      `${unexplained.length} learner-facing string(s) are hardcoded English. A Hindi ` +
        `speaker reads every one of these in English, whatever their interface ` +
        `language, because no translation can reach a literal in a template.\n\n` +
        `Wire each one with t('some.key') — or, if it is genuinely untranslatable ` +
        `(a brand mark, an address, a code format, a glyph), add it to ` +
        `src/i18n/untranslatable.ts with a one-line reason.\n\n${detail}\n`,
    ).toEqual([])
  })

  it('has no stale baseline entries', () => {
    const live = new Set(hits.map((h) => `${h.file} ${h.text}`))
    const stale: string[] = []
    for (const [file, texts] of Object.entries(baseline)) {
      for (const text of texts) {
        if (!live.has(`${file} ${text}`)) stale.push(`  ${file}  ${text}`)
      }
    }

    expect(
      stale,
      `${stale.length} baseline entr(ies) no longer match anything — the string was ` +
        `keyed, moved or deleted. Good: the baseline only ever shrinks. Delete these ` +
        `lines from src/i18n/bare-english-baseline.json:\n\n${stale.join('\n')}\n`,
    ).toEqual([])
  })
})
