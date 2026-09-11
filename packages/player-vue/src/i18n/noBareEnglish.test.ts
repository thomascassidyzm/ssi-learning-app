/**
 * @vitest-environment node
 *
 * A filesystem test, not a DOM one. Under the project default (happy-dom) the
 * `url` module is shimmed and `fileURLToPath` is not a function, so this file
 * threw before a single assertion ran — the suite reported one failed FILE and
 * zero failed tests, which reads like an infrastructure blip rather than an
 * unguarded gate. Found 2026-09-07 while localising the schools surface: both
 * i18n gates had been silently inert.
 */
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
 * The localised surface: what somebody reading the app in Hindi or Welsh
 * actually looks at. Directories, not a file list, so a NEW screen dropped
 * into any of them is policed from its first commit — which is the whole
 * point.
 *
 * It said "learner-facing" until 2026-09-07, and named the teacher and school
 * directories as deliberately out: "in English by current product decision...
 * Widen this list when those surfaces are localised, not before." They are
 * localised now — 652 bare literals keyed across the schools, teach and org
 * node surfaces — so the list is widened, which is that sentence being obeyed
 * rather than overruled.
 *
 * Still deliberately OUT, and these ARE staff surfaces: the Admin*.vue screens
 * in views/admin, components/admin/invites, views/marketing and
 * views/methodology. A school leader never reaches any of them. Note that
 * views/admin is NOT excluded as a whole — NodeHomeView and NodeInsightsView
 * live there and are exactly where a school admin lands, which is why the
 * exclusion below is by file prefix rather than by directory.
 *
 * The view-as pair joins that list on 2026-09-10, by the same criterion rather
 * than as an escape from it. ViewAsPicker.vue is mounted in exactly one place —
 * inside AdminTopBar.vue, which is already excluded here — and ViewingAsBanner
 * .vue renders only while `isViewingAs` is on, which the server grants to an
 * ssi_admin and refuses to everybody else with a 403. Neither string can reach
 * a learner, a teacher or a school leader in any language, so keying them would
 * mint eleven English entries in the pending-translation register for text no
 * translator will ever be asked to translate.
 */
const STAFF_ONLY =
  /^(views\/admin\/Admin|views\/admin\/BoardReport|components\/ViewingAsBanner|components\/admin\/(AdminTopBar|BoardInlineSegments|GroupTreeNode|StructureTreeNode|ViewAsPicker))/

const LEARNER_FACING = [
  'components',
  'components/auth',
  'components/learner',
  'components/me',
  'components/shared',
  'views',
  'views/me',
  'views/onboarding',
  // Teacher, school-leader and tutor surfaces — localised 2026-09-07.
  'views/schools',
  'views/teach',
  'views/admin',
  'components/schools',
  'components/schools/shared',
  'components/admin',
  'insight',
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
      if (STAFF_ONLY.test(rel)) continue
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
