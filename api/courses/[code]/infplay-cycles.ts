/**
 * INF PLAY Cycles API — GET /api/courses/:code/infplay-cycles?from_round=:n&limit=:m
 *
 * Returns the next `m` rounds' worth of infinite-play cycles starting
 * at INF PLAY round `n` (1-based within infplay; round 1 = the first
 * round past the main loop).
 *
 * Mirrors /api/courses/:code/cycles for the main loop. Same cycle shape,
 * same caching semantics, but the content is INF PLAY review:
 *
 *   - Spaced rep against fib offsets (1, 1, 2, 3, 5, 8, 13, 21, 34, 55,
 *     89) into the MAIN LOOP. A LEGO introduced at main-loop round X is
 *     reviewed in infplay round Y when (mainLoopCount + Y) - X matches
 *     a fib offset. Rounds 1-89 of INF PLAY have decaying spaced rep;
 *     rounds 90+ are pure random USE.
 *
 *   - Random USE: ~6 LEGOs sampled uniformly from the whole course per
 *     round, dedup'd against this round's spaced-rep picks.
 *
 * Stateless: no per-learner state tracked. Spaced rep is computed from
 * the course's static LEGO order; random USE is fresh-sampled per
 * request. Subsequent requests with the SAME from_round may return
 * DIFFERENT cycles (different random sample) — that's expected for INF
 * PLAY where variety > determinism.
 *
 * Tom's design 2026-05-20: "INF PLAY entry as fast as main-loop entry".
 * Previous JS-side generateScript was 5-15s on cold cache; this endpoint
 * is ~150-300ms because the LEGO + phrase queries are tiny and the
 * sampling is in-memory.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

const COURSE_CODE_RE = /^[a-z0-9_]+$/
const DEFAULT_LIMIT = 5   // ~5 rounds × ~20 cycles ≈ 100 cycles
const MAX_LIMIT = 15
// Spaced rep at fib offsets — matches the main-loop schedule.
// Drains naturally over 89 INF PLAY rounds: each round drops the
// offsets that reach past course-end. By infplay round 90, all
// offsets are past the main-loop and the round is pure random USE.
const SPACED_REP_OFFSETS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]
// N-1 gets 3 phrases (per main-loop n1PhraseCount=3), others get 1.
const N1_PHRASE_COUNT = 3
// Target a constant round length regardless of how much spaced rep
// is left in the drain. Tom 2026-05-20: "we have MORE RND USE per
// round to keep cycles = 22 — it then keeps ROUND length approx the
// same for inserting encouragements, listening exercises and so on".
// Peak (infplay round 1): ~12 spaced rep + 10 USE = 22.
// Drained (round 90+): 0 spaced rep + 22 USE = 22.
const TARGET_CYCLES_PER_ROUND = 22
const MIN_RANDOM_USE_PER_ROUND = 6
const MAX_RANDOM_USE_PER_ROUND = TARGET_CYCLES_PER_ROUND

interface LegoRow {
  seed_number: number
  lego_index: number
  lego_id: string
  known_text: string | null
  target_text: string | null
  target_text_roman: string | null
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
  target1_duration_ms: number | null
  target2_duration_ms: number | null
}

interface PhraseRow {
  seed_number: number
  lego_index: number
  position: number | null
  phrase_role: string | null
  known_text: string | null
  target_text: string | null
  target_text_roman: string | null
  known_audio_id: string | null
  target1_audio_id: string | null
  target2_audio_id: string | null
  target1_duration_ms: number | null
  target2_duration_ms: number | null
  decomposition: DecompositionBlock[] | null
  display_tiling: DisplayTile[] | null
}

// Authored display tiles ({n: native, r: roman, salient}), built and
// validated in Popty. Served verbatim; the player renders them directly
// (native primary, roman ruby) instead of running the device segmenter.
interface DisplayTile {
  n: string
  r: string
  salient?: boolean
}

// Authoritative content-level tiling, computed in Popty and stored on
// course_practice_phrases.decomposition. Served verbatim so the player renders
// it directly instead of re-deriving by runtime string-alignment.
interface DecompositionBlock {
  legoId: string | null
  target: string
  known: string
  isGhost: boolean
  isSalient?: boolean
}

interface Cycle {
  id: string
  type: 'use' | 'spaced_rep'
  lego_id: string
  seed_number: number
  known_text: string
  target_text: string
  target_text_native?: string
  audio: {
    known_id?: string
    target1_id?: string
    target2_id?: string
  }
  durations: {
    target1_ms?: number
    target2_ms?: number
  }
  is_new: false
  inf_round: number       // 1-based within INF PLAY
  decomposition?: DecompositionBlock[]
  display_tiling?: DisplayTile[]
}

function buildLegoId(seed: number, lego: number): string {
  return `S${String(seed).padStart(4, '0')}L${String(lego).padStart(2, '0')}`
}

/**
 * Partial Fisher-Yates: returns n distinct elements from arr.
 * O(min(n, arr.length)).
 */
function sampleN<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return [...arr]
  const a = [...arr]
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a.slice(0, n)
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
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

  let fromRound = 1
  if (typeof req.query.from_round === 'string') {
    const n = parseInt(req.query.from_round, 10)
    if (!Number.isNaN(n) && n >= 1) fromRound = n
  }
  let limit = DEFAULT_LIMIT
  if (typeof req.query.limit === 'string') {
    const n = parseInt(req.query.limit, 10)
    if (!Number.isNaN(n) && n > 0) limit = Math.min(n, MAX_LIMIT)
  }

  try {
    const supabase = createClient(
      supabaseUrl!,
      supabaseServiceKey || (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim(),
    )

    // Fetch course's main-loop LEGOs + USE phrases in parallel.
    // Both are bounded by course size (~600 LEGOs, ~5000 phrases) — fits
    // comfortably in a single Postgres round-trip each.
    const [legosResult, phrasesResult, courseResult] = await Promise.all([
      supabase
        .from('course_legos')
        .select('seed_number, lego_index, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id, target1_duration_ms, target2_duration_ms')
        .eq('course_code', code)
        .eq('is_new', true)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })
        .limit(5000),
      supabase
        .from('course_practice_phrases')
        .select('seed_number, lego_index, position, phrase_role, known_text, target_text, target_text_roman, known_audio_id, target1_audio_id, target2_audio_id, target1_duration_ms, target2_duration_ms, decomposition, display_tiling')
        .eq('course_code', code)
        .in('phrase_role', ['use', 'eternal_eligible'])
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })
        .order('position', { ascending: true })
        .limit(10000),
      supabase
        .from('courses')
        .select('content_version')
        .eq('course_code', code)
        .single(),
    ])

    if (legosResult.error) {
      console.error('[InfPlayCycles] legos query failed:', legosResult.error.message)
      res.status(500).json({ error: 'Failed to load course LEGOs' })
      return
    }
    if (phrasesResult.error) {
      console.error('[InfPlayCycles] phrases query failed:', phrasesResult.error.message)
      res.status(500).json({ error: 'Failed to load course phrases' })
      return
    }
    if (courseResult.error || !courseResult.data) {
      res.status(404).json({ error: 'Course not found' })
      return
    }

    const legoRows: LegoRow[] = (legosResult.data || []).map((r: any) => ({
      seed_number: r.seed_number,
      lego_index: r.lego_index,
      lego_id: buildLegoId(r.seed_number, r.lego_index),
      known_text: r.known_text,
      target_text: r.target_text,
      target_text_roman: r.target_text_roman,
      known_audio_id: r.known_audio_id,
      target1_audio_id: r.target1_audio_id,
      target2_audio_id: r.target2_audio_id,
      target1_duration_ms: r.target1_duration_ms,
      target2_duration_ms: r.target2_duration_ms,
    }))
    const phraseRows: PhraseRow[] = (phrasesResult.data || []) as PhraseRow[]
    const mainLoopCount = legoRows.length
    const version = (courseResult.data as any).content_version ?? 1

    if (mainLoopCount === 0) {
      res.status(404).json({ error: `Course ${code} has no main-loop LEGOs` })
      return
    }

    // Index phrases by LEGO key — round-robin draws from each LEGO's
    // USE phrases.
    const phrasesByLego = new Map<string, PhraseRow[]>()
    for (const p of phraseRows) {
      const key = buildLegoId(p.seed_number, p.lego_index)
      const list = phrasesByLego.get(key)
      if (list) list.push(p)
      else phrasesByLego.set(key, [p])
    }

    // Build cycles for each requested infplay round.
    const cycles: Cycle[] = []
    let cycleSeq = 0
    const usedLegosThisRound = new Set<string>()  // dedup within a round

    for (let r = 0; r < limit; r++) {
      const infRound = fromRound + r
      const absoluteRound = mainLoopCount + infRound
      usedLegosThisRound.clear()

      // Phase 1: Spaced rep. For each fib offset, find the LEGO at
      // (absoluteRound - offset - 1) in legoRows (0-indexed). Stops
      // contributing when absoluteRound - offset overshoots either
      // end of the main loop (< 1 or > mainLoopCount).
      //
      // phraseCount = 3 for N-1 (per the main-loop schedule's
      // n1PhraseCount), 1 for all other offsets. Three phrases for
      // the same N-1 LEGO are drawn round-robin from its USE pool.
      const spacedRepEntries: { lego: LegoRow; offset: number; phraseCount: number }[] = []
      for (const offset of SPACED_REP_OFFSETS) {
        const reviewRound = absoluteRound - offset
        if (reviewRound < 1) continue
        const lego = legoRows[reviewRound - 1]  // 0-indexed
        if (!lego) continue
        if (usedLegosThisRound.has(lego.lego_id)) continue
        usedLegosThisRound.add(lego.lego_id)
        spacedRepEntries.push({
          lego,
          offset,
          phraseCount: offset === 1 ? N1_PHRASE_COUNT : 1,
        })
      }

      // Phase 2: Random USE — uniform sample over all main-loop LEGOs,
      // dedup'd against this round's spaced rep set. Count scales to
      // hit TARGET_CYCLES_PER_ROUND. Early rounds have lots of spaced
      // rep → fewer USE needed; rounds past 89 have zero spaced rep
      // → USE fills the whole round.
      const projectedSpacedRepCount = spacedRepEntries.reduce(
        (sum, e) => sum + e.phraseCount, 0,
      )
      const targetRandomUse = Math.max(
        MIN_RANDOM_USE_PER_ROUND,
        Math.min(MAX_RANDOM_USE_PER_ROUND, TARGET_CYCLES_PER_ROUND - projectedSpacedRepCount),
      )
      const availableForUse = legoRows.filter(l => !usedLegosThisRound.has(l.lego_id))
      const randomUseLegos = sampleN(availableForUse, targetRandomUse)
      for (const l of randomUseLegos) usedLegosThisRound.add(l.lego_id)

      // Emit spaced rep first (per the JS generator's order).
      // For each entry, draw phraseCount distinct phrases from the
      // LEGO's USE pool (Fisher-Yates partial shuffle) — N-1's 3
      // phrases should be different ones, not the same phrase three
      // times.
      for (const { lego, offset, phraseCount } of spacedRepEntries) {
        const phrases = phrasesByLego.get(lego.lego_id)
        if (!phrases || phrases.length === 0) continue
        const drawn = sampleN(phrases, Math.min(phraseCount, phrases.length))
        for (const phrase of drawn) {
          if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
          cycleSeq++
          cycles.push({
            id: `${lego.lego_id}_infsr_R${infRound}_${cycleSeq}`,
            type: 'spaced_rep',
            lego_id: lego.lego_id,
            seed_number: lego.seed_number,
            known_text: phrase.known_text || '',
            target_text: phrase.target_text_roman || phrase.target_text || '',
            ...(phrase.target_text_roman && phrase.target_text ? { target_text_native: phrase.target_text } : {}),
            audio: {
              known_id: phrase.known_audio_id,
              target1_id: phrase.target1_audio_id,
              target2_id: phrase.target2_audio_id,
            },
            durations: {
              ...(phrase.target1_duration_ms ? { target1_ms: phrase.target1_duration_ms } : {}),
              ...(phrase.target2_duration_ms ? { target2_ms: phrase.target2_duration_ms } : {}),
            },
            is_new: false,
            inf_round: infRound,
            // Authoritative tiling, served verbatim when present (null → player
            // falls back to runtime alignment). Closes the INFPLAY serving gap.
            ...(Array.isArray(phrase.decomposition) && phrase.decomposition.length > 0
              ? { decomposition: phrase.decomposition }
              : {}),
            ...(Array.isArray(phrase.display_tiling) && phrase.display_tiling.length > 0
              ? { display_tiling: phrase.display_tiling }
              : {}),
          })
        }
      }

      // Then random USE
      for (const lego of randomUseLegos) {
        const phrases = phrasesByLego.get(lego.lego_id)
        if (!phrases || phrases.length === 0) continue
        const phrase = phrases[Math.floor(Math.random() * phrases.length)]
        if (!phrase.known_audio_id || !phrase.target1_audio_id || !phrase.target2_audio_id) continue
        cycleSeq++
        cycles.push({
          id: `${lego.lego_id}_infuse_R${infRound}_${cycleSeq}`,
          type: 'use',
          lego_id: lego.lego_id,
          seed_number: lego.seed_number,
          known_text: phrase.known_text || '',
          target_text: phrase.target_text_roman || phrase.target_text || '',
          ...(phrase.target_text_roman && phrase.target_text ? { target_text_native: phrase.target_text } : {}),
          audio: {
            known_id: phrase.known_audio_id,
            target1_id: phrase.target1_audio_id,
            target2_id: phrase.target2_audio_id,
          },
          durations: {
            ...(phrase.target1_duration_ms ? { target1_ms: phrase.target1_duration_ms } : {}),
            ...(phrase.target2_duration_ms ? { target2_ms: phrase.target2_duration_ms } : {}),
          },
          is_new: false,
          inf_round: infRound,
          // Authoritative tiling, served verbatim when present (null → player
          // falls back to runtime alignment). Closes the INFPLAY serving gap.
          ...(Array.isArray(phrase.decomposition) && phrase.decomposition.length > 0
            ? { decomposition: phrase.decomposition }
            : {}),
          ...(Array.isArray(phrase.display_tiling) && phrase.display_tiling.length > 0
            ? { display_tiling: phrase.display_tiling }
            : {}),
        })
      }
    }

    res.setHeader('Cache-Control', 'private, max-age=0, no-cache')
    res.status(200).json({
      course_code: code,
      version,
      cycles,
      next_inf_round: fromRound + limit,
      main_loop_count: mainLoopCount,
    })
  } catch (err) {
    console.error('[InfPlayCycles] Unexpected error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
}
