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
 * The five tiers (keys come straight from algorithm_config['stage0'].tiers):
 *   1. explainer   — whole phrase (chunked atoms) → translation → per-atom
 *                    [target + "means <gloss>"] → whole phrase again. The slow,
 *                    clear first exposure. The smooth natural take never plays
 *                    here; it's the destination (tier 5).
 *   2. translation — each atom: target + "means <gloss>". No bookend, no repeats.
 *   3. pairs200    — all atom targets fused at `gaps.fusionPairs` (≈200ms) → translation.
 *   4. pairs0      — all atom targets fused at 0ms (near-natural) → translation.
 *   5. intention   — the whole natural take → translation. The arrival.
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
    { key: 'explainer', visits: 1, fusionGap: null, granularity: 'atoms', targetRepeats: 0 },
    { key: 'translation', visits: 1, fusionGap: null, granularity: 'atoms', targetRepeats: 0 },
    { key: 'pairs200', visits: 1, fusionGap: null, granularity: 'pairs', targetRepeats: 0 },
    { key: 'pairs0', visits: 1, fusionGap: 0, granularity: 'pairs', targetRepeats: 0 },
    { key: 'intention', visits: 1, fusionGap: null, granularity: 'intention', targetRepeats: 0 },
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

  // ── TIER 1: explainer (chunked whole-part-whole bookend) ──────────────────
  if (tier.key === 'explainer') {
    const chunkGap = tier.fusionGap ?? g.fusionPairs
    const pushChunkedWhole = () => {
      withTarget.forEach((a, i) => {
        clip(a.targetClipId as string, 'target', a.targetSurface)
        if (i < withTarget.length - 1) gap(chunkGap, 'fusion')
      })
    }
    // OPENER: whole phrase (chunked) → translation (meaning) BEFORE the breakdown
    pushChunkedWhole()
    if (clips.translationId) {
      gap(g.targetMeaning, 'tm')
      clip(clips.translationId, 'translation', clips.knownText)
    }
    gap(g.betweenChunks, 'chunk')
    // BREAKDOWNS: per atom — target + merged "means <gloss>"
    atoms.forEach((a, j) => {
      if (!a.targetClipId) return
      clip(a.targetClipId, 'target', a.targetSurface)
      if (a.meansGlossClipId) {
        gap(g.beforeMeans, 'beforeMeans')
        clip(a.meansGlossClipId, 'meansGloss', `means ${a.gloss}`)
      }
      if (j < atoms.length - 1) gap(g.betweenChunks, 'chunk')
    })
    // CLOSER: the whole phrase again (chunked) — solidify
    gap(g.betweenChunks, 'chunk')
    pushChunkedWhole()
    trimTrailingGap()
    return seq
  }

  // ── TIER 2: translation (each atom: target + "means <gloss>") ─────────────
  if (tier.granularity === 'atoms') {
    atoms.forEach((a, j) => {
      if (!a.targetClipId) return
      clip(a.targetClipId, 'target', a.targetSurface)
      if (a.meansGlossClipId) {
        gap(g.beforeMeans, 'beforeMeans')
        clip(a.meansGlossClipId, 'meansGloss', `means ${a.gloss}`)
      }
      if (j < atoms.length - 1) gap(g.betweenChunks, 'chunk')
    })
    trimTrailingGap()
    return seq
  }

  // ── TIERS 3 & 4: pairs (atoms fused, then translation) ────────────────────
  if (tier.granularity === 'pairs') {
    const fuse = tier.fusionGap ?? g.fusionPairs
    withTarget.forEach((a, i) => {
      clip(a.targetClipId as string, 'target', a.targetSurface)
      if (i < withTarget.length - 1) gap(fuse, 'fusion')
    })
    if (clips.translationId && seq.length) {
      gap(g.targetMeaning, 'tm')
      clip(clips.translationId, 'translation', clips.knownText)
    }
    trimTrailingGap()
    return seq
  }

  // ── TIER 5: intention (whole natural take → translation) ──────────────────
  if (tier.granularity === 'intention') {
    if (clips.wholeTakeId) clip(clips.wholeTakeId, 'wholeTake', clips.targetText)
    if (clips.translationId) {
      if (seq.length) gap(g.targetMeaning, 'tm')
      clip(clips.translationId, 'translation', clips.knownText)
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
