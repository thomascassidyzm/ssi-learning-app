/**
 * Cycles API — GET /api/courses/:code/cycles?from=:legoId&limit=:n
 *
 * Instant-playback critical path. Returns the next `n` fully-assembled
 * cycles starting from the LEGO matching `:from`, in script order
 * (intro -> debut -> BUILDs -> USEs per LEGO, then next LEGO).
 *
 * COMPONENTS ARE NEVER INTRODUCED (Tom, 2026-08-06). Only LEGOs get
 * introductions. Component rows are tiling parts of a whole thought; the
 * learner absorbs them inside the carrier M-LEGO's own introduction, and a
 * component debut hands the learner no producible intention. This endpoint
 * emitted `component_intro` cycles between 2026-08-04 (9e9a19bf) and
 * 2026-08-06; it does not any more, and must not again.
 *
 * Frontend calls this with limit=1 on Start (for instant first cycle),
 * then limit=15 once audio is playing.
 *
 * Performance — ONE Supabase round-trip:
 *   The previous implementation made four sequential Supabase calls
 *   (courses → round_index start → round_index window → legos+phrases
 *   parallel). Each Vercel→Supabase round-trip is ~100-150ms of physics,
 *   so the endpoint floored at ~700ms. The data is small (one course's
 *   window) and Postgres can do all four joins internally for free, so
 *   we collapsed everything into `get_course_cycles_window(...)` (see
 *   migration 20260518_course_cycles_window_fn.sql in the dashboard
 *   repo). Result: ~150-250ms typical.
 *
 *   The Node side here is now a thin pass-through: call the RPC,
 *   group the rows by LEGO, assemble cycles. No SQL knowledge needed —
 *   the function returns ready-to-iterate jsonb.
 *
 * Notes:
 *  - LEGO walk is driven by course_round_index inside the rpc.
 *  - Audio IDs are returned, not bytes. Frontend uses /api/audio/[audioId].
 *  - decomposition is included only when course_practice_phrases.decomposition
 *    is non-null (column added by 20260518_course_practice_phrases_decomposition.sql).
 *
 * SPACED REVIEW (2026-08-09). This comment used to read "Cross-LEGO spaced-rep
 * is NOT included here; the frontend constructs those from the round-map".
 * The frontend never did. INSTANT_PLAYBACK_ALL makes this endpoint the live
 * default for every course, so every round it built played with ZERO spaced
 * review — while rounds built by the JS walk (generateLearningScript, via the
 * script-cache fast path) carried a full review block. One session queue mixes
 * both producers, so the learner got reviews on some rounds and none on the
 * next. That is the bug this file now closes: the endpoint emits the SAME
 * round shape the walk does —
 *
 *   intro -> debut -> BUILD ×≤7 (USE-filled) -> spaced_rep ×≤12 -> USE ×≤2
 *
 * with the Fibonacci offsets, the N-1 triple, and the consolidation tail all
 * mirrored from generateLearningScript.ts, which stays the source of truth:
 * parity means this endpoint moves to match the walk, never the reverse.
 *
 * KNOWN GAPS vs the walk, deliberate and documented rather than silently
 * approximated:
 *   - SEED-PHASE reviews (offsets ≥144, the drained target→known→target→target
 *     sandwich) are not emitted: they need course_seeds rows and the walk's
 *     graduation bookkeeping. Offsets [1..89] — every use-phrase review — are.
 *   - The walk's algorithm_config-driven pools (shortest-first syllable sort,
 *     phrase-length cap, known-side review pull filter, sliding word cap) are
 *     not applied here; this endpoint keeps DB position order. It changes WHICH
 *     phrase a review pulls, not whether the review exists.
 *
 * Cache-Control: private, max-age=60 — frontend may re-fetch cheaply,
 * other learners aren't sharing this (per-session walk).
 *
 * See: ssi-dashboard-v7-clean/new_vision/INSTANT_PLAYBACK_SPEC.md
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveServerCourseAccess } from '../../_utils/courseAccess'
import { courseMaxSeed } from '../../_utils/courseBoundary'
import { fetchRevisedAudioRefs, stampRowAudioRefs } from '../../_utils/audioAccess'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

const COURSE_CODE_RE = /^[a-z0-9_]+$/
const LEGO_ID_RE = /^S\d{4}L\d{2}$/

const DEFAULT_LIMIT = 15
const MAX_LIMIT = 50

// --- Round shape ------------------------------------------------------------
// Mirrored from DEFAULT_SCRIPT_SHAPE in
// packages/player-vue/src/providers/generateLearningScript.ts, which is the
// source of truth. Duplicated rather than imported because api/** compiles
// standalone (see tsconfig.api.json) and must not pull the Vue package's
// dependency graph into a serverless bundle on the instant path.
//
// Only the use-phrase offsets are listed. The walk's tail (144, 233, 377, …)
// is the SEED-PHASE production review, which this endpoint does not emit —
// see the KNOWN GAPS note in the file header.
export const SPACED_REP_OFFSETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
/** N-1 (the LEGO introduced last round) contributes three review phrases; every
 *  other offset contributes one. */
export const N1_PHRASE_COUNT = 3
export const MAX_SPACED_REP_PHRASES = 12
export const MAX_BUILD_PHRASES = 7
export const USE_CONSOLIDATION_COUNT = 2

interface CourseLegoRow {
  seed_number: number
  lego_index: number
  lego_id: string
  type: 'A' | 'M' | null
  known_text: string | null
  target_text: string | null
  target_text_roman: string | null
  components: Array<{ known: string; target: string }> | null
  is_new: boolean | null
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
  presentation_audio_id: string | null
  target1_duration_ms: number | null
  target2_duration_ms: number | null
}

interface CoursePhraseRow {
  seed_number: number
  lego_index: number
  position: number | null
  phrase_role: string | null
  known_text: string | null
  target_text: string | null
  target_text_roman: string | null
  decomposition: Array<{
    legoId: string | null
    target: string
    known: string
    isGhost: boolean
  }> | null
  /** Authored display tiles ({n: native, r: roman, salient}) — present only
   * once get_course_cycles_window includes display_tiling in its phrase JSON
   * (migration 20260607_course_cycles_window_display_tiling.sql). */
  display_tiling?: Array<{ n: string; r: string; salient?: boolean }> | null
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
  target1_duration_ms: number | null
  target2_duration_ms: number | null
  /** Historic per-component "as in" narration on `phrase_role = 'component'`
   * rows. NEVER played: components are never introduced (Tom, 2026-08-06). */
  presentation_audio_id?: string | null
  /** Authoring flag on component rows. NOT a licence to introduce the `true`
   * ones — components are never introduced either way (Tom, 2026-08-06).
   * Retained only because component rows still render as visual tiles. */
  introduce?: boolean | null
}

interface RoundMapRow {
  round_index: number
  lego_id: string
  seed_number: number
  lego_index: number
}

// Cycle response type kept loose (Record<string, unknown>) at the boundary —
// we explicitly assemble each cycle below so the wire shape is whatever the
// spec requires, without over-typing the JSON.
type Cycle = Record<string, unknown>

/**
 * Parse a LEGO id of the form "S0042L01" into its (seed_number, lego_index)
 * tuple. Returns null on malformed input.
 */
function parseLegoId(legoId: string): { seedNumber: number; legoIndex: number } | null {
  const m = legoId.match(/^S(\d{4})L(\d{2})$/)
  if (!m) return null
  return {
    seedNumber: parseInt(m[1], 10),
    legoIndex: parseInt(m[2], 10),
  }
}

/**
 * Pick the display target text. Convention from generateLearningScript.ts:
 * when target_text_roman exists, show romanized; native script goes under
 * target_text_native. When no romanization, target_text is itself native.
 */
function pickTargets(row: {
  target_text: string | null
  target_text_roman: string | null
}): { target_text: string; target_text_native?: string } {
  if (row.target_text_roman && row.target_text_roman.trim()) {
    return {
      target_text: row.target_text_roman,
      target_text_native: row.target_text ?? '',
    }
  }
  return { target_text: row.target_text ?? '' }
}

/**
 * Build the audio block for a cycle. Omit keys whose IDs are null so the
 * response stays lean — the frontend treats absence as "no audio for this
 * role" (e.g. presentation only exists on intro cycles).
 */
function buildAudio(opts: {
  knownAudioId?: string | null
  target1AudioId?: string | null
  target2AudioId?: string | null
  presentationAudioId?: string | null
}): Record<string, string> {
  const audio: Record<string, string> = {}
  if (opts.knownAudioId) audio.known_id = opts.knownAudioId
  if (opts.target1AudioId) audio.target1_id = opts.target1AudioId
  if (opts.target2AudioId) audio.target2_id = opts.target2AudioId
  if (opts.presentationAudioId) audio.presentation_id = opts.presentationAudioId
  return audio
}

/**
 * Within-round phrase de-duplication key. Mirrors `normalizeText` +
 * `getPhraseId` in generateLearningScript.ts — same punctuation class, same
 * lowercase-and-trim — so both producers collapse the same pairs of rows.
 */
function normalizeText(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:\u00a1\u00bf'"\u3000-\u303f\uff00-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]+/g, '')
}

function phraseId(known: string | null | undefined, target: string | null | undefined): string {
  return `${normalizeText(known)}|${normalizeText(target)}`
}

/** All three clips present — the walk drops any phrase without them rather
 *  than schedule a cycle the player would only skip. */
function phraseHasFullAudio(p: CoursePhraseRow): boolean {
  return !!(p.known_audio_id && p.target1_audio_id && p.target2_audio_id)
}

/**
 * One earlier LEGO due for review in this round, already resolved by the
 * handler from the round map. `offsetIndex` indexes SPACED_REP_OFFSETS, so 0
 * is N-1 (the LEGO introduced last round) and the list arrives in offset order
 * — the same order the walk's `dueForReview` is built in.
 */
export interface ReviewLego {
  offsetIndex: number
  legoId: string
  seedNumber: number
  /** The round the reviewed LEGO was introduced in — the walk's `reviewOf`. */
  reviewOf: number
  usePhrases: CoursePhraseRow[]
}

/**
 * Where this review's round-robin cursor sits in the reviewed LEGO's USE
 * basket.
 *
 * The walk keeps `state.useIndex` on the LEGO and advances it by one per
 * phrase pulled, across the whole session. A LEGO introduced at round R is
 * reviewed at R+1 (three phrases), then R+2, R+3, R+5, … (one each) — so by
 * the review at offset index k the cursor has advanced a known, closed-form
 * amount. This endpoint has no session state, and reconstructing it is exactly
 * this arithmetic.
 *
 * Caveat, stated rather than hidden: it assumes no earlier review of this LEGO
 * was truncated by the 12-phrase round cap or skipped by within-round
 * de-duplication. Both are rare; when they happen the endpoint picks a
 * neighbouring phrase from the same basket, never a wrong LEGO.
 */
/**
 * Which earlier rounds come due for review in `roundIndex`, in offset order.
 *
 * The walk's phase 4 in closed form: it scans the offsets ascending and takes
 * any LEGO whose `lastRound` is exactly `roundNumber - offset`. Because the
 * round map introduces exactly one new LEGO per round, "the LEGO at round
 * r - offset" and "the LEGO due at this offset" are the same thing. Offsets
 * that reach before round 1 stop the scan — an early round legitimately has
 * nothing to review, and gets an empty list rather than a padded one.
 */
export function dueReviewRounds(roundIndex: number): Array<{ offsetIndex: number; reviewRound: number }> {
  const due: Array<{ offsetIndex: number; reviewRound: number }> = []
  for (let k = 0; k < SPACED_REP_OFFSETS.length; k++) {
    const reviewRound = roundIndex - SPACED_REP_OFFSETS[k]
    if (reviewRound < 1) break
    due.push({ offsetIndex: k, reviewRound })
  }
  return due
}

export function reviewCursor(offsetIndex: number, poolLength: number): number {
  if (offsetIndex <= 0 || poolLength <= 0) return 0
  return Math.min(N1_PHRASE_COUNT, poolLength) + (offsetIndex - 1)
}

function buildDurations(t1?: number | null, t2?: number | null): Record<string, number> {
  const d: Record<string, number> = {}
  if (typeof t1 === 'number') d.target1_ms = t1
  if (typeof t2 === 'number') d.target2_ms = t2
  return d
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const code = req.query.code
  if (!code || typeof code !== 'string' || !COURSE_CODE_RE.test(code)) {
    res.status(400).json({ error: 'Invalid course code' })
    return
  }

  const from = req.query.from
  if (!from || typeof from !== 'string' || !LEGO_ID_RE.test(from)) {
    res.status(400).json({ error: 'Invalid or missing `from` LEGO id (expected SNNNNLNN)' })
    return
  }

  // Clamp limit. limit=0 is meaningless; treat as default. We cap at MAX_LIMIT
  // so a misconfigured client can't blow out cold-start budget.
  let limit = DEFAULT_LIMIT
  if (typeof req.query.limit === 'string') {
    const parsed = parseInt(req.query.limit, 10)
    if (!Number.isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT)
    }
  }

  try {
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey ||
        (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
    )

    // Single Postgres call: everything we need (course version, round window,
    // legos for that window, phrases for that window's seeds) in one network
    // round-trip. See migration 20260518_course_cycles_window_fn.sql for the
    // function definition. The RPC's `course` payload only carries
    // course_code + version (no pricing metadata), so the entitlement gate
    // needs its own tiny lookup — run in parallel, it's a single indexed row.
    //
    // Spaced review needs the round map BEFORE the window too — a review at
    // offset 89 reaches 89 rounds back, which the RPC's window never contains.
    // The whole map is small (one small row per LEGO; round-map.ts already
    // ships all of it to every client) and, crucially, does NOT depend on the
    // RPC's answer, so it rides the same Promise.all and costs zero extra
    // latency. Only the review PHRASES have to wait for it — one sequential
    // round-trip, added below.
    const ROUND_FETCH = Math.min(limit + 2, MAX_LIMIT + 2)
    const [rpcResult, pricingRes, fullMapRes] = await Promise.all([
      supabase.rpc('get_course_cycles_window', {
        p_course_code: code,
        p_from_lego_id: from,
        p_round_limit: ROUND_FETCH,
      }),
      supabase
        .from('courses')
        .select('target_lang, pricing_tier, is_community')
        .eq('course_code', code)
        .maybeSingle(),
      supabase
        .from('course_round_index')
        .select('round_index, lego_id, seed_number')
        .eq('course_code', code)
        .order('round_index', { ascending: true }),
    ])
    const { data, error } = rpcResult

    if (error) {
      console.error('[Cycles] rpc error:', error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load cycles window' })
      return
    }
    if (pricingRes.error) {
      console.error('[Cycles] pricing lookup failed:', pricingRes.error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load course pricing' })
      return
    }
    if (fullMapRes.error) {
      // Non-fatal: the window itself is intact, so serve the round WITHOUT its
      // review block rather than fail the instant path. Loud in the log,
      // because a session that quietly loses spaced review is precisely the
      // bug this code exists to close.
      console.error('[Cycles] round-map lookup failed (serving without reviews):', fullMapRes.error.message)
    }

    const payload = (data || {}) as {
      course: { course_code: string; version: number } | null
      rounds: RoundMapRow[] | null
      legos: CourseLegoRow[] | null
      phrases: CoursePhraseRow[] | null
    }

    if (!payload.course) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(404).json({ error: 'Course not found' })
      return
    }
    if (!payload.rounds || payload.rounds.length === 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(404).json({ error: `LEGO ${from} not in round map for course ${code}` })
      return
    }

    const version = payload.course.version

    // --- Entitlement gate -----------------------------------------------------
    // Free/community courses skip auth entirely. Premium courses require a
    // valid Supabase Auth token + active subscription/entitlement for full
    // content; anonymous or unsubscribed callers get sliced down to the
    // free-preview window (through Yellow Belt), mirroring bundle.ts. A
    // request starting `from` a LEGO beyond the preview window is denied
    // outright (400) rather than silently returning an empty cycle list —
    // there's nothing to preview-slice mid-window the way bundle.ts slices
    // a whole-course payload.
    const pricingRow = (pricingRes.data || {}) as {
      target_lang: string | null
      pricing_tier: string | null
      is_community: boolean | null
    }
    const access = await resolveServerCourseAccess(req, supabase, {
      course_code: code,
      pricing_tier: pricingRow.pricing_tier,
      is_community: pricingRow.is_community,
      target_lang: pricingRow.target_lang,
    })
    const previewOnly = !access.canAccess
    if (previewOnly && !(access.canPreview && access.previewMaxSeed)) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(403).json({ error: 'Subscription required', reason: access.reason })
      return
    }
    const previewMaxSeed = access.previewMaxSeed ?? 0

    const fromParsed = parseLegoId(from)
    if (previewOnly && fromParsed && fromParsed.seedNumber > previewMaxSeed) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(403).json({ error: 'Subscription required', reason: access.reason })
      return
    }

    // Two independent seed ceilings, both inclusive, applied together:
    //  - previewMaxSeed: the entitlement gate above (paywall).
    //  - courseMaxSeed:  where the course's BUILT content ends
    //    (_utils/courseBoundary — MVP courses author more seeds than they
    //    have audio for). round-map already truncates the walk, so a client
    //    on the normal path never asks for these; this is the direct-call
    //    guard so the ceiling can't be stepped over by a stale cached map.
    const builtMaxSeed = courseMaxSeed(code)
    const ceilings: number[] = []
    if (previewOnly) ceilings.push(previewMaxSeed)
    if (builtMaxSeed !== null) ceilings.push(builtMaxSeed)
    const maxSeed = ceilings.length > 0 ? Math.min(...ceilings) : null
    const withinCeiling = <T extends { seed_number: number }>(list: T[]): T[] =>
      maxSeed === null ? list : list.filter((x) => x.seed_number <= maxSeed)

    const rounds = withinCeiling(payload.rounds)

    // Per-clip versioned refs. A clip that has been replaced gets `<uuid>.vN`
    // here, before anything turns these ids into `/api/audio/${id}` URLs — so
    // the new bytes reach devices that already cached the old ones, in both the
    // browser's HTTP cache (keyed by URL) and AudioCache (keyed by audio id).
    // Unrevised clips keep their bare uuid and their existing cache entries.
    const audioRefs = await fetchRevisedAudioRefs(supabase, code)
    const legoRows = stampRowAudioRefs(audioRefs, withinCeiling(payload.legos || []))
    const phraseRows = stampRowAudioRefs(audioRefs, withinCeiling(payload.phrases || []))

    // Index for O(1) lookup during the per-LEGO walk.
    const legoByKey = new Map<string, CourseLegoRow>()
    for (const l of legoRows) {
      legoByKey.set(`${l.seed_number}:${l.lego_index}`, l)
    }
    // Group phrases by (seed,lego), preserving position-order from the query.
    const phrasesByKey = new Map<string, CoursePhraseRow[]>()
    for (const p of phraseRows) {
      const key = `${p.seed_number}:${p.lego_index}`
      let list = phrasesByKey.get(key)
      if (!list) {
        list = []
        phrasesByKey.set(key, list)
      }
      list.push(p)
    }

    // --- Spaced review: resolve which earlier LEGOs come due ------------------
    //
    // Round numbering is the materialised one (course_round_index.round_index,
    // 1-based) — the same numbering the walk's `roundNumber` produces, because
    // both count NEW LEGOs in script order. A LEGO whose round is exactly
    // `r - offset` for one of SPACED_REP_OFFSETS is due in round r; the first
    // offset that matches a given LEGO wins, which for a one-LEGO-per-round map
    // means one distinct LEGO per offset.
    //
    // We only resolve reviews for a bounded PREFIX of the window. Every round
    // emits at least intro+debut+one practice cycle, so `limit/3 + 1` rounds
    // covers any request that isn't unusually thin, and the loop below refuses
    // to emit a round it has no review answer for — it paginates instead. That
    // keeps the one added phrase query bounded regardless of `limit`.
    const fullMapRows = (fullMapRes.data || []) as Array<{
      round_index: number
      lego_id: string
      seed_number: number
    }>
    const roundByIndex = new Map<number, { legoId: string; seedNumber: number; legoIndex: number }>()
    for (const row of withinCeiling(fullMapRows)) {
      const parsed = parseLegoId(row.lego_id)
      if (!parsed) continue
      roundByIndex.set(row.round_index, {
        legoId: row.lego_id,
        seedNumber: row.seed_number,
        legoIndex: parsed.legoIndex,
      })
    }

    const reviewRoundBudget = roundByIndex.size === 0
      ? 0
      : Math.min(rounds.length, Math.ceil(limit / 3) + 1)

    /** roundIndex → the earlier LEGOs due in it, in offset order. */
    const reviewsByRound = new Map<number, ReviewLego[]>()
    const neededKeys = new Set<string>()
    for (let i = 0; i < reviewRoundBudget; i++) {
      const r = rounds[i]
      const due: ReviewLego[] = []
      const seen = new Set<string>()
      for (const { offsetIndex: k, reviewRound } of dueReviewRounds(r.round_index)) {
        const entry = roundByIndex.get(reviewRound)
        if (!entry || entry.legoId === r.lego_id || seen.has(entry.legoId)) continue
        seen.add(entry.legoId)
        due.push({
          offsetIndex: k,
          legoId: entry.legoId,
          seedNumber: entry.seedNumber,
          reviewOf: reviewRound,
          usePhrases: [],
        })
        neededKeys.add(`${entry.seedNumber}:${entry.legoIndex}`)
      }
      reviewsByRound.set(r.round_index, due)
    }

    // Fetch the USE baskets we don't already hold from the window. This is the
    // ONE extra sequential round-trip the review block costs. It is filtered to
    // the exact (seed, lego) pairs due — an `in('seed_number', …)` would be a
    // shorter URL but would drag back every LEGO of every seed touched, which
    // on the instant path is the wrong trade.
    const missingPairs = [...neededKeys].filter((k) => !phrasesByKey.has(k))
    if (missingPairs.length > 0) {
      const pairFilter = missingPairs
        .map((k) => {
          const [seedNumber, legoIndex] = k.split(':')
          return `and(seed_number.eq.${seedNumber},lego_index.eq.${legoIndex})`
        })
        .join(',')
      const { data: reviewPhraseRows, error: reviewPhraseErr } = await supabase
        .from('course_practice_phrases')
        .select(
          'seed_number, lego_index, position, phrase_role, known_text, target_text, target_text_roman, decomposition, display_tiling, known_audio_id, target1_audio_id, target2_audio_id, target1_duration_ms, target2_duration_ms'
        )
        .eq('course_code', code)
        .eq('phrase_role', 'use')
        .or(pairFilter)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })
        .order('position', { ascending: true })
      if (reviewPhraseErr) {
        console.error('[Cycles] review phrase lookup failed (serving without reviews):', reviewPhraseErr.message)
      } else {
        for (const p of stampRowAudioRefs(audioRefs, (reviewPhraseRows || []) as CoursePhraseRow[])) {
          const key = `${p.seed_number}:${p.lego_index}`
          let list = phrasesByKey.get(key)
          if (!list) {
            list = []
            phrasesByKey.set(key, list)
          }
          list.push(p)
        }
      }
    }

    // Fill each due LEGO's basket. ONLY use phrases enter spaced repetition —
    // components never do, and a build phrase is a fragment that belongs to
    // its own debut round. A phrase missing any of its three clips is dropped
    // here rather than scheduled and then skipped by the player.
    for (const due of reviewsByRound.values()) {
      for (const review of due) {
        const parsed = parseLegoId(review.legoId)
        if (!parsed) continue
        const basket = phrasesByKey.get(`${review.seedNumber}:${parsed.legoIndex}`) || []
        review.usePhrases = basket.filter((p) => p.phrase_role === 'use' && phraseHasFullAudio(p))
      }
    }

    // 5. Assemble cycles. Walk LEGOs in round order, emit the full round shape
    //    (intro/debut/builds/reviews/consolidation) until we hit `limit` cycles.
    //    Track `nextLegoId` = first LEGO we did NOT fully exhaust (or the next
    //    one beyond the last fully-emitted LEGO).
    const cycles: Cycle[] = []
    let nextLegoId: string | null = null

    outer: for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i]
      // Past the review budget we stop rather than serve a review-less round —
      // a round with no spaced review is the defect, and the client's next
      // page picks up exactly here.
      if (i >= reviewRoundBudget && roundByIndex.size > 0) {
        nextLegoId = r.lego_id
        break
      }
      const legoKey = `${r.seed_number}:${r.lego_index}`
      const lego = legoByKey.get(legoKey)
      if (!lego) {
        // Round-map references a LEGO not present in course_legos — schema
        // drift or partial-import course. Skip silently rather than fail
        // the whole request; player will gap-fill.
        continue
      }

      const legoCycles = buildLegoCycles(
        lego,
        phrasesByKey.get(legoKey) || [],
        reviewsByRound.get(r.round_index) || []
      )

      for (const cycle of legoCycles) {
        if (cycles.length >= limit) {
          // We stopped mid-LEGO (or before this LEGO's first cycle).
          // Pagination cursor = THIS LEGO so the next page replays the
          // remaining cycles. The frontend can de-dupe by cycle.id.
          nextLegoId = r.lego_id
          break outer
        }
        cycles.push(cycle)
      }

      // We emitted everything for this LEGO; if there's a next one in the
      // window, that's our pagination cursor. If we're at the end of the
      // window without hitting `limit`, nextLegoId stays null (course end
      // from the caller's POV, even if more rounds exist beyond ROUND_FETCH).
      if (i + 1 < rounds.length) {
        nextLegoId = rounds[i + 1].lego_id
      } else {
        nextLegoId = null
      }
    }

    // On a preview slice, a null nextLegoId means "preview window exhausted",
    // NOT "course finished" — the previewOnly flag lets the frontend tell
    // the two apart and show the paywall instead of a completion screen.
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.status(200).json({
      course_code: code,
      version,
      cycles,
      next_lego_id: nextLegoId,
      ...(previewOnly ? { preview_only: true } : {}),
    })
  } catch (error) {
    console.error('[Cycles] Unexpected error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

/**
 * Emit the cycle sequence for one LEGO: intro -> debut -> BUILD phrases ->
 * USE phrases. Phrases honour their `position` order from the DB.
 *
 * No filtering by audio completeness here — the spec says return everything
 * in script order and let the frontend decide. The audio.* keys are simply
 * omitted when their IDs are null; the player handles missing roles.
 *
 * Component rows never produce a cycle of any kind: components are never
 * introduced (Tom, 2026-08-06). They reach the learner only as visual tiles
 * via `lego.components` on the intro and debut cards.
 */
export function buildLegoCycles(
  lego: CourseLegoRow,
  phrases: CoursePhraseRow[],
  /** Earlier LEGOs due for review in this round, in Fibonacci-offset order.
   *  Empty (the default) reproduces the pre-2026-08-09 shape — which is also
   *  the correct answer for the opening rounds of a course, where nothing has
   *  yet come due. */
  reviews: ReviewLego[] = []
): Cycle[] {
  const out: Cycle[] = []
  const legoId = lego.lego_id
  const seed = lego.seed_number
  const isNew = lego.is_new !== false

  const legoTargets = pickTargets(lego)
  const components =
    Array.isArray(lego.components) && lego.components.length > 0
      ? lego.components.map((c) => ({ known: c?.known ?? '', target: c?.target ?? '' }))
      : undefined

  // INTRO — the "reveal" cycle. The prompt is the presentation narration
  // ("The Italian for: 'to speak', as in — 'I want to speak Italian', is:")
  // followed by the two target voices.
  //
  // `known_id` is carried as a FALLBACK, not as a second clip. The client
  // (`backendCyclesToRounds.toPlayerCycle`) resolves the prompt as
  // `presentation_id || known_id`; until 2026-08-04 this endpoint omitted
  // known_id from intro cycles, so that fallback could never fire and a LEGO
  // with no presentation audio produced an EMPTY prompt URL — SimplePlayer
  // silently skipped the prompt phase and the learner got no intro at all.
  // The legacy script path had a live equivalent (`presentationAudioId ||
  // known_audio_id`), which is why the same data gap only degraded there.
  // Presentation still wins whenever it exists; this only changes what
  // happens when it doesn't.
  out.push({
    id: `${legoId}_intro`,
    type: 'intro',
    lego_id: legoId,
    seed_number: seed,
    known_text: lego.known_text ?? '',
    target_text: legoTargets.target_text,
    ...(legoTargets.target_text_native !== undefined
      ? { target_text_native: legoTargets.target_text_native }
      : {}),
    ...(components ? { components } : {}),
    audio: buildAudio({
      knownAudioId: lego.known_audio_id,
      target1AudioId: lego.target1_audio_id,
      target2AudioId: lego.target2_audio_id,
      presentationAudioId: lego.presentation_audio_id,
    }),
    durations: buildDurations(lego.target1_duration_ms, lego.target2_duration_ms),
    is_new: isNew,
  })

  // NO COMPONENT INTROS. Between 2026-08-04 and 2026-08-06 this is where
  // `buildComponentIntroCycles` inserted one `component_intro` per component,
  // narrating each tiling piece as its own introduction. Tom's ruling of
  // 2026-08-06 — "Components do NOT get introduced" — removed it. The
  // M-LEGO's own intro already names its pieces inline; that IS the LEGO's
  // introduction. A per-component introduction is the bug.

  // DEBUT — the standard 4-phase cycle on the LEGO itself.
  out.push({
    id: `${legoId}_debut`,
    type: 'debut',
    lego_id: legoId,
    seed_number: seed,
    known_text: lego.known_text ?? '',
    target_text: legoTargets.target_text,
    ...(legoTargets.target_text_native !== undefined
      ? { target_text_native: legoTargets.target_text_native }
      : {}),
    ...(components ? { components } : {}),
    audio: buildAudio({
      knownAudioId: lego.known_audio_id,
      target1AudioId: lego.target1_audio_id,
      target2AudioId: lego.target2_audio_id,
    }),
    durations: buildDurations(lego.target1_duration_ms, lego.target2_duration_ms),
    is_new: isNew,
  })

  // BUILDs then USEs. Split by phrase_role, preserving the position order
  // already applied at query time. We deliberately do NOT collapse 'practice'
  // (legacy) to 'build' here — the dashboard renamed practice -> build in
  // Feb 2026 and any straggler 'practice' rows belong to old courses; treat
  // them as builds for cycle-type purposes.
  const builds = phrases.filter(
    (p) => p.phrase_role === 'build' || p.phrase_role === 'practice'
  )
  const uses = phrases.filter((p) => p.phrase_role === 'use')

  // A phrase plays at most once per round, whichever phase reaches it first —
  // the walk's `usedPhrasesThisRound`. Without it a LEGO whose BUILD and USE
  // baskets overlap drills the same sentence twice in one round.
  const usedThisRound = new Set<string>()
  const claim = (p: CoursePhraseRow): boolean => {
    const id = phraseId(p.known_text, p.target_text)
    if (usedThisRound.has(id)) return false
    usedThisRound.add(id)
    return true
  }

  // BUILD ×≤7. BUILD rows first; then USE rows fill any slots left over —
  // "BUILD priority > CONSOLIDATE… filling 7 BUILD is non-negotiable" (the
  // walk's phase 3). A USE row promoted into a build slot is emitted as a
  // `build` cycle, exactly as the walk types it.
  let buildIdx = 0
  for (const p of builds) {
    if (buildIdx >= MAX_BUILD_PHRASES) break
    if (!claim(p)) continue
    buildIdx++
    out.push(phraseToCycle(p, legoId, seed, 'build', buildIdx))
  }
  for (const p of uses) {
    if (buildIdx >= MAX_BUILD_PHRASES) break
    if (!claim(p)) continue
    buildIdx++
    out.push(phraseToCycle(p, legoId, seed, 'build', buildIdx))
  }

  // SPACED REP ×≤12. `reviews` arrives in Fibonacci-offset order; N-1 draws
  // three phrases, every later offset one, and the round stops at the cap.
  // Reviews are always USE phrases of EARLIER LEGOs — components never enter
  // spaced repetition, and the handler only ever puts `phrase_role = 'use'`
  // rows in these baskets.
  let repCount = 0
  for (const review of reviews) {
    if (repCount >= MAX_SPACED_REP_PHRASES) break
    // Second gate on the same rule the handler applies when it fills these
    // baskets. It is cheap, and "a component reached spaced repetition" is
    // the kind of defect that is invisible until a learner hears a bare
    // particle drilled as a sentence.
    const pool = review.usePhrases.filter((p) => p.phrase_role === 'use')
    if (pool.length === 0) continue
    const want = review.offsetIndex === 0 ? N1_PHRASE_COUNT : 1
    const take = Math.min(want, MAX_SPACED_REP_PHRASES - repCount, pool.length)
    let cursor = reviewCursor(review.offsetIndex, pool.length)
    for (let i = 0; i < take; i++) {
      const p = pool[cursor % pool.length]
      // Advance the cursor even when the phrase is then skipped — the walk
      // increments `state.useIndex` before its de-dup check, and rotation has
      // to stay in step with it.
      cursor++
      if (!claim(p)) continue
      repCount++
      out.push(reviewToCycle(p, review, legoId, repCount))
    }
  }

  // CONSOLIDATE ×≤2 — this LEGO's own USE phrases, last in the round. First
  // pass takes phrases the round hasn't used; if the basket was too small for
  // that, the second pass allows reuse rather than leaving the round short.
  let useIdx = 0
  for (const p of uses) {
    if (useIdx >= USE_CONSOLIDATION_COUNT) break
    if (!claim(p)) continue
    useIdx++
    out.push(phraseToCycle(p, legoId, seed, 'use', useIdx))
  }
  if (useIdx < USE_CONSOLIDATION_COUNT) {
    for (const p of uses) {
      if (useIdx >= USE_CONSOLIDATION_COUNT) break
      useIdx++
      out.push(phraseToCycle(p, legoId, seed, 'use', useIdx))
    }
  }

  return out
}

/**
 * Convert one USE phrase of an EARLIER LEGO into a spaced-review cycle.
 *
 * `lego_id` names the LEGO being reviewed (what the walk puts in `legoKey`),
 * while `round_lego_id` names the round this cycle plays in. The client keys
 * its cycle buffer on `round_lego_id ?? lego_id`, so a review lands in the
 * round that scheduled it rather than back in the round that introduced it.
 */
function reviewToCycle(
  p: CoursePhraseRow,
  review: ReviewLego,
  roundLegoId: string,
  ordinal: number
): Cycle {
  const cycle = phraseToCycle(p, review.legoId, review.seedNumber, 'spaced_rep', ordinal)
  cycle.round_lego_id = roundLegoId
  cycle.fib_position = review.offsetIndex
  cycle.review_of = review.reviewOf
  return cycle
}

/**
 * Convert one practice-phrase row to a cycle.
 */
function phraseToCycle(
  p: CoursePhraseRow,
  legoId: string,
  seed: number,
  cycleType: 'build' | 'use' | 'spaced_rep',
  ordinal: number
): Cycle {
  const targets = pickTargets(p)
  const cycle: Cycle = {
    id: `${legoId}_${cycleType}_${ordinal}`,
    type: cycleType,
    lego_id: legoId,
    seed_number: seed,
    known_text: p.known_text ?? '',
    target_text: targets.target_text,
    ...(targets.target_text_native !== undefined
      ? { target_text_native: targets.target_text_native }
      : {}),
    audio: buildAudio({
      knownAudioId: p.known_audio_id,
      target1AudioId: p.target1_audio_id,
      target2AudioId: p.target2_audio_id,
    }),
    durations: buildDurations(p.target1_duration_ms, p.target2_duration_ms),
    // Practice phrases are not themselves "new" in the sense the intro cycle
    // uses — they exercise an already-introduced LEGO. is_new=false here is
    // the right default; the LEGO's is_new lives on the intro/debut cycles.
    is_new: false,
  }

  // decomposition is optional — omit when NULL (per spec).
  if (Array.isArray(p.decomposition) && p.decomposition.length > 0) {
    cycle.decomposition = p.decomposition
  }

  // Authored display tiles — same omit-when-NULL convention.
  if (Array.isArray(p.display_tiling) && p.display_tiling.length > 0) {
    cycle.display_tiling = p.display_tiling
  }

  return cycle
}
