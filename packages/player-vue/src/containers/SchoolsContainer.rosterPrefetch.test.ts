/**
 * THE ROSTER PREFETCH DOES NOT RUN ON AN INSIGHTS PAGE.
 *
 * `SchoolsContainer` hoists the dashboard's fetches to route entry so a tab is
 * warm when it is clicked. One of them, `/api/school/roster`, carries PEOPLE —
 * every teacher and pupil of the school, by name and by learner id. Tom's
 * ruling of 2026-09-16 16:31Z is that nothing in Insights names a pupil, on
 * the glance or behind a tap, and a page that never draws a name must not
 * receive 82 of them either.
 *
 * Seen live on staging 2026-09-17 (job #32), after the endpoints themselves
 * were already clean: the leader's Insights page received the whole roster
 * from this prefetch. The roster pages fetch for themselves on mount, exactly
 * as they did before the hoist, so nothing is lost but the warm-up.
 *
 * The test reads the predicate out of the container's own source rather than
 * re-declaring it, so it cannot pass against a copy that has drifted; it then
 * asserts the two people-bearing prefetches sit behind it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(join(process.cwd(), 'src/containers/SchoolsContainer.vue'), 'utf8')

describe('the roster prefetch and the Insights pages', () => {
  it('declares one path predicate for the Insights surfaces', () => {
    const line = SOURCE.split('\n').find((l) => l.includes('const INSIGHTS_PATH'))
    expect(line, 'SchoolsContainer must name the Insights paths in one place').toBeTruthy()

    const literal = /\/(.+)\/$/.exec(line!.slice(line!.indexOf('=') + 1).trim())
    const re = new RegExp(literal![1])

    // The leader's node Insights and the teacher's Insights, on both shells.
    expect(re.test('/org/741e9b6e-9542-4ac4-9d28-e29471ceaf41/insights')).toBe(true)
    expect(re.test('/schools/analytics')).toBe(true)
    // …and nothing else. The roster pages stay warm.
    expect(re.test('/org/741e9b6e-9542-4ac4-9d28-e29471ceaf41')).toBe(false)
    expect(re.test('/schools/students')).toBe(false)
    expect(re.test('/schools/teachers')).toBe(false)
    expect(re.test('/schools')).toBe(false)
  })

  it('gates the two people-bearing prefetches behind it, and only those', () => {
    const body = SOURCE.slice(SOURCE.indexOf('const INSIGHTS_PATH'), SOURCE.indexOf('// Inline login state'))
    const guard = body.indexOf('INSIGHTS_PATH.test')
    expect(guard).toBeGreaterThan(-1)
    // Names come after the guard…
    expect(body.indexOf('prefetchTeachers()')).toBeGreaterThan(guard)
    expect(body.indexOf('prefetchStudents()')).toBeGreaterThan(guard)
    // …and the nameless ones stay before it, so the card still paints fast.
    expect(body.indexOf('prefetchSchools()')).toBeLessThan(guard)
    expect(body.indexOf('prefetchClasses()')).toBeLessThan(guard)
  })
})
