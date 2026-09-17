// ============================================================================
// classBrainData — the browser's read of GET /api/classes/:id/brain.
//
// Wire types and the fetch, nothing else. Every figure the brain shows is the
// server's, computed by api/_utils/classBrain.ts from the class's own diary,
// so the card and the page can never disagree about what the class has done.
// ============================================================================

export interface BrainLego { id: string; seed: number; t: string; k: string }
export interface BrainPhrase { t: string; k: string; lego: number; role: string; pos: number }
export interface BrainEvent { t: string; lego: number; phrase: string | null; fires: number[]; kind: string; hearings: number; s: number }

export interface ClassBrainPayload {
  courseCode: string
  /** The stretch of the course the card draws — the class's reach plus headroom. */
  legos: BrainLego[]
  legosTotal: number
  /** Course ordinal of `legos[0]`, so an event's absolute ordinal can be placed. */
  axisFrom: number
  events: BrainEvent[]
  sittings: string[]
  phrases: Record<string, BrainPhrase>
  tally: { total: number; hearings: number; detoured: number; intro: number; debut: number; build: number; use: number; other: number }
  /** NEW PHRASES: chunks the class has met for the first time. */
  introducedCount: number
  distinctPhrases: number
  /** In-app minutes over the window; -1 when the read was unavailable. */
  minutes: number
  reachedSeed: number
  reachedSeedText: { t: string; k: string } | null
  seedsTotal: number
  windowDays: number
}

export class ClassBrainError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ClassBrainError'
    this.status = status
  }
}

export async function fetchClassBrain(classId: string, token: string | null): Promise<ClassBrainPayload> {
  const resp = await fetch(`/api/classes/${encodeURIComponent(classId)}/brain`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  const body = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new ClassBrainError(String(body?.error || `HTTP ${resp.status}`), resp.status)
  if (!body || !Array.isArray(body.legos) || !Array.isArray(body.events)) throw new ClassBrainError('Unexpected response', resp.status)
  return body as ClassBrainPayload
}
