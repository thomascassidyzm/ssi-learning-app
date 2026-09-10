/**
 * The /schools class-creation write must never go straight from the browser
 * into `classes` again.
 *
 * THE HOLE (found 2026-09-10). api/school/create-class.ts enforces course
 * entitlement server-side (api/_utils/classCourseEntitlement.ts): a premium
 * course needs a paid school, its own trialled course, a live grant, or a live
 * ancestor org. But useClassesData.createClass inserted into `classes`
 * directly from the Supabase client, and the only thing behind that is the
 * RLS policy `classes_insert`, `WITH CHECK (teacher_user_id = auth.uid()::text)`
 * — row ownership, and not one word about the course. So a teacher could open
 * a class on any premium course by calling the client directly, and every
 * student tagged into that class was handed its course_code in full for as
 * long as the school's platform clock ran (api/_utils/classCoverage.ts).
 *
 * This is a SOURCE-SHAPE test on purpose. A behavioural test proves the
 * composable calls the endpoint TODAY; only this one stops a second raw insert
 * being added next to it tomorrow — which is exactly how the bypass appeared
 * in the first place. It fails on the pre-fix code (useClassesData.ts carried
 * `client.from('classes').insert({...})`) and passes on the post-fix code.
 *
 * The rule it pins is CLAUDE.md's RLS doctrine: RLS answers "is this my row?",
 * and every hierarchy or commercial authz question lives in a server endpoint
 * with tests. Reads are untouched — this is about WRITES only.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const COMPOSABLES_DIR = join(__dirname, '..', 'composables')

/** Every .ts/.vue source file under composables/, tests excluded. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// `client.from('classes')` / `supabase.from("classes")` followed by `.insert(`,
// allowing the chained-across-lines formatting the composables actually use.
const CLASSES_INSERT = /\.from\(\s*['"`]classes['"`]\s*\)[\s\S]{0,200}?\.insert\s*\(/

/**
 * Comments out, before matching. The fix's own docblock QUOTES the insert it
 * removed — the explanation is the point of it — and a scanner that cannot
 * tell code from prose would fail on a file describing the very thing it no
 * longer does.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('classes INSERT is server-mediated', () => {
  it('no composable inserts into `classes` from the browser', () => {
    const offenders = sourceFiles(COMPOSABLES_DIR).filter((file) =>
      CLASSES_INSERT.test(stripComments(readFileSync(file, 'utf8'))),
    )
    expect(offenders, `raw classes insert found in: ${offenders.join(', ')}`).toEqual([])
  })

  it('useClassesData creates classes through the entitlement-checked endpoint', () => {
    const src = readFileSync(join(COMPOSABLES_DIR, 'schools', 'useClassesData.ts'), 'utf8')
    expect(src).toContain('/api/school/create-class')
  })
})
