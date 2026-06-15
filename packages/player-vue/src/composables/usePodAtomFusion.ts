/**
 * usePodAtomFusion — pure computation core for the Atom-Fusion Stage-one ladder.
 *
 * Computes a deterministic, serializable PLAY PLAN from a per-sentence atom
 * map (the Popty data contract — see docs/atom-fusion-introduction.md, fuller
 * v2 spec in the Popty repo at docs/architecture/atom-fusion-introduction.md)
 * plus a few live config knobs. The plan is the whole Stage-one ladder for one
 * clause:
 *
 *   1. Orientation — whole target_clause once (the destination).
 *   2. Meet the atoms — per TEACHABLE atom (kind 'atom'): target slice →
 *      inventory explainer clip (cited by lego_key, played whole) → target
 *      slice echo. A second, lighter pass (scaffoldFade 'two-pass') drops the
 *      echo; on 'one-pass' there is no second pass. Single-span notes play
 *      here, immediately after the atom they span. 'passthrough' atoms
 *      (names, units taught in an earlier sentence) are NOT met.
 *   3. Fuse — TARGET-ONLY tiers over everything with clause audio (kinds
 *      'atom' + 'passthrough'): pairwise adjacent merge; odd count → the odd
 *      atom stays un-fused that tier and joins the PRECEDING pair next tier
 *      as a three. Each tier emits the continuous clause take with INSERTED
 *      gaps at the remaining seams (gap length from gapCurveMs[tier]); the
 *      final tier is the untouched take (everything fused → no seams).
 *      A multi-span note fires at the first tier where ALL its spanned atoms
 *      have fused into one group.
 *   4. Arrive — whole target_clause untouched, then known_clause caps the
 *      holistic meaning.
 *
 * Self-scaling: a 2-atom clause collapses to one fuse tier straight to the
 * untouched take; 6 atoms stretch over three tiers. No randomness anywhere —
 * the same input always yields the identical plan (safe to snapshot, cache,
 * or diff).
 *
 * This module is PURE COMPUTATION — no Supabase, no audio, no DOM. The thin
 * usePodAtomFusion() wrapper at the bottom adds Vue reactivity for the
 * overlay integration (which lands separately; ListeningOverlay is untouched
 * by this commit).
 *
 * Spec ambiguities resolved here (flagged for ratification — each is also
 * noted inline where it bites):
 *   R1. `spans` and all plan indices (highlightAtomIdxs, mergedGroups,
 *       noteIdx) are 0-based indices into the INPUT `atoms` array as given
 *       (notes included). Spans may only point at fusible entries.
 *   R2. The meet stage's second pass is a second SWEEP over all teachable
 *       atoms (not interleaved per atom), and notes play in the FIRST sweep
 *       only — an aside lands once.
 *   R3. A single-span note spanning a passthrough still plays in the meet
 *       tier, at its atom-order position (after the preceding met atom's
 *       sequence) — the aside survives even though the atom isn't met.
 *   R4. Seam position = target_start_ms of the first atom of the FOLLOWING
 *       group (with total tiling this equals the preceding atom's end).
 *   R5. gapCurveMs is consumed by literal tier index (tier t → entry t-1),
 *       clamped to the last entry when the clause has more tiers than the
 *       curve has entries. Long curves' tails simply go unused on short
 *       clauses. Remaining seams are still emitted when the clamped gap is 0
 *       (they mark the screen grouping; the player inserts nothing for 0).
 *   R6. Odd-count generalisation beyond the spec's 3/5-atom cases: the
 *       unpaired group left over at a tier joins its PRECEDING group at the
 *       next tier; other adjacent pairs on the line still merge that tier
 *       (within the contiguous runs either side of the join — keeps tier
 *       count log-ish per the spec's self-scaling goal). If two runs both
 *       leave a group unpaired, the RIGHTMOST one becomes the tracked
 *       leftover; a leftover with no preceding group (line start) degrades
 *       to plain pairwise next tier.
 *   R7. A multi-span note plays immediately AFTER its tier's clause take
 *       (hear the junction fused, then the aside about it), before any
 *       per-tier anchor.
 *   R8. anchoring 'per-tier' re-plays the whole UNTOUCHED target_clause
 *       after each NON-final fusion tier (the final tier's take already IS
 *       the untouched clause). 'ends-only' adds nothing — orientation and
 *       arrive are the only whole-clause anchors.
 *   R9. Target offsets are REQUIRED on fusible atoms and explainer offsets
 *       on notes — buildAtomFusionPlan throws on incomplete maps (Popty rows
 *       with null offsets aren't ladder-ready yet).
 */

import { computed, type ComputedRef, type Ref } from 'vue'

// ============================================================================
// Types — input side (the Popty per-sentence atom map + config knobs)
// ============================================================================

export type AtomKind = 'atom' | 'passthrough' | 'note'

/**
 * One entry of the per-sentence atom map (listening_pod_sentences.atom_map).
 * Identity (gloss, canonical explainer clip) lives in the pod-LEGO inventory,
 * cited by lego_key; this entry carries the clause-local POSITION layer.
 */
export interface FusionAtom {
  /** → pod-LEGO inventory (identity + canonical explainer clip). */
  lego_key: string
  /** atom = teachable | passthrough = spoken but not taught | note = aside. */
  kind: AtomKind
  /** Known-language text for the screen. */
  gloss: string
  /** Offset into target_clause (fusible kinds only). */
  target_start_ms?: number
  target_end_ms?: number
  /** Offset into the per-clause note_audio file (notes only). */
  explainer_start_ms?: number
  explainer_end_ms?: number
  /**
   * Notes only — indices into THIS atoms array (R1) of the fusible entries
   * the note is about. Length 1 → meet-tier aside after that atom;
   * length 2+ → junction note, fires at the first tier the spanned atoms
   * share a fused group.
   */
  spans?: number[]
}

/**
 * Live config knobs — same posture as algorithm_config.pods: admins tune
 * these without code changes; the module only encodes the LAWS (ladder
 * shape, fusion rule), never the calibration.
 */
export interface FusionKnobs {
  /**
   * Silence inserted at each remaining seam, per fusion tier (tier t reads
   * entry t-1, clamped to the last entry — R5). Must be monotonically
   * decreasing and END AT 0 (the untouched take).
   */
  gapCurveMs: number[]
  /** 'two-pass' = full meet sweep + lighter sweep (no echo); 'one-pass' = full sweep only. */
  scaffoldFade: 'two-pass' | 'one-pass'
  /** 'per-tier' = re-hear the untouched clause after each non-final fusion tier (R8). */
  anchoring: 'per-tier' | 'ends-only'
}

/**
 * Defaults. Gap curve starts deliberately small — coarticulated tails make
 * wide early gaps sound unnatural (spec: "start smaller than instinct
 * suggests"); calibration by ear happens in algorithm_config, not here.
 */
export const DEFAULT_FUSION_KNOBS: FusionKnobs = {
  gapCurveMs: [350, 200, 100, 0],
  scaffoldFade: 'two-pass',
  anchoring: 'ends-only',
}

// ============================================================================
// Types — output side (the serializable play plan)
// ============================================================================

export type PlanSource = 'target_clause' | 'inventory_explainer' | 'note_audio' | 'known_clause'

export type PlanTier = 'orientation' | 'meet' | `fuse-${number}` | 'arrive'

/** One silence insertion into the continuous clause take. */
export interface GapInsert {
  /** Position in target_clause where the silence goes (a remaining seam). */
  atMs: number
  /** Silence length. 0 = seam still marked for the screen, no audio change. */
  gapMs: number
}

export interface PlanPlay {
  source: PlanSource
  /** [start, end] into the source file. Omitted = play whole. */
  sliceMs?: [number, number]
  /** Fusion tiers only — silences to insert into the continuous take. */
  gapInsertsMs?: GapInsert[]
  /** inventory_explainer only — which canonical clip to cite. */
  legoKey?: string
  /** note_audio only — index of the note in the atoms array (R1). */
  noteIdx?: number
}

export interface PlanScreen {
  /** Atoms-array indices to highlight (meet steps, note steps). */
  highlightAtomIdxs?: number[]
  /** Fusion tiers — current visual grouping, arrays of atoms-array indices. */
  mergedGroups?: number[][]
  /** Whether the known-language gloss line is shown for this step. */
  glossVisible?: boolean
}

export interface PlanStep {
  tier: PlanTier
  play: PlanPlay
  screen: PlanScreen
}

export interface AtomFusionPlan {
  /** The whole ladder, in play order. */
  steps: PlanStep[]
  /** How many fuse-N tiers the clause produced (self-scaled to atom count). */
  fusionTierCount: number
  /** Atoms-array indices with clause audio (kinds 'atom' + 'passthrough'). */
  fusibleAtomIdxs: number[]
  /** Atoms-array indices that get met (kind 'atom'). */
  teachableAtomIdxs: number[]
}

// ============================================================================
// Knob resolution + validation
// ============================================================================

const FUSIBLE_KINDS: ReadonlySet<AtomKind> = new Set(['atom', 'passthrough'])

const isFusible = (a: FusionAtom): boolean => FUSIBLE_KINDS.has(a.kind)

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Merge partial knobs over the defaults. Pure; no mutation of either input. */
export function resolveFusionKnobs(partial?: Partial<FusionKnobs>): FusionKnobs {
  return {
    gapCurveMs: partial?.gapCurveMs ? [...partial.gapCurveMs] : [...DEFAULT_FUSION_KNOBS.gapCurveMs],
    scaffoldFade: partial?.scaffoldFade ?? DEFAULT_FUSION_KNOBS.scaffoldFade,
    anchoring: partial?.anchoring ?? DEFAULT_FUSION_KNOBS.anchoring,
  }
}

/**
 * Validate an atom map + knobs. Returns a list of human-readable problems;
 * empty = valid. buildAtomFusionPlan throws when this is non-empty, but the
 * function is exported separately so callers (admin QA surfaces, the
 * composable wrapper) can surface problems without try/catch.
 */
export function validateFusionInput(atoms: FusionAtom[], knobs: FusionKnobs): string[] {
  const problems: string[] = []

  // --- Knobs -------------------------------------------------------------
  const curve = knobs.gapCurveMs
  if (!Array.isArray(curve) || curve.length === 0) {
    problems.push('gapCurveMs: must be a non-empty array')
  } else {
    if (curve.some((g) => !isFiniteNumber(g) || g < 0)) {
      problems.push('gapCurveMs: every entry must be a finite number >= 0')
    }
    for (let i = 1; i < curve.length; i++) {
      if (curve[i] > curve[i - 1]) {
        problems.push(`gapCurveMs: must be monotonically decreasing (entry ${i}: ${curve[i]} > ${curve[i - 1]})`)
        break
      }
    }
    if (curve[curve.length - 1] !== 0) {
      problems.push(`gapCurveMs: must end at 0 (the untouched take), got ${curve[curve.length - 1]}`)
    }
  }
  if (knobs.scaffoldFade !== 'two-pass' && knobs.scaffoldFade !== 'one-pass') {
    problems.push(`scaffoldFade: unknown value '${String(knobs.scaffoldFade)}'`)
  }
  if (knobs.anchoring !== 'per-tier' && knobs.anchoring !== 'ends-only') {
    problems.push(`anchoring: unknown value '${String(knobs.anchoring)}'`)
  }

  // --- Atoms ---------------------------------------------------------------
  if (!Array.isArray(atoms) || atoms.length === 0) {
    problems.push('atoms: must be a non-empty array')
    return problems
  }

  let prevFusibleStart: number | null = null
  let fusibleCount = 0
  atoms.forEach((a, i) => {
    const at = `atoms[${i}] (${a.lego_key || 'no key'})`
    if (a.kind !== 'atom' && a.kind !== 'passthrough' && a.kind !== 'note') {
      problems.push(`${at}: unknown kind '${String(a.kind)}'`)
      return
    }
    if (isFusible(a)) {
      fusibleCount++
      // R9 — fusible atoms must carry target offsets (meet slices + seams).
      if (!isFiniteNumber(a.target_start_ms) || !isFiniteNumber(a.target_end_ms)) {
        problems.push(`${at}: fusible entry missing target_start_ms/target_end_ms`)
      } else if (a.target_start_ms >= a.target_end_ms) {
        problems.push(`${at}: target_start_ms must be < target_end_ms`)
      } else {
        if (prevFusibleStart !== null && a.target_start_ms < prevFusibleStart) {
          problems.push(`${at}: target offsets out of order (clause atoms must be positionally sorted)`)
        }
        prevFusibleStart = a.target_start_ms
      }
      if (a.kind === 'atom' && !a.lego_key) {
        problems.push(`atoms[${i}]: teachable atom missing lego_key (cites the inventory explainer clip)`)
      }
    } else {
      // kind === 'note'
      if (!isFiniteNumber(a.explainer_start_ms) || !isFiniteNumber(a.explainer_end_ms)) {
        problems.push(`${at}: note missing explainer_start_ms/explainer_end_ms (offset into note_audio)`)
      } else if (a.explainer_start_ms >= a.explainer_end_ms) {
        problems.push(`${at}: explainer_start_ms must be < explainer_end_ms`)
      }
      if (!Array.isArray(a.spans) || a.spans.length === 0) {
        problems.push(`${at}: note missing spans (which atoms it is about)`)
      } else {
        for (const s of a.spans) {
          if (!Number.isInteger(s) || s < 0 || s >= atoms.length) {
            problems.push(`${at}: span ${s} out of range`)
          } else if (!isFusible(atoms[s])) {
            problems.push(`${at}: span ${s} points at a non-fusible entry (notes annotate spoken atoms only)`)
          }
        }
      }
    }
  })

  if (fusibleCount === 0) {
    problems.push('atoms: no fusible entries (nothing carries clause audio)')
  }

  return problems
}

// ============================================================================
// The fusion rule — pairwise adjacent merge with leave-then-join odd handling
// ============================================================================

/** Merge adjacent pairs left-to-right; an odd run leaves its last group unpaired. */
const pairwiseMerge = (run: number[][]): { merged: number[][]; hasLeftover: boolean } => {
  const merged: number[][] = []
  let i = 0
  for (; i + 1 < run.length; i += 2) {
    merged.push([...run[i], ...run[i + 1]])
  }
  const hasLeftover = i < run.length
  if (hasLeftover) merged.push([...run[i]])
  return { merged, hasLeftover }
}

/**
 * Compute the fusion tiers for the given fusible atom indices.
 *
 * Returns one entry per tier; each tier is the OUTPUT grouping after that
 * tier's merges — arrays of atoms-array indices. The last tier is always a
 * single group (everything fused = the untouched take). A single fusible
 * atom yields zero tiers (nothing to fuse).
 *
 * Law (spec + R6): pairwise adjacent merge each tier; an odd count leaves
 * the last group un-fused that tier, and at the NEXT tier that leftover
 * joins its PRECEDING group (the 3-atom case: [a,b],[c] → [a,b,c]; the
 * 5-atom case: [a,b],[c,d],[e] → [a,b],[c,d,e] → all). Fully deterministic.
 */
export function computeFusionTiers(fusibleIdxs: number[]): number[][][] {
  const tiers: number[][][] = []
  let groups: number[][] = fusibleIdxs.map((i) => [i])
  /** Index (into `groups`) of the group left unpaired last tier, or null. */
  let leftoverIdx: number | null = null

  while (groups.length > 1) {
    let next: number[][]
    let nextLeftoverIdx: number | null = null

    if (leftoverIdx !== null && leftoverIdx > 0) {
      // The pending leftover joins its preceding group; the contiguous runs
      // either side of the join still pairwise-merge among themselves (R6).
      const before = groups.slice(0, leftoverIdx - 1)
      const joined = [...groups[leftoverIdx - 1], ...groups[leftoverIdx]]
      const after = groups.slice(leftoverIdx + 1)
      const beforeRes = pairwiseMerge(before)
      const afterRes = pairwiseMerge(after)
      next = [...beforeRes.merged, joined, ...afterRes.merged]
      // Rightmost unpaired group becomes the new tracked leftover (R6).
      if (afterRes.hasLeftover) {
        nextLeftoverIdx = next.length - 1
      } else if (beforeRes.hasLeftover) {
        nextLeftoverIdx = beforeRes.merged.length - 1
      }
    } else {
      // No pending join (or leftover at line start — degrades to plain
      // pairwise, R6): merge adjacent pairs across the whole line.
      const res = pairwiseMerge(groups)
      next = res.merged
      if (res.hasLeftover && next.length > 1) {
        nextLeftoverIdx = next.length - 1
      }
    }

    tiers.push(next)
    groups = next
    leftoverIdx = nextLeftoverIdx
  }

  return tiers
}

// ============================================================================
// Plan builder
// ============================================================================

/** Sorted, deduped copy of a note's spans (R1 index space). */
const normalizeSpans = (spans: number[] | undefined): number[] =>
  [...new Set(spans ?? [])].sort((x, y) => x - y)

/**
 * Build the full Stage-one ladder plan for one clause.
 *
 * @param atoms ordered per-sentence atom map (the Popty contract)
 * @param knobsPartial optional knob overrides, merged over DEFAULT_FUSION_KNOBS
 * @throws Error when validateFusionInput reports problems (R9)
 */
export function buildAtomFusionPlan(
  atoms: FusionAtom[],
  knobsPartial?: Partial<FusionKnobs>,
): AtomFusionPlan {
  const knobs = resolveFusionKnobs(knobsPartial)
  const problems = validateFusionInput(atoms, knobs)
  if (problems.length > 0) {
    throw new Error(`[atomFusion] invalid input: ${problems.join('; ')}`)
  }

  const fusibleAtomIdxs: number[] = []
  const teachableAtomIdxs: number[] = []
  atoms.forEach((a, i) => {
    if (isFusible(a)) fusibleAtomIdxs.push(i)
    if (a.kind === 'atom') teachableAtomIdxs.push(i)
  })

  // Notes, classified by normalized span count.
  const singleSpanNotes: Array<{ noteIdx: number; span: number }> = []
  const multiSpanNotes: Array<{ noteIdx: number; spans: number[] }> = []
  atoms.forEach((a, i) => {
    if (a.kind !== 'note') return
    const spans = normalizeSpans(a.spans)
    if (spans.length === 1) singleSpanNotes.push({ noteIdx: i, span: spans[0] })
    else multiSpanNotes.push({ noteIdx: i, spans })
  })

  const noteStep = (tier: PlanTier, noteIdx: number, spans: number[], mergedGroups?: number[][]): PlanStep => {
    const note = atoms[noteIdx]
    return {
      tier,
      play: {
        source: 'note_audio',
        sliceMs: [note.explainer_start_ms!, note.explainer_end_ms!],
        noteIdx,
      },
      screen: {
        highlightAtomIdxs: spans,
        ...(mergedGroups ? { mergedGroups } : {}),
        glossVisible: true,
      },
    }
  }

  const steps: PlanStep[] = []

  // --- 1) Orientation — the destination, heard once -----------------------
  steps.push({
    tier: 'orientation',
    play: { source: 'target_clause' },
    screen: { glossVisible: false },
  })

  // --- 2) Meet the atoms ----------------------------------------------------
  // First sweep: target slice → inventory explainer → echo, per teachable
  // atom, in clause order; single-span notes land immediately after the
  // entry they span (R2, R3).
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]
    if (a.kind === 'atom') {
      const slice: [number, number] = [a.target_start_ms!, a.target_end_ms!]
      const screen: PlanScreen = { highlightAtomIdxs: [i], glossVisible: true }
      steps.push({ tier: 'meet', play: { source: 'target_clause', sliceMs: slice }, screen: { ...screen } })
      steps.push({ tier: 'meet', play: { source: 'inventory_explainer', legoKey: a.lego_key }, screen: { ...screen } })
      steps.push({ tier: 'meet', play: { source: 'target_clause', sliceMs: slice }, screen: { ...screen } })
    }
    for (const n of singleSpanNotes) {
      if (n.span === i) steps.push(noteStep('meet', n.noteIdx, [n.span]))
    }
  }
  // Second, lighter sweep (scaffold fade): target + explainer, no echo, no
  // notes (R2). 'one-pass' skips it entirely.
  if (knobs.scaffoldFade === 'two-pass') {
    for (const i of teachableAtomIdxs) {
      const a = atoms[i]
      const slice: [number, number] = [a.target_start_ms!, a.target_end_ms!]
      const screen: PlanScreen = { highlightAtomIdxs: [i], glossVisible: true }
      steps.push({ tier: 'meet', play: { source: 'target_clause', sliceMs: slice }, screen: { ...screen } })
      steps.push({ tier: 'meet', play: { source: 'inventory_explainer', legoKey: a.lego_key }, screen: { ...screen } })
    }
  }

  // --- 3) Fuse — target-only tiers, gaps shrinking to the untouched take ---
  const tiers = computeFusionTiers(fusibleAtomIdxs)
  const fusionTierCount = tiers.length
  const firedNotes = new Set<number>()

  tiers.forEach((groups, t0) => {
    const tierNum = t0 + 1
    const tier: PlanTier = `fuse-${tierNum}`
    const mergedGroups = groups.map((g) => [...g])

    // Gap for this tier — literal curve index, clamped to the tail (R5).
    const gapMs = knobs.gapCurveMs[Math.min(t0, knobs.gapCurveMs.length - 1)]

    // Remaining seams = boundaries between this tier's output groups (R4).
    // The final tier has a single group → no seams → the untouched take.
    const gapInsertsMs: GapInsert[] = []
    for (let k = 0; k + 1 < groups.length; k++) {
      const followerFirstAtom = atoms[groups[k + 1][0]]
      gapInsertsMs.push({ atMs: followerFirstAtom.target_start_ms!, gapMs })
    }

    steps.push({
      tier,
      play: {
        source: 'target_clause',
        ...(gapInsertsMs.length > 0 ? { gapInsertsMs } : {}),
      },
      screen: { mergedGroups, glossVisible: false },
    })

    // Junction notes — fire at the FIRST tier where all spanned atoms share
    // a group, immediately after the take (R7). Each note fires once.
    for (const n of multiSpanNotes) {
      if (firedNotes.has(n.noteIdx)) continue
      const together = groups.some((g) => n.spans.every((s) => g.includes(s)))
      if (together) {
        firedNotes.add(n.noteIdx)
        steps.push(noteStep(tier, n.noteIdx, n.spans, mergedGroups.map((g) => [...g])))
      }
    }

    // Per-tier anchoring — re-hear the untouched clause after each non-final
    // tier (the final tier's take already IS the untouched clause, R8).
    if (knobs.anchoring === 'per-tier' && tierNum < fusionTierCount) {
      steps.push({
        tier,
        play: { source: 'target_clause' },
        screen: { mergedGroups: mergedGroups.map((g) => [...g]), glossVisible: false },
      })
    }
  })

  // --- 4) Arrive — the untouched take, then the holistic known meaning -----
  steps.push({
    tier: 'arrive',
    play: { source: 'target_clause' },
    screen: { glossVisible: false },
  })
  steps.push({
    tier: 'arrive',
    play: { source: 'known_clause' },
    screen: { glossVisible: true },
  })

  return { steps, fusionTierCount, fusibleAtomIdxs, teachableAtomIdxs }
}

// ============================================================================
// Thin reactive wrapper (the core stays pure)
// ============================================================================

const unwrap = <T,>(v: Ref<T> | T): T =>
  v && typeof v === 'object' && 'value' in (v as any) ? (v as Ref<T>).value : (v as T)

/**
 * Vue-flavoured convenience for the overlay integration: reactive atoms in,
 * reactive plan out. Null/empty atoms → plan null, errors [] (content not
 * loaded yet is not an error); invalid atoms → plan null, errors populated.
 */
export function usePodAtomFusion(
  atoms: Ref<FusionAtom[] | null | undefined> | FusionAtom[] | null | undefined,
  knobs?: Ref<Partial<FusionKnobs> | undefined> | Partial<FusionKnobs>,
): { plan: ComputedRef<AtomFusionPlan | null>; errors: ComputedRef<string[]> } {
  const errors = computed<string[]>(() => {
    const a = unwrap(atoms)
    if (!a || a.length === 0) return []
    return validateFusionInput(a, resolveFusionKnobs(unwrap(knobs)))
  })

  const plan = computed<AtomFusionPlan | null>(() => {
    const a = unwrap(atoms)
    if (!a || a.length === 0) return null
    if (errors.value.length > 0) return null
    return buildAtomFusionPlan(a, unwrap(knobs))
  })

  return { plan, errors }
}
