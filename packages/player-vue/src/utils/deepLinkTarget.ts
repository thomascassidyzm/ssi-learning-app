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
 *   /?course=<code>&round=<n>[&lego=<legoId>][&cycle=<n>][&cycleText=<text>]
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
 *   - `cycleText` — the known-language text of the clicked cycle. AUTHORITATIVE
 *               over `cycle` when it matches, and for the same reason `lego`
 *               beats `round`: identity survives, ordinals don't. The two sides
 *               enumerate a round differently (Popty's Script Viewer is a
 *               parallel reimplementation of the generator and has drifted), so
 *               a bare ordinal lands on the wrong row. Optional; absent or
 *               unmatched degrades to `cycle`, which is the pre-2026-08-06
 *               behaviour.
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
  /** The course the link named, so it never follows a course switch. */
  courseCode: string | null
  /** LEGO id, uppercased, when the link carried a well-formed one. */
  legoId: string | null
  /** 1-based round number, when the link carried a valid one. */
  round: number | null
  /** 0-based cycle index within the round (URL is 1-based), or null. */
  cycleIndex: number | null
  /**
   * The known-language text of the cycle the producer actually clicked.
   * AUTHORITATIVE over `cycleIndex` when it matches a cycle in the round,
   * for the same reason `lego` is authoritative over `round`: an ordinal is
   * only meaningful if both sides enumerate the same list, and here they
   * demonstrably do not. Popty's Script Viewer is a parallel reimplementation
   * of the script generator and has drifted from what the player actually
   * plays — in `deu_for_eng` round 11 the player has a bare-LEGO build the
   * Script Viewer omits, and orders the USE phrases differently. Anchoring on
   * the text lands on the row the producer clicked regardless of that drift.
   */
  cycleText: string | null
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
  /** The clicked cycle's known text, carried through for `resolveCycleIndex`. */
  cycleText: string | null
}

/** The cycle shape this module needs — a subset of `Cycle`. */
export interface CycleLookup {
  known?: { text?: string | null } | null
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

  const rawCourse = params.get('course')
  const rawCycleText = params.get('cycleText')
  return {
    courseCode: rawCourse && rawCourse.trim() !== '' ? rawCourse.trim() : null,
    legoId,
    round,
    cycleIndex: cycle === null ? null : cycle - 1,
    cycleText: rawCycleText && rawCycleText.trim() !== '' ? rawCycleText.trim() : null,
  }
}

/**
 * Normalise a known-language phrase for comparison. Case, punctuation and
 * whitespace all differ harmlessly between Popty's rendering and the player's
 * (`"How to speak as often as possible"` vs `"how to speak as often as
 * possible"`), so compare on letters and digits only.
 */
function normaliseCycleText(text: string | null | undefined): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Which cycle in this round did the producer actually click?
 *
 * `cycleText` wins when it matches exactly one cycle — that is the row they
 * were looking at. Ties (a round legitimately repeats a phrase, e.g. a USE
 * phrase that also appears as a consolidate) fall back to whichever matching
 * cycle sits nearest the ordinal, so a duplicate never drags the launch to the
 * top of the round. No match at all, or no text supplied, degrades to the
 * ordinal — which is exactly today's behaviour, so an old link still works.
 */
export function resolveCycleIndex(
  cycles: CycleLookup[] | null | undefined,
  target: { cycleIndex: number | null; cycleText: string | null } | null,
): number {
  const fallback = Math.max(0, target?.cycleIndex ?? 0)
  const wanted = normaliseCycleText(target?.cycleText)
  if (!wanted || !Array.isArray(cycles) || cycles.length === 0) return fallback

  const hits: number[] = []
  cycles.forEach((c, i) => {
    if (normaliseCycleText(c?.known?.text) === wanted) hits.push(i)
  })
  if (hits.length === 0) {
    console.warn(`[DeepLink] cycleText "${target?.cycleText}" is not in this round — using cycle ${fallback + 1}`)
    return fallback
  }
  if (hits.length === 1) return hits[0]

  return hits.reduce((best, i) => (Math.abs(i - fallback) < Math.abs(best - fallback) ? i : best), hits[0])
}

/**
 * Does this target apply to the course now playing? A link names one course;
 * if the visitor switches course in-app the target must not follow them. A
 * link with no course names no course, so it applies wherever it lands.
 */
export function deepLinkAppliesTo(
  target: DeepLinkTarget | null,
  courseCode: string | null | undefined,
): boolean {
  if (!target) return false
  if (!target.courseCode) return true
  return !!courseCode && target.courseCode === courseCode
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
    if (hit) return { legoId: hit.legoId, cycleIndex, via: 'lego', cycleText: target.cycleText }
    console.warn(`[DeepLink] lego=${target.legoId} is not in this course's round-map`)
  }

  if (target.round !== null) {
    const byNumber = map.rounds.find(r => r.r === target.round)
    if (byNumber) return { legoId: byNumber.legoId, cycleIndex, via: 'round', cycleText: target.cycleText }
    console.warn(`[DeepLink] round=${target.round} is out of range for this course`)
  }

  return null
}

/**
 * Does this launch have to run on a fresh learner's settings?
 *
 * Tom's ruling (2026-08-05): a deep-linked launch must open with the DEFAULT
 * configs that are in the DB at that time — exactly what a real learner gets,
 * not a QA/preview variant and not the reviewer's remembered local settings.
 * The point of the launch is fidelity, so the reviewer hears precisely what a
 * learner hears.
 *
 * The DB side already holds: algorithm_config (normal_mode, turbo_boost,
 * script_shape/speed, pods, listening, stage0, adaptation_v2) is fetched every
 * boot, and the old course-level "Open Learning App" link injects nothing but
 * ?course=. What diverges is the reviewer's own localStorage — playback speed,
 * QA mode, the debug overlay, adaptation consent, and a persisted offline
 * course, which would serve cached audio instead of the clip that is live NOW.
 * Those are suppressed for the launch; nothing is written, so the reviewer's
 * own settings are intact the moment they open the app normally again.
 */
export function deepLinkForcesLearnerDefaults(
  target: DeepLinkTarget | null,
  courseCode: string | null | undefined,
): boolean {
  return deepLinkAppliesTo(target, courseCode)
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
