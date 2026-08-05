/**
 * Production deep link — "open this round in the learning app".
 *
 * Popty's Script Viewer is a PROOFING tool: its own preview player has
 * deliberately minimal gaps and is not a playback-fidelity instrument. When
 * a producer wants to hear a round the way a learner actually hears it, the
 * Script Viewer launches THIS app at that exact round, rather than dropping
 * them at the top of a 668-round course.
 *
 * URL contract (emitted by Popty's `buildLearningAppUrl`, single source of
 * truth on that side):
 *
 *   /?course=<code>&round=<n>[&lego=<legoId>][&cycle=<n>]
 *
 *   - `lego`  — LEGO id (e.g. S0002L02). AUTHORITATIVE when present. Position
 *               in this system is the LEGO, so the LEGO id is the only anchor
 *               that survives round renumbering (Popty's journey view
 *               renumbers rounds when it drops content awaiting audio).
 *   - `round` — 1-based round number. Human-readable, and the fallback anchor
 *               when `lego` is absent or unresolvable. Resolved through the
 *               course round-map (`course_round_index`), the same r → legoId
 *               map instant playback already fetches.
 *   - `cycle` — 1-based cycle within the round. Best-effort: the engine clamps
 *               an out-of-range cycle to a valid one. Optional.
 *
 * Unknown / out-of-range targets do NOT error and do NOT show anything to the
 * learner: they log a console warning and leave the normal resume path
 * completely untouched, so the visitor simply lands where they always would.
 *
 * The target is captured ONCE, on first read, so every boot path (cache
 * fast-path, instant-playback bootstrap, legacy eager load) agrees on it even
 * if the URL is rewritten later. It is deliberately NOT consumed: a reload
 * replays the same round, which is what a proofing pass wants.
 */

export interface DeepLinkTarget {
  /** LEGO id, uppercased, when the link carried a well-formed one. */
  legoId: string | null
  /** 1-based round number, when the link carried a valid one. */
  round: number | null
  /** 0-based cycle index within the round (URL is 1-based), or null. */
  cycleIndex: number | null
}

/** Round-map shape this module needs — a subset of `RoundMap`. */
export interface RoundLookup {
  rounds: Array<{ r: number; legoId: string }>
}

export interface ResolvedDeepLink {
  legoId: string
  cycleIndex: number
  /** How the LEGO was found — `lego` param direct, or via the round number. */
  via: 'lego' | 'round'
}

/** Popty's LEGO id format: S0002L02. */
const LEGO_ID_RE = /^S\d{3,5}L\d{1,3}$/i

function parsePositiveInt(raw: string | null): number | null {
  if (raw === null) return null
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) && n >= 1 ? n : null
}

/**
 * Parse a query string into a deep-link target. Returns null when the query
 * carries no usable target at all, so callers can cheaply skip the whole
 * override path.
 */
export function parseDeepLinkTarget(search: string): DeepLinkTarget | null {
  let params: URLSearchParams
  try {
    params = new URLSearchParams(search || '')
  } catch {
    return null
  }

  const rawLego = params.get('lego')
  const legoId = rawLego && LEGO_ID_RE.test(rawLego.trim())
    ? rawLego.trim().toUpperCase()
    : null
  const round = parsePositiveInt(params.get('round'))
  const cycle = parsePositiveInt(params.get('cycle'))

  // A malformed `lego` with no usable `round` is a link we cannot honour —
  // warn rather than silently behaving like a plain course link.
  if (rawLego && !legoId && round === null) {
    console.warn(`[DeepLink] Ignoring malformed lego param: ${rawLego}`)
  }

  if (!legoId && round === null) return null

  return { legoId, round, cycleIndex: cycle === null ? null : cycle - 1 }
}

/**
 * Resolve a target against a course's round-map. `lego` wins when it resolves;
 * `round` is the fallback. Returns null when neither anchor exists in this
 * course — the caller then leaves normal resume alone.
 */
export function resolveDeepLinkTarget(
  target: DeepLinkTarget | null,
  map: RoundLookup | null,
): ResolvedDeepLink | null {
  if (!target || !map?.rounds?.length) return null
  const cycleIndex = Math.max(0, target.cycleIndex ?? 0)

  if (target.legoId) {
    const hit = map.rounds.find(r => r.legoId?.toUpperCase() === target.legoId)
    if (hit) return { legoId: hit.legoId, cycleIndex, via: 'lego' }
    console.warn(`[DeepLink] lego=${target.legoId} is not in this course's round-map`)
  }

  if (target.round !== null) {
    const byNumber = map.rounds.find(r => r.r === target.round)
    if (byNumber) return { legoId: byNumber.legoId, cycleIndex, via: 'round' }
    console.warn(`[DeepLink] round=${target.round} is out of range for this course`)
  }

  return null
}

// ---------------------------------------------------------------------------
// Captured-once accessor
// ---------------------------------------------------------------------------

let captured: DeepLinkTarget | null | undefined

/**
 * The deep-link target for this page load, captured on first call.
 * `search` override exists for tests.
 */
export function getDeepLinkTarget(search?: string): DeepLinkTarget | null {
  if (search !== undefined) return parseDeepLinkTarget(search)
  if (captured === undefined) {
    captured = typeof window === 'undefined'
      ? null
      : parseDeepLinkTarget(window.location.search)
    if (captured) {
      console.log(
        `[DeepLink] Production deep link: lego=${captured.legoId ?? '-'} round=${captured.round ?? '-'} cycle=${captured.cycleIndex === null ? '-' : captured.cycleIndex + 1}`,
      )
    }
  }
  return captured
}

/** Test-only: forget the captured target so the next read re-parses. */
export function __resetDeepLinkTargetForTests(): void {
  captured = undefined
}
