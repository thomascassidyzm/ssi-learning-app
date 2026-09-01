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
  teachers?: unknown[]
  students?: unknown[]
}

// Keyed by bearer token: the endpoint is caller-scoped, so two callers
// holding different tokens must never share a response.
const inflight = new Map<string, Promise<SchoolRosterPayload>>()

export function fetchSchoolRoster(token: string): Promise<SchoolRosterPayload> {
  const existing = inflight.get(token)
  if (existing) return existing
  const run = (async () => {
    const res = await fetch('/api/school/roster', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`roster ${res.status}`)
    return (await res.json()) as SchoolRosterPayload
  })()
  inflight.set(token, run)
  // Cleared on settle — success and failure alike, so a failed load is
  // retryable rather than a sticky error every later caller inherits.
  const clear = () => { if (inflight.get(token) === run) inflight.delete(token) }
  run.then(clear, clear)
  return run
}

/** Test seam: drop any in-flight promise between specs. */
export function __resetSchoolRoster(): void { inflight.clear() }
