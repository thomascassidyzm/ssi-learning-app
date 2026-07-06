/**
 * Course Bundle API — GET /api/courses/:code/bundle
 *
 * One-shot, versioned payload containing EVERY LEGO and EVERY phrase in
 * the course, with every audio reference classified as `ephemeral` or
 * `persistent`. The single source of truth for client-side script
 * generation, audio prefetching, and the background bundle downloader.
 *
 * Replaces the JIT model where the backend assembled cycles per
 * request (/cycles and /infplay-cycles). The backend now just ships
 * the raw structure once; the client owns assembly, sampling and
 * caching.
 *
 * Wire format: see `packages/player-vue/src/types/courseBundle.ts`.
 *
 * Query strategy — 4 parallel Supabase queries, no migrations:
 *   - `courses`                (content_version + 404 probe)
 *   - `course_legos`           (is_new = true, ordered)
 *   - `course_practice_phrases` (build/use, including legacy roles)
 *   - `course_round_index`     (main-loop ordering)
 *
 * Returns 503 if course_round_index is empty for an existing course
 * (the materialised view hasn't been refreshed yet — operator action
 * required), so a misconfigured course doesn't silently ship an
 * unplayable bundle to the client.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import type {
  CourseBundle,
  BundleLego,
  BundlePhrase,
  BundleSeed,
  BundleRoundMapEntry,
  BundleAudioRef,
  BundlePod,
  BundlePodSentence,
  AudioLifecycle,
  PhraseRole,
} from '../../../packages/player-vue/src/types/courseBundle'
import { resolveServerCourseAccess } from '../../_utils/courseAccess'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL environment variable')
}

const COURSE_CODE_RE = /^[a-z0-9_]+$/

interface CourseRow {
  content_version: number | null
  target_lang: string | null
  pricing_tier: string | null
  is_community: boolean | null
}

interface LegoRow {
  seed_number: number
  lego_index: number
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
  // NOTE: course_legos table does NOT have known_duration_ms or
  // presentation_duration_ms columns — only target1/target2 durations
  // exist (per 20260202110000_direct_audio_ids.sql). The cycle views
  // synthesise the known/presentation durations from course_audio via
  // JOIN, but we query the tables directly. BundleAudioRef.durationMs
  // is already optional in the contract, so omitting these is fine.
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
  // NOTE: course_practice_phrases table does NOT have known_duration_ms.
  // See LegoRow note above.
  // Authoritative content-level tiling (added by the dashboard-repo migration,
  // now live in all environments — cycles.ts/infplay-cycles.ts both select it).
  decomposition: Array<{
    legoId: string | null
    target: string
    known: string
    isGhost: boolean
    isSalient?: boolean
  }> | null
  // Authored display tiles ({n: native, r: roman, salient}) built and
  // validated in Popty — served verbatim; player renders them directly.
  display_tiling: Array<{ n: string; r: string; salient?: boolean }> | null
}

interface RoundIndexRow {
  round_index: number
  seed_number: number
  // course_round_index materialised view exposes lego_id (string like
  // "S0042L01"), NOT lego_index. See round-map.ts which uses lego_id
  // directly. We carry it through and slice the index out where needed.
  lego_id: string
}

interface PodRow {
  id: string
  pod_order: number
  title: string | null
  intro_audio_id: string | null
  outro_audio_id: string | null
}

interface PodSentenceRow {
  pod_id: string
  global_order: number
  target_text: string | null
  known_text: string | null
  target_audio_id: string | null
  known_audio_id: string | null
  /** Tom-voiced bilingual chunk-by-chunk explainer audio. Optional — only
   *  populated for sentences Popty's pod-explainer pipeline has rendered. */
  explainer_audio_id: string | null
  glue_to_next: boolean | null
}

interface CourseAudioRow {
  id: string
  duration_ms: number | null
}

/** Build a LEGO id of the form "S0042L01". Same helper as infplay-cycles.ts. */
function buildLegoId(seed: number, lego: number): string {
  return `S${String(seed).padStart(4, '0')}L${String(lego).padStart(2, '0')}`
}

/** Build a Seed id of the form "S0042". */
function buildSeedId(seed: number): string {
  return `S${String(seed).padStart(4, '0')}`
}

/**
 * Pick display target text. Mirrors `pickTargets()` in cycles.ts:
 * when target_text_roman is non-empty, that's the display text and
 * the native script becomes targetTextNative.
 */
function pickTargets(row: {
  target_text: string | null
  target_text_roman: string | null
}): { targetText: string; targetTextNative?: string } {
  if (row.target_text_roman && row.target_text_roman.trim()) {
    return {
      targetText: row.target_text_roman,
      targetTextNative: row.target_text ?? '',
    }
  }
  return { targetText: row.target_text ?? '' }
}

/**
 * Build an audio ref. Returns undefined when id is null/empty so the
 * caller omits the key entirely — we never emit `{ id: null }`.
 */
function buildAudioRef(
  id: string | null | undefined,
  lifecycle: AudioLifecycle,
  durationMs: number | null | undefined,
): BundleAudioRef | undefined {
  if (!id) return undefined
  const ref: BundleAudioRef = { id, lifecycle }
  if (typeof durationMs === 'number') ref.durationMs = durationMs
  return ref
}

/** Normalise legacy `practice` / `eternal_eligible` roles to the wire roles. */
function normaliseRole(raw: string | null | undefined): PhraseRole | null {
  if (raw === 'build' || raw === 'practice') return 'build'
  if (raw === 'use' || raw === 'eternal_eligible') return 'use'
  return null
}

const BUNDLE_PHRASE_ROLES = ['build', 'use', 'practice', 'eternal_eligible']
const BUNDLE_PHRASE_COLUMNS =
  'seed_number, lego_index, position, phrase_role, known_text, target_text, target_text_roman, ' +
  'known_audio_id, target1_audio_id, target2_audio_id, ' +
  'target1_duration_ms, target2_duration_ms, decomposition, display_tiling'

// course_practice_phrases carries 15-17k rows on big courses. A single
// unpaginated read is silently capped at PostgREST's default page (~1000),
// which dropped the back ~90% of the course from the OFFLINE bundle. Count
// first, then fetch every 1000-row page in parallel (PAGE well under the
// server max-rows so each slice is complete). Mirrors fetchAllPracticePhrases
// in providers/generateLearningScript.ts.
async function fetchAllBundlePhrases(
  supabase: any,
  code: string,
): Promise<{ data: any[] | null; error: any }> {
  const PAGE = 1000
  const { count, error: countErr } = await supabase
    .from('course_practice_phrases')
    .select('*', { count: 'exact', head: true })
    .eq('course_code', code)
    .in('phrase_role', BUNDLE_PHRASE_ROLES)
  if (countErr) return { data: null, error: countErr }
  const total = count ?? 0
  if (total === 0) return { data: [], error: null }
  const pageCount = Math.ceil(total / PAGE)
  const pages = await Promise.all(
    Array.from({ length: pageCount }, (_, i) =>
      supabase
        .from('course_practice_phrases')
        .select(BUNDLE_PHRASE_COLUMNS)
        .eq('course_code', code)
        .in('phrase_role', BUNDLE_PHRASE_ROLES)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true })
        .order('position', { ascending: true })
        .range(i * PAGE, i * PAGE + PAGE - 1),
    ),
  )
  const all: any[] = []
  for (const p of pages) {
    if (p.error) return { data: null, error: p.error }
    if (p.data) all.push(...p.data)
  }
  return { data: all, error: null }
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

  try {
    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey ||
        (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim(),
    )

    // 6 queries in parallel. Each Vercel→Supabase round-trip is ~100-150ms
    // of physics; collapsing into Promise.all keeps the whole bundle
    // assemble at ~150-300ms instead of 6× that.
    const [courseRes, legosRes, phrasesRes, roundsRes, podsRes, bookendsRes] = await Promise.all([
      supabase
        .from('courses')
        .select('content_version, target_lang, pricing_tier, is_community')
        .eq('course_code', code)
        .maybeSingle(),
      supabase
        .from('course_legos')
        .select(
          'seed_number, lego_index, type, known_text, target_text, target_text_roman, components, is_new, ' +
            'known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id, ' +
            'target1_duration_ms, target2_duration_ms',
        )
        .eq('course_code', code)
        .eq('is_new', true)
        .order('seed_number', { ascending: true })
        .order('lego_index', { ascending: true }),
      // Paginated: course_practice_phrases can exceed the server page cap on
      // big courses, so a single read silently truncated the offline bundle.
      fetchAllBundlePhrases(supabase, code),
      supabase
        .from('course_round_index')
        .select('round_index, seed_number, lego_id')
        .eq('course_code', code)
        .order('round_index', { ascending: true }),
      supabase
        .from('listening_pods')
        .select('id, pod_order, title')
        .eq('course_code', code)
        .order('pod_order', { ascending: true, nullsFirst: true }),
      // Bookends live in course_audio (role-based), not on listening_pods.
      // One pair per course today — shared across all that course's pods.
      // BundlePod inlines them per-pod so each pod entry is self-contained
      // for the downloader's priority walk; the seen-set in
      // iterateBundleAudio collapses the duplicates into a single download.
      supabase
        .from('course_audio')
        .select('id, role, duration_ms')
        .eq('course_code', code)
        .in('role', ['bookend_listen_intro', 'bookend_listen_outro']),
    ])

    if (courseRes.error) {
      console.error('[Bundle] courses query failed:', courseRes.error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load course' })
      return
    }
    if (!courseRes.data) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(404).json({ error: 'Course not found' })
      return
    }
    if (legosRes.error) {
      console.error('[Bundle] legos query failed:', legosRes.error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load course LEGOs' })
      return
    }
    if (phrasesRes.error) {
      console.error('[Bundle] phrases query failed:', phrasesRes.error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load course phrases' })
      return
    }
    if (roundsRes.error) {
      console.error('[Bundle] round-index query failed:', roundsRes.error.message)
      res.setHeader('Cache-Control', 'no-store')
      res.status(500).json({ error: 'Failed to load course round-index' })
      return
    }
    // Pods + bookends are non-fatal. A course can ship without Layer 2 yet
    // (no pods row → empty pods[]); a bookend miss just means the lap
    // plays without the intro/outro narration. Log and continue so we
    // never lose the rest of the bundle over pod content gaps.
    if (podsRes.error) {
      console.warn('[Bundle] listening_pods query failed (non-fatal):', podsRes.error.message)
    }
    if (bookendsRes.error) {
      console.warn('[Bundle] bookend audio query failed (non-fatal):', bookendsRes.error.message)
    }

    const legoRows: LegoRow[] = (legosRes.data || []) as unknown as LegoRow[]
    const phraseRows: PhraseRow[] = (phrasesRes.data || []) as unknown as PhraseRow[]
    const roundRows: RoundIndexRow[] = (roundsRes.data || []) as unknown as RoundIndexRow[]
    const courseRow = courseRes.data as unknown as CourseRow
    const version = (courseRow.content_version ?? 1)

    // Course exists but the materialised round-index is empty — operator
    // action needed (refresh the view). Surfacing as 503 lets clients
    // distinguish from a missing course (404).
    if (roundRows.length === 0) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(503).json({
        error: `Course ${code} has no round-index entries (run materialised-view refresh)`,
      })
      return
    }

    // --- Entitlement gate -----------------------------------------------------
    // Free/community courses skip auth entirely. Premium courses require a
    // valid Supabase Auth token + active subscription/entitlement for full
    // content; anonymous or unsubscribed callers get sliced down to the
    // free-preview window (through Yellow Belt) rather than the whole course.
    // This is the server-side authority — the client's checkCourseAccess is
    // UI-only and must never be trusted for what content actually ships.
    const access = await resolveServerCourseAccess(req, supabase, {
      course_code: code,
      pricing_tier: courseRow.pricing_tier,
      is_community: courseRow.is_community,
      target_lang: courseRow.target_lang,
    })
    const previewOnly = !access.canAccess
    if (previewOnly && !(access.canPreview && access.previewMaxSeed)) {
      res.setHeader('Cache-Control', 'no-store')
      res.status(403).json({ error: 'Subscription required', reason: access.reason })
      return
    }
    const previewMaxSeed = access.previewMaxSeed ?? 0

    const scopedLegoRows = previewOnly
      ? legoRows.filter((row) => row.seed_number <= previewMaxSeed)
      : legoRows
    const scopedPhraseRows = previewOnly
      ? phraseRows.filter((row) => row.seed_number <= previewMaxSeed)
      : phraseRows
    const scopedRoundRows = previewOnly
      ? roundRows.filter((row) => row.seed_number <= previewMaxSeed)
      : roundRows

    // --- LEGOs --------------------------------------------------------------
    const legos: BundleLego[] = scopedLegoRows.map((row) => {
      const legoId = buildLegoId(row.seed_number, row.lego_index)
      const seedId = buildSeedId(row.seed_number)
      const targets = pickTargets(row)
      const components =
        Array.isArray(row.components) && row.components.length > 0
          ? row.components.map((c) => ({ known: c?.known ?? '', target: c?.target ?? '' }))
          : undefined

      const ephemeralAudio: BundleLego['ephemeralAudio'] = {}
      // known + presentation durations aren't on course_legos (only
      // target1/target2 have duration columns there). Caller treats
      // BundleAudioRef.durationMs as optional.
      const known = buildAudioRef(row.known_audio_id, 'ephemeral', null)
      if (known) ephemeralAudio.known = known
      const target1 = buildAudioRef(row.target1_audio_id, 'ephemeral', row.target1_duration_ms)
      if (target1) ephemeralAudio.target1 = target1
      const target2 = buildAudioRef(row.target2_audio_id, 'ephemeral', row.target2_duration_ms)
      if (target2) ephemeralAudio.target2 = target2
      const presentation = buildAudioRef(row.presentation_audio_id, 'ephemeral', null)
      if (presentation) ephemeralAudio.presentation = presentation

      const lego: BundleLego = {
        legoId,
        seedNumber: row.seed_number,
        legoIndex: row.lego_index,
        seedId,
        type: row.type,
        knownText: row.known_text ?? '',
        targetText: targets.targetText,
        isNew: row.is_new !== false,
        ephemeralAudio,
      }
      if (targets.targetTextNative !== undefined) lego.targetTextNative = targets.targetTextNative
      if (components) lego.components = components
      return lego
    })

    // --- Phrases ------------------------------------------------------------
    // Synthetic position counter per (legoId, role) — preserves DB row
    // order. This is the spec'd id format: ${legoId}_${role}_${position}.
    const positionCounters = new Map<string, number>()
    const phrases: BundlePhrase[] = []
    for (const row of scopedPhraseRows) {
      const role = normaliseRole(row.phrase_role)
      if (!role) continue
      const legoId = buildLegoId(row.seed_number, row.lego_index)
      const key = `${legoId}:${role}`
      const nextPos = (positionCounters.get(key) ?? 0) + 1
      positionCounters.set(key, nextPos)

      const targets = pickTargets(row)
      const lifecycle: AudioLifecycle = role === 'use' ? 'persistent' : 'ephemeral'

      const audio: BundlePhrase['audio'] = {}
      // known duration isn't on course_practice_phrases (only target1/2).
      const known = buildAudioRef(row.known_audio_id, lifecycle, null)
      if (known) audio.known = known
      const target1 = buildAudioRef(row.target1_audio_id, lifecycle, row.target1_duration_ms)
      if (target1) audio.target1 = target1
      const target2 = buildAudioRef(row.target2_audio_id, lifecycle, row.target2_duration_ms)
      if (target2) audio.target2 = target2

      const phrase: BundlePhrase = {
        phraseId: `${legoId}_${role}_${String(nextPos).padStart(2, '0')}`,
        legoId,
        position: nextPos,
        role,
        knownText: row.known_text ?? '',
        targetText: targets.targetText,
        audio,
      }
      if (targets.targetTextNative !== undefined) phrase.targetTextNative = targets.targetTextNative
      // Authoritative tiling, served verbatim when present. Player renders it
      // directly (honours isSalient/isGhost); null → runtime alignment fallback.
      if (Array.isArray(row.decomposition) && row.decomposition.length > 0) {
        phrase.decomposition = row.decomposition
      }
      // Authored display tiles — same omit-when-NULL convention.
      if (Array.isArray(row.display_tiling) && row.display_tiling.length > 0) {
        phrase.displayTiling = row.display_tiling
      }
      phrases.push(phrase)
    }

    // --- Round map ----------------------------------------------------------
    const roundMap: BundleRoundMapEntry[] = scopedRoundRows.map((r) => ({
      roundIndex: r.round_index,
      legoId: r.lego_id,
      seedNumber: r.seed_number,
    }))

    // --- Seeds (derived from the round map — no extra DB query) -------------
    // De-dup while preserving first-seen order (round_index ascending), so
    // seed list reads top-to-bottom in the order the learner will encounter.
    const seenSeeds = new Set<number>()
    const seeds: BundleSeed[] = []
    for (const r of scopedRoundRows) {
      if (seenSeeds.has(r.seed_number)) continue
      seenSeeds.add(r.seed_number)
      seeds.push({ seedId: buildSeedId(r.seed_number), seedNumber: r.seed_number })
    }

    // --- Pods (Layer 2) -----------------------------------------------------
    // Two-step: pod rows tell us which pod_ids to fetch sentences for.
    // Done sequentially because the second query depends on the first.
    // Skipped entirely if the course has no pods row, OR the caller is on
    // the free-preview slice — Layer 2 listening content is premium-only,
    // never shipped to an unentitled caller.
    const podRows: PodRow[] = previewOnly ? [] : ((podsRes?.data || []) as unknown as PodRow[])
    const bookendRows: Array<{ id: string; role: string; duration_ms: number | null }> =
      (bookendsRes?.data || []) as unknown as Array<{ id: string; role: string; duration_ms: number | null }>

    let podSentenceRows: PodSentenceRow[] = []
    if (podRows.length > 0) {
      const sentencesRes = await supabase
        .from('listening_pod_sentences')
        .select('pod_id, global_order, target_text, known_text, target_audio_id, known_audio_id, explainer_audio_id, glue_to_next')
        .in('pod_id', podRows.map((p) => p.id))
        .order('global_order', { ascending: true })
      if (sentencesRes.error) {
        console.warn(
          '[Bundle] listening_pod_sentences query failed (non-fatal):',
          sentencesRes.error.message,
        )
      } else {
        podSentenceRows = (sentencesRes.data || []) as unknown as PodSentenceRow[]
      }
    }

    const bookendByRole = new Map<string, BundleAudioRef>()
    for (const row of bookendRows) {
      const ref = buildAudioRef(row.id, 'persistent', row.duration_ms)
      if (ref) bookendByRole.set(row.role, ref)
    }
    const introRef = bookendByRole.get('bookend_listen_intro')
    const outroRef = bookendByRole.get('bookend_listen_outro')

    const sentencesByPod = new Map<string, BundlePodSentence[]>()
    for (const row of podSentenceRows) {
      const target = buildAudioRef(row.target_audio_id, 'persistent', null)
      const known = buildAudioRef(row.known_audio_id, 'persistent', null)
      const explainer = buildAudioRef(row.explainer_audio_id, 'persistent', null)
      const sentence: BundlePodSentence = {
        globalOrder: row.global_order,
        knownText: row.known_text ?? '',
        targetText: row.target_text ?? '',
        glueToNext: row.glue_to_next === true,
      }
      if (target) sentence.targetAudio = target
      if (known) sentence.knownAudio = known
      if (explainer) sentence.explainerAudio = explainer
      let bucket = sentencesByPod.get(row.pod_id)
      if (!bucket) { bucket = []; sentencesByPod.set(row.pod_id, bucket) }
      bucket.push(sentence)
    }

    const pods: BundlePod[] = podRows.map((row) => {
      const pod: BundlePod = {
        podId: row.id,
        // pod_order is nullable in the DB; treat null as 0 so single-pod
        // courses (today's common case) still walk in a deterministic order.
        podOrder: row.pod_order ?? 0,
        title: row.title,
        sentences: sentencesByPod.get(row.id) ?? [],
      }
      if (introRef) pod.introAudio = introRef
      if (outroRef) pod.outroAudio = outroRef
      return pod
    })

    const bundle: CourseBundle = {
      courseCode: code,
      version,
      // Consistent with the scoped roundMap actually shipped below — a
      // preview caller's mainLoopCount reflects only the preview window,
      // never the full course's true round count.
      mainLoopCount: scopedRoundRows.length,
      legos,
      phrases,
      seeds,
      roundMap,
      pods,
    }
    if (previewOnly) bundle.previewOnly = true

    res.setHeader(
      'Cache-Control',
      'private, max-age=300, s-maxage=86400, stale-while-revalidate=86400',
    )
    res.status(200).json(bundle)
  } catch (err) {
    console.error('[Bundle] Unexpected error:', err)
    res.setHeader('Cache-Control', 'no-store')
    res.status(500).json({ error: 'Internal server error' })
  }
}
