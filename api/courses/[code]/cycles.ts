/**
 * Cycles API — GET /api/courses/:code/cycles?from=:legoId&limit=:n
 *
 * Instant-playback critical path. Returns the next `n` fully-assembled
 * cycles starting from the LEGO matching `:from`, in script order
 * (intro -> debut -> BUILDs -> USEs per LEGO, then next LEGO).
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
 *  - Cross-LEGO spaced-rep is NOT included here; the frontend constructs
 *    those from the round-map and re-fetches the same per-LEGO data
 *    (cheap, cached). Keeping cycles per-LEGO is the simpler/cheaper split.
 *
 * Cache-Control: private, max-age=60 — frontend may re-fetch cheaply,
 * other learners aren't sharing this (per-session walk).
 *
 * See: ssi-dashboard-v7-clean/new_vision/INSTANT_PLAYBACK_SPEC.md
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

const COURSE_CODE_RE = /^[a-z0-9_]+$/
const LEGO_ID_RE = /^S\d{4}L\d{2}$/

const DEFAULT_LIMIT = 15
const MAX_LIMIT = 50

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
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
  target1_duration_ms: number | null
  target2_duration_ms: number | null
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

  // `resume=true` flags this as a returning-learner bootstrap, not a fresh
  // start. When set, we skip the FIRST LEGO's intro + debut cycles —
  // those are "first encounter" pedagogy that's confusing/misleading
  // when the learner has already mastered the LEGO. Subsequent LEGOs in
  // the response keep their intros (they ARE new to the learner).
  const resume = req.query.resume === 'true'

  try {
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey ||
        (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim()
    )

    // Single Postgres call: everything we need (course version, round window,
    // legos for that window, phrases for that window's seeds) in one network
    // round-trip. See migration 20260518_course_cycles_window_fn.sql for the
    // function definition.
    const ROUND_FETCH = Math.min(limit + 2, MAX_LIMIT + 2)
    const { data, error } = await supabase.rpc('get_course_cycles_window', {
      p_course_code: code,
      p_from_lego_id: from,
      p_round_limit: ROUND_FETCH,
    })

    if (error) {
      console.error('[Cycles] rpc error:', error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load cycles window' })
      return
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
    const rounds = payload.rounds
    const legoRows = payload.legos || []
    const phraseRows = payload.phrases || []

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

    // 5. Assemble cycles. Walk LEGOs in round order, emit intro/debut/builds/uses
    //    until we hit `limit` cycles. Track `nextLegoId` = first LEGO we did NOT
    //    fully exhaust (or the next one beyond the last fully-emitted LEGO).
    const cycles: Cycle[] = []
    let nextLegoId: string | null = null

    outer: for (let i = 0; i < rounds.length; i++) {
      const r = rounds[i]
      const legoKey = `${r.seed_number}:${r.lego_index}`
      const lego = legoByKey.get(legoKey)
      if (!lego) {
        // Round-map references a LEGO not present in course_legos — schema
        // drift or partial-import course. Skip silently rather than fail
        // the whole request; player will gap-fill.
        continue
      }

      const allLegoCycles = buildLegoCycles(lego, phrasesByKey.get(legoKey) || [])

      // Resume bootstrap: the FIRST LEGO is one the learner already met,
      // so drop its intro + debut. Subsequent LEGOs (i > 0) keep theirs
      // — they're genuinely new to the learner.
      const legoCycles = (resume && i === 0)
        ? allLegoCycles.filter((c) => c.type !== 'intro' && c.type !== 'debut')
        : allLegoCycles

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

    res.setHeader('Cache-Control', 'private, max-age=60')
    res.status(200).json({
      course_code: code,
      version,
      cycles,
      next_lego_id: nextLegoId,
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
 */
function buildLegoCycles(lego: CourseLegoRow, phrases: CoursePhraseRow[]): Cycle[] {
  const out: Cycle[] = []
  const legoId = lego.lego_id
  const seed = lego.seed_number
  const isNew = lego.is_new !== false

  const legoTargets = pickTargets(lego)
  const components =
    Array.isArray(lego.components) && lego.components.length > 0
      ? lego.components.map((c) => ({ known: c?.known ?? '', target: c?.target ?? '' }))
      : undefined

  // INTRO — the "reveal" cycle. Uses presentation audio (the narration:
  // "The X for Y is...") with the two target voices following. No `known`
  // audio because the prompt is the presentation itself.
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
      target1AudioId: lego.target1_audio_id,
      target2AudioId: lego.target2_audio_id,
      presentationAudioId: lego.presentation_audio_id,
    }),
    durations: buildDurations(lego.target1_duration_ms, lego.target2_duration_ms),
    is_new: isNew,
  })

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

  let buildIdx = 0
  for (const p of builds) {
    buildIdx++
    out.push(phraseToCycle(p, legoId, seed, 'build', buildIdx))
  }
  let useIdx = 0
  for (const p of uses) {
    useIdx++
    out.push(phraseToCycle(p, legoId, seed, 'use', useIdx))
  }

  return out
}

/**
 * Convert one practice-phrase row to a cycle.
 */
function phraseToCycle(
  p: CoursePhraseRow,
  legoId: string,
  seed: number,
  cycleType: 'build' | 'use',
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

  return cycle
}
