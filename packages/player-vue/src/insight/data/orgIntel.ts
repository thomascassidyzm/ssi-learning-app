// ============================================================================
// orgIntel — the browser's read of GET /api/org/intel, the org intelligence
// lens (packages/player-vue/src/intel/orgQuestions.ts names the three
// questions; api/org/intel.ts computes every number under the caller's own
// server-resolved scope).
//
// This module only carries the wire types and the fetch. Nothing is computed
// here: every figure on the lens is the server's, so the Overview and the
// Insights lens can never disagree, and a browser can never widen its own
// scope by asking differently.
// ============================================================================

export interface OrgIntelPosition {
  legoId: string
  sentence: number
  knownText: string | null
  targetText: string | null
}

export interface OrgIntelClassRow {
  id: string
  name: string
  courseCode: string | null
  phrasesThisWeek: number
  phrasesLastWeek: number
  minutesThisWeek: number
  minutesLastWeek: number
  lastPractisedAt: string | null
  daysSincePractice: number | null
  position: OrgIntelPosition | null
}

export interface OrgIntelPersonRow {
  learnerId: string
  name: string
  minutesThisWeek: number
  minutesLastWeek: number
  lastPractisedDay: string | null
}

export type QuietBucketId = 'this-week' | 'gone-a-week' | 'gone-two-weeks' | 'gone-three-weeks' | 'gone-a-month' | 'never'

export interface OrgIntelPayload {
  node: { id: string; name: string; kind: 'group' | 'school' | 'class' }
  windowDays: number
  lookbackDays: number
  countedAt: string
  practising: {
    classCount: number
    classesThisWeek: number
    classesLastWeek: number
    phrasesThisWeek: number
    phrasesLastWeek: number
    classMinutesThisWeek: number
    classMinutesLastWeek: number
    peopleCount: number
    peopleThisWeek: number
    peopleLastWeek: number
    ownMinutesThisWeek: number
    ownMinutesLastWeek: number
  }
  byDay: { day: string; phrases: number; classes: number }[]
  quiet: {
    quietCount: number
    neverCount: number
    buckets: { id: QuietBucketId; classes: number }[]
  }
  journey: {
    courses: { code: string; sentences: number }[]
    stages: { id: string; sentence: number | null; label: OrgIntelPosition | null; classes: number }[]
  }
  classes: OrgIntelClassRow[]
  /** Empty unless the practising question was asked for — absence, not zero. */
  people: OrgIntelPersonRow[]
  peopleIncluded?: boolean
  /** The course every figure was narrowed to, echoed back by the server. */
  courseCode?: string | null
}

export class OrgIntelError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string | null) {
    super(message)
  }
}

/** A payload is only a payload if it carries the three sections; anything else is treated as unavailable. */
export function isOrgIntelPayload(v: unknown): v is OrgIntelPayload {
  const p = v as Partial<OrgIntelPayload> | null
  return !!p && typeof p === 'object' && !!p.practising && !!p.quiet && !!p.journey && Array.isArray(p.classes)
}

/**
 * `opts.courseCode` — the course the Insights card above is reading, so the
 * panel under it answers about the same classes. `opts.questions` — the
 * questions actually rendered; anything left out is never even read, which is
 * how the Insights page avoids assembling a pupil list it would not draw.
 */
export async function fetchOrgIntel(
  nodeId: string,
  token: string | null,
  opts: { courseCode?: string | null; questions?: string[] } = {},
): Promise<OrgIntelPayload> {
  const params = new URLSearchParams({ nodeId })
  if (opts.courseCode) params.set('courseCode', opts.courseCode)
  if (opts.questions?.length) params.set('questions', opts.questions.join(','))
  const resp = await fetch(`/api/org/intel?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new OrgIntelError(String(body?.message || body?.error || `HTTP ${resp.status}`), resp.status, typeof body?.error === 'string' ? body.error : null)
  }
  if (!isOrgIntelPayload(body)) throw new OrgIntelError('Unexpected response', resp.status, null)
  return body
}
