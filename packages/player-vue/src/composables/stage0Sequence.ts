/**
 * stage0Sequence.ts — pure (no Vue) composer for the Stage-0 pod-explainer ladder.
 *
 * This is the app-side port of the tuner's `stageSequence()` (Popty
 * public/stage0-tuner.html, the "whole-part-whole-v1" model, Tom 2026-06-15).
 * Given a sentence's RESOLVED atoms (each already mapped to its DB clip ids) +
 * the whole-take / translation clips + the global `stage0` config, it emits an
 * ordered list of clip/gap events for any one tier, or the whole 5-tier ladder.
 *
 * FLAT-MODEL NOTE: the DB `atom_map` is flattened (no clause/intention grouping),
 * so this composer treats the whole sentence as a single intention. Single-clause
 * sentences are identical to the tuner; multi-clause sentences lose only per-clause
 * pacing in the pairs/intention tiers (an additive enrichment for later — it would
 * require persisting intention boundaries into atom_map; no re-render needed).
 *
 * The ladder (keys come straight from algorithm_config['stage0'].tiers):
 *   • explainer (×2) — whole phrase (chunked atoms) → translation → per-atom
 *                      [target + "means <gloss>"] → whole phrase again. The slow
 *                      breakdown — runs TWICE, and is the ONLY place we go below
 *                      the intention layer. The smooth natural take never plays
 *                      here; it's the destination.
 *   • pairs200       — atom targets fused at `gaps.fusionPairs` (≈200ms) →
 *                      translation → the same fused targets ×`targetRepeats`.
 *                      Fuses atoms back UP into the intention.
 *   • pairs0         — atom targets fused at 0ms (near-natural) → translation →
 *                      the same fused targets ×`targetRepeats`.
 *   • intention      — whole natural take → translation → whole take ×`targetRepeats`.
 *
 * `targetRepeats` (per tier) = how many target reps play AFTER the known, so a
 * tier never has to end on the known language. Parametrised, not hardcoded (Tom
 * 2026-06-22: "parametrise everything"): DEFAULT_STAGE0 ships 1 (symmetric —
 * identical target before and after); the stage0 tuner / DB config overwrites it
 * exactly like the pod-stage params. 0 reproduces the old ends-on-known shape.
 *
 * RULE (Tom 2026-06-20): apart from the explainer breakdown, never play anything
 * smaller than an intention. The old 'translation' tier (bare atoms, separated,
 * then one lump of whole-translation) broke this rule and was removed.
 */

// ── config shapes (mirror algorithm_config['stage0'] exactly) ───────────────
export interface Stage0Gaps {
  afterCue: number
  beforeMeans: number
  fusionPairs: number
  betweenChunks: number
  targetMeaning: number
  betweenRepeats: number
  betweenIntentions: number
}

export type Stage0Granularity = 'atoms' | 'pairs' | 'intention'

export interface Stage0Tier {
  key: string // 'explainer' | 'translation' | 'pairs200' | 'pairs0' | 'intention'
  visits: number
  fusionGap: number | null
  granularity: Stage0Granularity
  targetRepeats: number
}

export interface Stage0Config {
  model: string
  gaps: Stage0Gaps
  tiers: Stage0Tier[]
  playbackSpeed: number
}

/** Default mirrors the live DB row so the app degrades gracefully offline. */
export const DEFAULT_STAGE0: Stage0Config = {
  model: 'whole-part-whole-v1',
  gaps: {
    afterCue: 500,
    beforeMeans: 0,
    fusionPairs: 200,
    betweenChunks: 1000,
    targetMeaning: 500,
    betweenRepeats: 600,
    betweenIntentions: 500,
  },
  tiers: [
    // 4-movement breakdown (Tom 2026-06-27): the explainer tier now does
    // whole→known→per-chunk→whole on its own, ONCE. The old pairs/intention
    // tiers + visits:2 drilled every chunk ~7x (and names absurdly) — removed.
    { key: 'explainer', visits: 1, fusionGap: null, granularity: 'atoms', targetRepeats: 0 },
  ],
  playbackSpeed: 1,
}

// ── inputs the composer plays from ──────────────────────────────────────────
/** One atom of a sentence, already resolved to its DB clip ids. */
export interface ResolvedAtom {
  /** the surface target string (e.g. "Muy bien") */
  targetSurface: string
  /** the English gloss (e.g. "very well") */
  gloss: string
  /** course_audio id of the "[atom] <target>" clip; null if not decomposed/persisted */
  targetClipId: string | null
  /** pod_legos.explainer_audio_id — the merged "<target> means <gloss>" clip; null if absent */
  meansGlossClipId: string | null
}

export interface SentenceClips {
  /** listening_pod_sentences.target_audio_id — the smooth whole-sentence take */
  wholeTakeId: string | null
  /** listening_pod_sentences.known_audio_id — the English translation */
  translationId: string | null
  targetText: string
  knownText: string
}

/** One entry of listening_pod_sentences.atom_map (ordered). */
export interface AtomMapEntry {
  lego_key: string
  kind: 'atom' | 'passthrough' | 'note'
  gloss: string
  target_surface: string
  target_start_ms?: number | null
  target_end_ms?: number | null
}

/** Minimal sentence-row shape clipsFromRow reads (atom_map not needed here). */
export interface PodSentenceLike {
  target_audio_id: string | null
  known_audio_id: string | null
  target_text: string
  known_text: string
}

/**
 * Resolve a sentence's atom_map to playable ResolvedAtoms, joining two
 * course-wide lookup maps:
 *   - meansGlossByLego: lego_key → pod_legos.explainer_audio_id ("means <gloss>")
 *   - targetClipBySurface: target_surface → course_audio "[atom] <target>" id
 * Includes atom + passthrough entries in order (passthrough usually has no
 * target clip and is skipped cleanly by the sequencer).
 */
/**
 * Normalise an atom surface for "[atom] <surface>" clip lookup. Case-insensitive
 * (a sentence-initial "Come" must resolve the same slice as a mid-sentence
 * "come" — single-word TTS sounds identical) but ACCENT-preserving (so "È"=is
 * stays distinct from "e"=and). MUST be applied identically where the map is
 * built (loadStage0ClipMaps) and here, or ~10% of atoms silently drop.
 */
export const normSurface = (s: string): string => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()

export function resolveAtoms(
  atomMap: AtomMapEntry[] | null | undefined,
  meansGlossByLego: Map<string, string>,
  targetClipBySurface: Map<string, string>,
): ResolvedAtom[] {
  return (atomMap || [])
    .filter((e) => e.kind === 'atom' || e.kind === 'passthrough')
    .map((e) => ({
      targetSurface: e.target_surface,
      gloss: e.gloss,
      targetClipId: targetClipBySurface.get(normSurface(e.target_surface)) ?? null,
      meansGlossClipId: meansGlossByLego.get(e.lego_key) ?? null,
    }))
}

/** Pull the whole-take / translation clips off a sentence row. */
export function clipsFromRow(row: PodSentenceLike): SentenceClips {
  return {
    wholeTakeId: row.target_audio_id,
    translationId: row.known_audio_id,
    targetText: row.target_text,
    knownText: row.known_text,
  }
}

export type Stage0Role =
  | 'target'
  | 'meaning'
  | 'meansGloss'
  | 'wholeTake'
  | 'translation'

export type Stage0Event =
  | {
      type: 'clip'
      audioId: string
      role: Stage0Role
      label: string
      speed: number
      tier: string
    }
  | { type: 'gap'; ms: number; kind: string; tier: string }

// ── the composer ────────────────────────────────────────────────────────────

/**
 * Build the ordered event list for ONE tier. Atoms without a required clip are
 * skipped (and never emit a dangling gap), so a partly-decomposed sentence still
 * plays cleanly. Returns [] if the tier has nothing playable.
 */
export function tierSequence(
  tier: Stage0Tier,
  atoms: ResolvedAtom[],
  clips: SentenceClips,
  cfg: Stage0Config,
): Stage0Event[] {
  const g = cfg.gaps
  const speed = cfg.playbackSpeed || 1
  const seq: Stage0Event[] = []
  const clip = (audioId: string, role: Stage0Role, label: string) =>
    seq.push({ type: 'clip', audioId, role, label, speed, tier: tier.key })
  const gap = (ms: number, kind: string) => {
    if (ms > 0) seq.push({ type: 'gap', ms, kind, tier: tier.key })
  }
  /** drop a trailing gap (e.g. when the last clip was skipped) */
  const trimTrailingGap = () => {
    while (seq.length && seq[seq.length - 1].type === 'gap') seq.pop()
  }

  const withTarget = atoms.filter((a) => a.targetClipId)

  // ── TIER 1: explainer — the 4-MOVEMENT breakdown (Tom 2026-06-27) ─────────
  // whole target → whole known → per-MEANINGFUL-chunk (target → "means X") →
  // whole target. Each chunk heard ONCE. A chunk with no gloss (a name) is
  // NEVER drilled on its own — it's heard only inside the whole takes, in
  // context. (Replaces the old chunked whole-part-whole ×2 + pairs/intention,
  // which drilled names absurdly.)
  if (tier.key === 'explainer') {
    const meaningful = atoms.filter((a) => a.targetClipId && a.meansGlossClipId)
    // 1 · whole target
    if (clips.wholeTakeId) clip(clips.wholeTakeId, 'wholeTake', clips.targetText)
    // 2 · whole known (the meaning)
    if (clips.translationId) {
      if (seq.length) gap(g.targetMeaning, 'tm')
      clip(clips.translationId, 'translation', clips.knownText)
    }
    // 3 · per meaningful chunk: target → "means X"
    if (meaningful.length) {
      gap(g.betweenChunks, 'chunk')
      meaningful.forEach((a, j) => {
        clip(a.targetClipId as string, 'target', a.targetSurface)
        gap(g.beforeMeans, 'beforeMeans')
        clip(a.meansGlossClipId as string, 'meansGloss', `means ${a.gloss}`)
        if (j < meaningful.length - 1) gap(g.betweenChunks, 'chunk')
      })
    }
    // 4 · whole target (wrap, now understood)
    if (clips.wholeTakeId) {
      gap(g.betweenChunks, 'chunk')
      clip(clips.wholeTakeId, 'wholeTake', clips.targetText)
    }
    trimTrailingGap()
    return seq
  }

  // ── TIER 2: translation — the atoms (clearly separated), then the WHOLE
  // translation. NO per-atom "means" gloss: in the tuner only the explainer
  // tier has connector:true. (Tom: "tier-2 just has translation, no meaning".)
  if (tier.granularity === 'atoms') {
    withTarget.forEach((a, i) => {
      clip(a.targetClipId as string, 'target', a.targetSurface)
      if (i < withTarget.length - 1) gap(g.betweenChunks, 'chunk')
    })
    if (clips.translationId && seq.length) {
      gap(g.targetMeaning, 'tm')
      clip(clips.translationId, 'translation', clips.knownText)
    }
    trimTrailingGap()
    return seq
  }

  // ── TIERS 3 & 4: pairs (fused targets → translation → fused targets ×N) ────
  // The closing target(s) AFTER the known are PARAMETRISED by tier.targetRepeats
  // (Tom 2026-06-22). DEFAULT_STAGE0 ships 1; the stage0 tuner / DB config
  // overwrites it like every other pod-stage param. 0 = ends on the known
  // (legacy); 1 = symmetric (identical target before AND after the known); 2+ =
  // extra reps. Each rep is the SAME fused target that opened the tier —
  // comprehensible input, never leaving the learner on the known language.
  if (tier.granularity === 'pairs') {
    const fuse = tier.fusionGap ?? g.fusionPairs
    const pushFusedTarget = () => {
      withTarget.forEach((a, i) => {
        clip(a.targetClipId as string, 'target', a.targetSurface)
        if (i < withTarget.length - 1) gap(fuse, 'fusion')
      })
    }
    pushFusedTarget()
    if (clips.translationId && seq.length) {
      gap(g.targetMeaning, 'tm')
      clip(clips.translationId, 'translation', clips.knownText)
      for (let r = 0; r < (tier.targetRepeats || 0); r++) {
        gap(g.targetMeaning, 'tm')
        pushFusedTarget() // identical target close(s), AFTER the known
      }
    }
    trimTrailingGap()
    return seq
  }

  // ── TIER 5: intention (whole take → translation → whole take ×N) ───────────
  // Closing target(s) parametrised by tier.targetRepeats (default 1, overwritten
  // by the stage0 tuner / DB). Each rep is the same whole take that opened it.
  if (tier.granularity === 'intention') {
    if (clips.wholeTakeId) clip(clips.wholeTakeId, 'wholeTake', clips.targetText)
    if (clips.translationId) {
      if (seq.length) gap(g.targetMeaning, 'tm')
      clip(clips.translationId, 'translation', clips.knownText)
      if (clips.wholeTakeId) {
        for (let r = 0; r < (tier.targetRepeats || 0); r++) {
          gap(g.targetMeaning, 'tm')
          clip(clips.wholeTakeId, 'wholeTake', clips.targetText)
        }
      }
    }
    trimTrailingGap()
    return seq
  }

  return seq
}

/**
 * Build the full ladder: every enabled tier, in order, separated by a
 * betweenIntentions "stage" gap, each tier repeated `visits` times.
 */
export function buildLadder(
  atoms: ResolvedAtom[],
  clips: SentenceClips,
  cfg: Stage0Config,
): Stage0Event[] {
  const out: Stage0Event[] = []
  for (const tier of cfg.tiers) {
    const visits = Math.max(1, tier.visits || 1)
    for (let v = 0; v < visits; v++) {
      const part = tierSequence(tier, atoms, clips, cfg)
      if (!part.length) continue
      if (out.length) out.push({ type: 'gap', ms: cfg.gaps.betweenIntentions, kind: 'stage', tier: tier.key })
      out.push(...part)
    }
  }
  return out
}

/** Total wall-clock of a sequence given a clip-duration lookup (ms). */
export function sequenceDurationMs(
  seq: Stage0Event[],
  durMs: (audioId: string) => number,
): number {
  let t = 0
  for (const e of seq) {
    if (e.type === 'gap') t += e.ms
    else t += durMs(e.audioId) / (e.speed || 1)
  }
  return t
}

/** A clip ready to schedule: audio + the gap to wait AFTER it (if any). */
export interface TimedPlay {
  audioId: string
  role: Stage0Role
  label: string
  speed: number
  /** ms to wait after this clip. Undefined on the FINAL clip — the caller
   *  supplies the inter-unit gap (e.g. the between-phrases gap to the next
   *  sentence) so Stage-0 doesn't have to know about the surrounding lap. */
  gapAfterMs?: number
}

/**
 * Fold a clip/gap event list into clips that each carry their trailing gap.
 * Consecutive gaps are summed onto the preceding clip; the final clip omits
 * gapAfterMs. Used to drive a per-clip scheduler from a tier's events.
 */
export function foldEventsToPlays(events: Stage0Event[]): TimedPlay[] {
  const out: TimedPlay[] = []
  for (let k = 0; k < events.length; k++) {
    const e = events[k]
    if (e.type !== 'clip') continue
    let gapAfter = 0
    let hasNextClip = false
    for (let m = k + 1; m < events.length; m++) {
      const nx = events[m]
      if (nx.type === 'gap') gapAfter += nx.ms
      else {
        hasNextClip = true
        break
      }
    }
    out.push({
      audioId: e.audioId,
      role: e.role,
      label: e.label,
      speed: e.speed,
      ...(hasNextClip ? { gapAfterMs: gapAfter } : {}),
    })
  }
  return out
}

/**
 * Map a sentence's view count (1-based "alive") to where it sits in the
 * prepended ladder: its first `tierCount` views are Stage-0 tiers (one per
 * view), and everything after maps to the existing stages with the entry
 * shifted by `tierCount` (so view tierCount+1 == Stage 1).
 */
export function stage0ViewFor(
  alive: number,
  tierCount: number,
): { phase: 'stage0'; tierIndex: number } | { phase: 'main'; shift: number } {
  if (tierCount > 0 && alive >= 1 && alive <= tierCount) {
    return { phase: 'stage0', tierIndex: alive - 1 }
  }
  return { phase: 'main', shift: Math.max(0, tierCount) }
}
