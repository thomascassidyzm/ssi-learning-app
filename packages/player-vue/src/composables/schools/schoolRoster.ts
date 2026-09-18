/**
 * schoolRoster — ONE in-flight fetch of `/api/school/roster` per page load.
 *
 * Measured on staging 2026-09-01 against Sunrise Public School, Pune (4
 * classes, 82 learners): opening `/schools/students` fired FOUR identical
 * `GET /api/school/roster` requests within 3ms of each other — 4 x 36KB on
 * the wire and 4 x the serverless roster aggregation, for one page. Three
 * composables ask for the same payload and each took its own slice of it:
 *
 *   useSchoolData    -> .school
 *   useTeachersData  -> .teachers
 *   useStudentsData  -> .students
 *
 * They mount together, so they race. This coalesces them: concurrent callers
 * share one promise; a caller arriving AFTER the fetch settles gets a fresh
 * one. There is deliberately no TTL cache — a teacher pressing Retry, or a
 * refresh after a write, must always see current data. The only thing removed
 * is the simultaneous duplicate, which by construction can only ever have
 * returned the same bytes as the request it duplicated.
 */

export interface SchoolRosterPayload {
  school?: unknown
  /** Empty when `part` was asked for — absence, never "this school has nobody". */
  teachers?: unknown[]
  students?: unknown[]
  part?: string
}

// Keyed by bearer token AND by the part asked for: the endpoint is
// caller-scoped, so two callers holding different tokens must never share a
// response — and a caller that asked for the school's totals alone must never
// be handed the full roster somebody else asked for (job #32).
const inflight = new Map<string, Promise<SchoolRosterPayload>>()

/**
 * `part: 'school'` asks for the school's own totals and nothing else — no
 * teacher and no pupil, named or otherwise. Every caller that only reads
 * `.school` should pass it: the Insights pages must not receive a roster they
 * never draw, and it is the cheaper read besides.
 */
export function fetchSchoolRoster(token: string, part?: 'school'): Promise<SchoolRosterPayload> {
  const key = part ? `${token}|${part}` : token
  const existing = inflight.get(key)
  if (existing) return existing
  const run = (async () => {
    const res = await fetch(`/api/school/roster${part ? `?part=${part}` : ''}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`roster ${res.status}`)
    return (await res.json()) as SchoolRosterPayload
  })()
  inflight.set(key, run)
  // Cleared on settle — success and failure alike, so a failed load is
  // retryable rather than a sticky error every later caller inherits.
  const clear = () => { if (inflight.get(key) === run) inflight.delete(key) }
  run.then(clear, clear)
  return run
}

/** Test seam: drop any in-flight promise between specs. */
export function __resetSchoolRoster(): void { inflight.clear() }
