/**
 * SEC-AUDIT-2026-08-18 · Findings 3 and 4 — /api/school/class-progress
 * forwards untyped client `args` straight into service-role writes.
 *
 * The endpoint's own docstring is careful and correct about the identity
 * boundary: "args EXCLUDE learnerId and courseId; both are resolved
 * server-side from the class row ... so a caller can never target an
 * arbitrary learner or course." That property holds for the SIGNATURE.
 *
 * It does not hold for the PAYLOAD. The handler says so in a comment it wrote
 * about itself — "Client-supplied and untyped by design ... (Input validation
 * of these is a separate concern, not this pass.)" — and two of the fifteen
 * methods carry that untrusted value somewhere it matters:
 *
 *   Finding 3 (mass assignment).  updateLegoProgress spreads the caller's
 *   object into the write: `.update({ ...updates, updated_at })`. The
 *   preceding ownership check proves the row belongs to the class learner
 *   BEFORE the write, and the write is then free to change which learner it
 *   belongs to. `learner_id` / `course_id` / any other column of lego_progress
 *   is writable by the caller. This is the only `...spread` into a Supabase
 *   write anywhere in api/ — every other endpoint enumerates its columns.
 *
 *   Finding 4 (PostgREST filter injection).  setLivePosition and setMode build
 *   `.or()` filters by string interpolation of caller-supplied values:
 *       .or(`last_completed_round_index.is.null,last_completed_round_index.lte.${roundIndex}`)
 *       .or(`last_completed_lego_id.is.null,last_completed_lego_id.lt.${ratchetHighestTo.legoId}`)
 *   `.or()` takes a raw PostgREST filter expression, not a bound parameter, so
 *   a comma in the value adds a disjunct. The guard those `.or()` clauses exist
 *   to enforce is the forward-only ratchet (never move a learner's position
 *   backwards); a caller who injects a disjunct dissolves that guard.
 *
 * Reachability for both: any teacher or school_admin with the class in their
 * visible scope — the endpoint's intended callers, not outsiders. So the blast
 * radius is "a teacher can corrupt progress rows beyond their class", not
 * remote takeover. It is a real boundary all the same: the whole reason this
 * endpoint exists is that the browser is not trusted to write these rows
 * directly, and the untyped passthrough hands a chunk of that trust back.
 *
 * BOTH TESTS FAIL ON PURPOSE against current main. They are the findings,
 * executable. No production behaviour is changed by this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'anon-key'

const TEACHER_UID = 'teacher-uid'
const CLASS_ID = 'class-uuid'
const CLASS_LEARNER_ID = 'class-learner-uuid'
const VICTIM_LEARNER_ID = 'victim-learner-uuid'
const PROGRESS_ROW_ID = 'lego-progress-row-uuid'

/** Writes the handler issued, and the raw `.or()` expressions it built. */
let updates: { table: string; values: Record<string, unknown> }[] = []
let orFilters: string[] = []

vi.mock('@supabase/supabase-js', () => {
  const makeBuilder = (table: string): any => {
    const b: any = {}
    b.select = () => b
    b.eq = () => b
    b.or = (expr: string) => { orFilters.push(expr); return b }
    b.update = (values: Record<string, unknown>) => { updates.push({ table, values }); return b }
    b.insert = () => b
    b.single = async () => {
      if (table === 'classes') {
        return { data: { class_learner_id: CLASS_LEARNER_ID, course_code: 'cym_for_eng' }, error: null }
      }
      return { data: null, error: null }
    }
    b.maybeSingle = async () => {
      if (table === 'classes') {
        return { data: { class_learner_id: CLASS_LEARNER_ID, course_code: 'cym_for_eng' }, error: null }
      }
      if (table === 'lego_progress') {
        // The ownership pre-check: this row DOES belong to the class learner.
        return { data: { learner_id: CLASS_LEARNER_ID }, error: null }
      }
      return { data: null, error: null }
    }
    // Awaiting the builder directly (the `.update(...).eq(...)` form) resolves here.
    b.then = (resolve: any) => resolve({ data: null, error: null })
    return b
  }
  return { createClient: () => ({ from: (table: string) => makeBuilder(table) }) }
})

vi.mock('../_utils/auth', () => ({
  verifyAuthToken: async () => ({ valid: true, userId: TEACHER_UID }),
}))

vi.mock('../_utils/schoolScope', () => ({
  resolveVisibleScope: async () => ({ role: 'teacher', classIds: [CLASS_ID], schoolIds: [], groupIds: [] }),
  chunk: (a: unknown[]) => [a],
}))

function makeRes() {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res: any = {
    status(code: number) { out.status = code; return res },
    json(body: any) { out.body = body; return res },
  }
  return { res, out }
}

async function call(method: string, args: unknown[]) {
  const { default: handler } = await import('./class-progress')
  const { res, out } = makeRes()
  await handler({
    method: 'POST',
    headers: { authorization: 'Bearer teacher-token' },
    body: { classId: CLASS_ID, method, args },
  } as any, res)
  return out
}

describe('SEC-AUDIT Findings 3 & 4 — class-progress untrusted args', () => {
  beforeEach(() => { updates = []; orFilters = [] })

  it('Finding 3: updateLegoProgress cannot repoint a row at another learner', async () => {
    const out = await call('updateLegoProgress', [
      PROGRESS_ROW_ID,
      // A caller-shaped "updates" object carrying identity columns the
      // endpoint's contract says a caller can never target.
      { reps_completed: 1, learner_id: VICTIM_LEARNER_ID, course_id: 'some_other_course' },
    ])

    expect(out.status).toBe(200)

    const write = updates.find((u) => u.table === 'lego_progress')
    expect(write, 'expected the handler to write lego_progress').toBeTruthy()

    // The property we want: server-owned identity columns are not writable
    // from the request body, whatever the caller puts in `updates`.
    expect(write!.values).not.toHaveProperty('learner_id')
    expect(write!.values).not.toHaveProperty('course_id')
  })

  it('Finding 4: setLivePosition cannot inject a disjunct into the ratchet filter', async () => {
    // The forward-only guard is `last_completed_round_index.lte.<n>`. A comma
    // in the value appends a second disjunct, and `or` means any disjunct
    // satisfies it — so the ratchet becomes unconditional.
    const injected = '0,last_completed_round_index.gte.0'
    const out = await call('setLivePosition', ['S0001L01', injected, 0])

    expect(out.status).toBe(200)
    expect(orFilters.length, 'expected the handler to build an .or() filter').toBeGreaterThan(0)

    const ratchet = orFilters.find((f) => f.includes('last_completed_round_index'))!
    // Exactly the two disjuncts the code intends — `is.null` and one `lte`.
    expect(ratchet.split(',')).toHaveLength(2)
    expect(ratchet).not.toContain('gte')
  })

  it('Finding 4 (variant): setMode ratchet takes a lego id verbatim', async () => {
    const injectedLegoId = "S0001L01,last_completed_lego_id.not.is.null"
    const out = await call('setMode', ['infplay', { legoId: injectedLegoId, roundIndex: 1 }])

    expect(out.status).toBe(200)

    const ratchet = orFilters.find((f) => f.includes('last_completed_lego_id'))!
    expect(ratchet.split(',')).toHaveLength(2)
  })
})
