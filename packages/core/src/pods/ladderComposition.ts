/**
 * ladderComposition.ts — the unified pod acquisition ladder (Tom 2026-07-03).
 *
 * Ports the ladder algorithm proven in ssi-dashboard-v7-clean's Pod Lab
 * (src/views/admin/PodLab.vue, spanLadder/fuseSpans/tktt/ladderRungs) into
 * @ssi/core so the SAME engine drives both the learner's main flow
 * (usePodLapScheduler) and the dashboard's audition surface — no second,
 * drifting copy.
 *
 * FUSION MODE: pairwise only (the Aran approach — disjoint pairs L→R, an odd
 * tail stands alone until the next rung). The reference also had a 'chained'
 * mode (adjacent windows sharing an edge chunk); that mode is NOT ported —
 * product decision, pairwise ships alone, no config toggle.
 *
 * THE CLIMB, one turn (a listening_pod_sentences row) at a time:
 *   1. Fusion rungs — one t·k·t·t per rung, from the finest atom_map_fine
 *      units up to each grammatical sentence's whole. Every sentence within
 *      the turn rides every rung; a sentence already at its whole repeats
 *      its whole t·k·t·t while longer siblings keep climbing.
 *   2. Conjoin rungs — (multi-sentence turns only) the sentences themselves
 *      fuse pairwise on into the whole turn.
 *   3. Speed-ramp rungs — the locked LADDER_SPEED_PLAYLIST cascade (engine
 *      "stages" 2-8) on the whole turn, ending on an eternal 2× hold.
 *
 * ELIGIBILITY: a turn rides the ladder when it carries atom_map_fine (kind
 * 'atom'/'passthrough' entries with target_start_ms/target_end_ms) and a
 * target_audio_id. takeg_audio_ids is consulted per sentence-group for
 * SLICING (one gapped Take G render, ms spans, no per-chunk files); a group
 * missing its Take G render degrades gracefully to butted unit/whole-sentence
 * clips rather than blocking the whole turn. Turns with no atom_map_fine at
 * all are NOT eligible — see PodSentenceRow.atom_map_fine / isLadderEligible
 * / usePodLapScheduler's automatic fallback to the pre-ladder Stage-0..N arc.
 *
 * This module is PURE COMPUTATION — no Supabase, no audio, no DOM (mirrors
 * usePodAtomFusion's discipline). loadFineKnownMap is the one exception (a
 * thin course-wide Supabase read, sibling of loadStage0ClipMaps).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  normSurface,
  type AtomMapEntry,
} from './stage0Sequence'
import {
  ROLE_SPEED,
  type PodPlay,
  type PodPlayRole,
  type PodSentenceRow,
} from './podStageComposition'

// ============================================================================
// Gap timing — the ladder's own constants (distinct from the role gap-matrix
// LearningPlayer applies between whole-sentence stages; ladder plays carry
// their gap explicitly via gapAfterMs, same convention as buildStage0Tier).
// ============================================================================

/** Gap after a whole-chunk/whole-sentence/whole-turn step (target or gloss). */
const GAP_BETWEEN_STEPS = 700
/** Gap after a gloss (known-language) step — meaning lands, beat, back to target. */
const GAP_AFTER_GLOSS = 500
/** Gap between the clips WITHIN one step's fused/butted clip list. */
const GAP_INTRA_FUSE = 120

/**
 * The locked speed cascade appended after the fusion+conjoin climb reaches
 * the whole turn — mirrors the "engine Stage 2-8" cross-reference in the Pod
 * Lab source (Tom 2026-07-01). Stage 1 (t·k·t·t at 1×) is deliberately
 * OMITTED here: it is identical to the ladder's own final fusion/conjoin
 * rung (the whole turn's t·k·t·t), so the ramp enters at Stage 2. The final
 * entry (8) is played forever once reached (ladderViewFor clamps).
 */
export const LADDER_SPEED_PLAYLIST: Record<number, PodPlayRole[]> = {
  1: ['ps', 'trans', 'ps', 'ps'], //     t · k · t · t (unused — see above)
  2: ['ps', 'trans', 'ps', 'ps2x'], //   t · k · t · t@2×
  3: ['ps', 'trans', 'ps2x', 'ps2x'], // t · k · t@2× · t@2×
  4: ['ps', 'trans', 'ps2x'], //         t · k · t@2×
  5: ['ps2x', 'trans', 'ps2x'], //       t@2× · k · t@2×
  6: ['ps', 'ps2x'], //                  t · t@2×
  7: ['ps2x', 'ps2x'], //                t@2× · t@2×
  8: ['ps2x'], //                        t@2×  (eternal)
}

// ============================================================================
// Eligibility
// ============================================================================

/**
 * True iff this turn should ride the unified ladder rather than the
 * pre-ladder Stage-0..N arc. Gate: a target clip to anchor on, and at least
 * one fusible (atom/passthrough) atom_map_fine entry. takeg_audio_ids is
 * NOT required here — a turn can be ladder-eligible with no Take G render at
 * all (chunkStep/wholeSentenceChunk degrade to butted unit/whole-sentence
 * clips); Take G only improves the FIDELITY of the climb, not its presence.
 */
export function isLadderEligible(row: PodSentenceRow): boolean {
  if (!row.target_audio_id) return false
  const atoms = row.atom_map_fine
  return Array.isArray(atoms) && atoms.some((a) => a.kind === 'atom' || a.kind === 'passthrough')
}

// ============================================================================
// normForAudio — mirror of services/shared/text-normalize.cjs normalizeForAudio
// (ssi-dashboard-v7-clean). Every lookup against course_audio.text_normalized
// MUST use exactly this. Duplicated (not imported) — the two repos don't share
// a runtime dependency; keep in lockstep if that function ever changes.
// ============================================================================

export const normForAudio = (t: string | null | undefined): string =>
  (t || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.!。！]+$/, '')

/**
 * Load the course-wide fine-known lookup: text_normalized → pod_fine_known
 * clip id (plain per-unit gloss / per-window translation clips, coach voice).
 * Sibling of loadStage0ClipMaps (stage0Sequence / podStageComposition).
 */
export async function loadFineKnownMap(
  supabase: SupabaseClient,
  courseCode: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const { data } = await supabase
    .from('course_audio')
    .select('id, text_normalized')
    .eq('course_code', courseCode)
    .eq('role', 'pod_fine_known')
  for (const row of (data || []) as Array<{ id: string; text_normalized: string | null }>) {
    if (row.text_normalized) map.set(row.text_normalized, row.id)
  }
  return map
}

// ============================================================================
// The fusion rule — pairwise adjacent merge (Aran approach; the ONLY mode)
// ============================================================================

interface Span {
  start: number
  end: number
}

/** Merge adjacent pairs left-to-right; an odd tail stands alone this rung. */
function fusePairwise(spans: Span[]): Span[] {
  if (spans.length <= 1) return spans
  const out: Span[] = []
  for (let i = 0; i < spans.length; i += 2) {
    out.push({ start: spans[i].start, end: spans[Math.min(i + 1, spans.length - 1)].end })
  }
  return out
}

/** Every fusion level for an n-unit stretch: units → … → the whole. */
function spanLadder(n: number): Span[][] {
  let spans: Span[] = Array.from({ length: n }, (_, i) => ({ start: i, end: i }))
  const levels: Span[][] = [spans]
  while (spans.length > 1) {
    spans = fusePairwise(spans)
    levels.push(spans)
  }
  return levels
}

// ============================================================================
// Plan-level types
// ============================================================================

/** A playable clip: a whole course_audio id, or a timed slice of one (how
 *  every Take G chunk plays — one gapped take, ms spans, no per-chunk files). */
export type LadderClip = string | { id: string; startMs: number; endMs: number }

export interface LadderStep {
  /** 'chunk'/'whole' = target-language audio; 'gloss' = known-language audio. */
  kind: 'chunk' | 'gloss' | 'group' | 'whole'
  text: string
  /** In play order; nullish entries are dropped at flatten time (a step with
   *  nothing playable — e.g. no meansGlossClipId fallback — contributes nothing). */
  clips: Array<LadderClip | null>
  /** Runtime playback rate — 1 normally, 2 during the speed-ramp's ps2x slots. */
  rate: number
}

export interface LadderRung {
  steps: LadderStep[]
}

// ============================================================================
// Atom resolution — atom_map_fine entries already carry their own ms spans
// (unlike atom_map's course-wide indirection), so this is a straight filter +
// course-wide clip lookups for the FALLBACK paths (no Take G / no fine-known).
// ============================================================================

interface ResolvedFineAtom {
  targetSurface: string
  gloss: string
  target_start_ms: number | null
  target_end_ms: number | null
  /** Stage-0 "[atom] <target>" clip — fallback when a group has no Take G. */
  targetClipId: string | null
  /** pod_legos "means <gloss>" clip — fallback when no fine-known clip exists. */
  meansGlossClipId: string | null
}

function resolveFineAtoms(
  atomMapFine: AtomMapEntry[] | null | undefined,
  glossMap: Map<string, string>,
  targetClipMap: Map<string, string>,
): ResolvedFineAtom[] {
  return (atomMapFine || [])
    .filter((e) => e.kind === 'atom' || e.kind === 'passthrough')
    .map((e) => ({
      targetSurface: e.target_surface,
      gloss: e.gloss,
      target_start_ms: e.target_start_ms ?? null,
      target_end_ms: e.target_end_ms ?? null,
      targetClipId: targetClipMap.get(normSurface(e.target_surface)) ?? null,
      meansGlossClipId: glossMap.get(e.lego_key) ?? null,
    }))
}

/** Sentence-terminal punctuation walked off target_text between atoms —
 *  sound-wave grouping, no grammar. Mirrors PodLab.vue's SENTENCE_PUNCT. */
const SENTENCE_PUNCT = /[.!?…。！？]/

/** Split the turn's fusible atoms into per-sentence groups by walking their
 *  surfaces off target_text in order and cutting at terminal punctuation. */
function atomGroups(targetText: string, atoms: ResolvedFineAtom[]): ResolvedFineAtom[][] {
  const text = targetText || ''
  const lower = text.toLowerCase()
  const groups: ResolvedFineAtom[][] = [[]]
  let cursor = 0
  for (let i = 0; i < atoms.length; i++) {
    const idx = lower.indexOf(atoms[i].targetSurface.toLowerCase(), cursor)
    if (i > 0 && idx !== -1 && SENTENCE_PUNCT.test(text.slice(cursor, idx))) groups.push([])
    groups[groups.length - 1].push(atoms[i])
    if (idx !== -1) cursor = idx + atoms[i].targetSurface.length
  }
  return groups.filter((g) => g.length > 0)
}

/** Per-sentence takes when the count aligns with the groups, else null per group. */
function alignedTakes(ids: Array<string | null> | null | undefined, groups: unknown[][]): Array<string | null> {
  return Array.isArray(ids) && ids.length === groups.length ? ids : groups.map(() => null)
}

/** Sibling of podSentenceSplit's POD_SENTENCE_BOUNDARY — duplicated (not
 *  imported) because @ssi/core cannot depend on player-vue. Keep in lockstep. */
const KNOWN_SENTENCE_BOUNDARY = /(?<=[.!?…])\s+/

const clipList = (take: string | null): string[] => (take ? [take] : [])

/**
 * The ladder view index (0-based) for a given 1-based "alive" count (how many
 * pod-rounds this turn has been active for) — sibling of stage0ViewFor.
 * Clamped to the last rung, which is the eternal 2× hold.
 */
export function ladderViewFor(alive: number, totalRungs: number): number {
  if (totalRungs <= 0) return 0
  return Math.min(Math.max(alive, 1), totalRungs) - 1
}

/**
 * Build the FULL unified climb for one turn: every fusion rung, every
 * conjoin rung (multi-sentence turns), then the speed-ramp rungs. Pure and
 * deterministic — safe to compute once and cache per turn, then index by
 * ladderViewFor(alive, rungs.length) per lap.
 *
 * Returns [] when the turn isn't eligible (see isLadderEligible) or its
 * atoms don't resolve to at least one sentence group.
 */
export function buildTurnLadderRungs(
  row: PodSentenceRow,
  opts: {
    glossMap: Map<string, string>
    targetClipMap: Map<string, string>
    fineKnownMap: Map<string, string>
  },
): LadderRung[] {
  if (!row.target_audio_id) return []
  const atoms = resolveFineAtoms(row.atom_map_fine, opts.glossMap, opts.targetClipMap)
  if (atoms.length === 0) return []

  const rawGroups = atomGroups(row.target_text, atoms)
  if (rawGroups.length === 0) return []

  const rawTakes = alignedTakes(row.sentence_audio_ids, rawGroups)
  const rawKnown = alignedTakes(row.sentence_known_audio_ids, rawGroups)
  const rawKnownTexts = (row.known_text || '').split(KNOWN_SENTENCE_BOUNDARY).map((s) => s.trim()).filter(Boolean)
  const knownTextsAligned = rawKnownTexts.length === rawGroups.length

  // Glue a leading TURN-INITIAL one-unit group ("Ciao!") onto the sentence
  // that follows — never strand a bare interjection. A mid-turn one-unit
  // group is a real sentence with its own takes and is left alone.
  const groups: ResolvedFineAtom[][] = []
  const takes: Array<string | null> = []
  const knownTakes: Array<string | null> = []
  const knownTexts: Array<string | null> = []
  let carry: ResolvedFineAtom[] = []
  let carryKnown: string[] = []
  rawGroups.forEach((g, i) => {
    if (groups.length === 0 && g.length === 1 && i < rawGroups.length - 1) {
      carry.push(...g)
      if (knownTextsAligned) carryKnown.push(rawKnownTexts[i])
      return
    }
    groups.push([...carry, ...g])
    takes.push(carry.length ? null : rawTakes[i])
    knownTakes.push(carry.length ? null : rawKnown[i])
    knownTexts.push(knownTextsAligned ? [...carryKnown, rawKnownTexts[i]].join(' ') : null)
    carry = []
    carryKnown = []
  })
  if (carry.length) {
    groups.push(carry)
    takes.push(null)
    knownTakes.push(null)
    knownTexts.push(knownTextsAligned ? carryKnown.join(' ') : null)
  }

  const single = groups.length === 1

  const offsets: number[] = []
  {
    let off = 0
    for (const g of groups) {
      offsets.push(off)
      off += g.length
    }
  }

  const takegIds: Array<string | null> = Array.isArray(row.takeg_audio_ids) && row.takeg_audio_ids.length === groups.length
    ? row.takeg_audio_ids
    : groups.map(() => null)

  const winKnown = new Map<string, string>()
  for (const w of row.window_known_map || []) winKnown.set(`${w.start}-${w.end}`, w.known)

  // sub-sentence chunk: a contiguous ms SLICE of the group's Take G render
  // (gaps preserved); butted unit clips only where Take G is missing.
  const chunkStep = (g: ResolvedFineAtom[], span: Span, gi: number): LadderStep => {
    const us = g.slice(span.start, span.end + 1)
    const takeg = takegIds[gi]
    const sliced = !!takeg && us.every((a) => a.target_start_ms != null && a.target_end_ms != null)
    return {
      kind: 'chunk',
      text: us.map((a) => a.targetSurface).join(' '),
      clips: sliced
        ? [{ id: takeg as string, startMs: us[0].target_start_ms as number, endMs: us[us.length - 1].target_end_ms as number }]
        : us.map((a) => a.targetClipId),
      rate: 1,
    }
  }

  // chunk's known: the real fine-known clip for the unit gloss / authored
  // window translation; legacy per-unit "means X" butt only where it's missing.
  const knownStep = (g: ResolvedFineAtom[], span: Span, gi: number): LadderStep => {
    const us = g.slice(span.start, span.end + 1)
    const text = us.length === 1
      ? (us[0].gloss || '')
      : (winKnown.get(`${offsets[gi] + span.start}-${offsets[gi] + span.end}`) || us.map((a) => a.gloss).filter(Boolean).join(' '))
    const real = opts.fineKnownMap.get(normForAudio(text))
    return {
      kind: 'gloss',
      text,
      clips: real ? [real] : us.map((a) => a.meansGlossClipId),
      rate: 1,
    }
  }

  // a sentence at its whole — real takes; for a single-sentence turn the
  // sentence whole IS the turn whole, so fall through to the turn takes.
  const wholeSentenceChunk = (gi: number): LadderStep => {
    const g = groups[gi]
    const take = takes[gi] || (single ? row.target_audio_id : null)
    const clips = take ? clipList(take) : (takegIds[gi] ? [takegIds[gi] as string] : g.map((a) => a.targetClipId))
    return { kind: 'group', text: g.map((a) => a.targetSurface).join(' '), clips, rate: 1 }
  }

  const wholeSentenceKnown = (gi: number): LadderStep => {
    const g = groups[gi]
    const take = knownTakes[gi] || (single ? row.known_audio_id : null)
    const sentText = single && row.known_text ? row.known_text : knownTexts[gi]
    const joinText = g.map((a) => a.gloss).filter(Boolean).join(' ')
    const sentReal = sentText ? opts.fineKnownMap.get(normForAudio(sentText)) : null
    const joinReal = opts.fineKnownMap.get(normForAudio(joinText))
    const clips = sentReal ? [sentReal] : take ? clipList(take) : joinReal ? [joinReal] : g.map((a) => a.meansGlossClipId)
    return { kind: 'gloss', text: sentText || joinText, clips, rate: 1 }
  }

  // conjoined sentences below the whole turn: butted sentence takes until Take G.
  const conjoinChunk = (span: Span): LadderStep => {
    const gs = groups.slice(span.start, span.end + 1)
    const tks = takes.slice(span.start, span.end + 1)
    const perGroup = gs.map((g, i) => {
      const t = tks[i] || takegIds[span.start + i]
      return t ? clipList(t) : g.map((a) => a.targetClipId)
    })
    return {
      kind: 'group',
      text: gs.map((g) => g.map((a) => a.targetSurface).join(' ')).join(' '),
      clips: perGroup.flat(),
      rate: 1,
    }
  }

  const conjoinKnown = (span: Span): LadderStep => {
    const gs = groups.slice(span.start, span.end + 1)
    const kts = knownTakes.slice(span.start, span.end + 1)
    const perGroup = gs.map((g, i) => {
      const gi = span.start + i
      const sentReal = knownTexts[gi] ? opts.fineKnownMap.get(normForAudio(knownTexts[gi] as string)) : null
      if (sentReal) return [sentReal]
      if (kts[i]) return clipList(kts[i])
      const real = opts.fineKnownMap.get(normForAudio(g.map((a) => a.gloss).filter(Boolean).join(' ')))
      return real ? [real] : g.map((a) => a.meansGlossClipId)
    })
    return {
      kind: 'gloss',
      text: gs.map((g, i) => knownTexts[span.start + i] || g.map((a) => a.gloss).filter(Boolean).join(' ')).join(' '),
      clips: perGroup.flat(),
      rate: 1,
    }
  }

  const wholeTurnChunk = (rate = 1): LadderStep => ({
    kind: 'whole',
    text: row.target_text,
    clips: [row.target_audio_id as string],
    rate,
  })
  const wholeTurnKnown = (): LadderStep => ({
    kind: 'gloss',
    text: row.known_text || '',
    clips: row.known_audio_id ? [row.known_audio_id] : [],
    rate: 1,
  })

  // t·k·t·t for one chunk — the ONE pattern every rung of the ladder plays.
  // The known slot is dropped only when there is nothing to say in it.
  const tktt = (chunk: LadderStep, known: LadderStep): LadderStep[] =>
    known.clips.some(Boolean) || known.text
      ? [chunk, known, { ...chunk }, { ...chunk }]
      : [chunk, { ...chunk }]

  const ladders = groups.map((g) => spanLadder(g.length))
  const maxDepth = Math.max(...ladders.map((l) => l.length))
  const rungs: LadderRung[] = []

  // Fusion rungs: every sentence rides every rung; a sentence already at its
  // whole repeats its whole t·k·t·t while longer siblings climb.
  for (let r = 0; r < maxDepth; r++) {
    const steps: LadderStep[] = []
    groups.forEach((g, gi) => {
      const l = ladders[gi]
      const lvl = l[Math.min(r, l.length - 1)]
      if (lvl.length === 1) steps.push(...tktt(wholeSentenceChunk(gi), wholeSentenceKnown(gi)))
      else lvl.forEach((span) => steps.push(...tktt(chunkStep(g, span, gi), knownStep(g, span, gi))))
    })
    rungs.push({ steps })
  }

  // Conjoining rungs: the sentences fuse on into the turn (the all-wholes
  // level IS the previous rung, so spanLadder's first level is skipped).
  if (!single) {
    for (const lvl of spanLadder(groups.length).slice(1)) {
      const isTurn = lvl.length === 1
      const steps = isTurn
        ? tktt(wholeTurnChunk(), wholeTurnKnown())
        : lvl.flatMap((span) => tktt(conjoinChunk(span), conjoinKnown(span)))
      rungs.push({ steps })
    }
  }

  // The speed ramp: the locked cascade (engine Stages 2-8) on the whole turn.
  for (let es = 2; es <= 8; es++) {
    const pat = LADDER_SPEED_PLAYLIST[es] || []
    const steps = pat.map((role) => (role === 'trans' ? wholeTurnKnown() : wholeTurnChunk(role === 'ps2x' ? 2 : 1)))
    rungs.push({ steps })
  }

  return rungs
}

// ============================================================================
// Rung → PodPlay flattening — folds each step's clip list + the ladder's own
// gap constants into gapAfterMs, same convention as buildStage0Tier (the
// LAST play of the rung omits gapAfterMs so the normal between-sentence /
// glue gap carries through to the next turn).
// ============================================================================

export function ladderRungToPlays(rung: LadderRung, sentenceIdx: number, stage: number): PodPlay[] {
  const plays: PodPlay[] = []
  for (const step of rung.steps) {
    const clips = step.clips.filter((c): c is LadderClip => !!c)
    if (clips.length === 0) continue
    const role: PodPlayRole = step.kind === 'gloss' ? 'trans' : (step.rate === 2 ? 'ps2x' : 'ps')
    const stepGap = step.kind === 'gloss' ? GAP_AFTER_GLOSS : GAP_BETWEEN_STEPS
    clips.forEach((clip, ci) => {
      const isSlice = typeof clip === 'object'
      plays.push({
        sentenceIdx,
        stage,
        playRole: role,
        audioId: isSlice ? clip.id : clip,
        text: step.text,
        playbackSpeed: ROLE_SPEED[role] ?? step.rate ?? 1,
        glueToNextChunk: false,
        gapAfterMs: ci < clips.length - 1 ? GAP_INTRA_FUSE : stepGap,
        ...(isSlice ? { takegClipId: clip.id, unitStartMs: clip.startMs, unitEndMs: clip.endMs } : {}),
      })
    })
  }
  if (plays.length) delete (plays[plays.length - 1] as { gapAfterMs?: number }).gapAfterMs
  return plays
}
