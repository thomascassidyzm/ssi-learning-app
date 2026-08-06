/**
 * Cycle / Round — pure data shapes for one 4-phase learning cycle and the
 * round that groups them. Canonical home as of the bundle-cutover Phase 1
 * move (docs/bundle-cutover-design.md §3): `generateScript` lives in
 * `@ssi/core` and must not import from `player-vue`, so these interfaces —
 * previously declared inline in `player-vue/src/playback/SimplePlayer.ts` —
 * moved here. `SimplePlayer.ts` re-exports `Cycle`/`Round` from this module
 * so every existing `from '../playback/SimplePlayer'` import keeps working
 * unchanged.
 */
export interface Cycle {
  id: string
  /**
   * Source ScriptItem type. Optional — older cycles in cache may not carry it.
   * Used by the UI to subtly cue the skip button during listening cycles
   * (listen_intro/listening/pod/listen_outro) without changing button behaviour.
   */
  type?: string
  known: { text: string; audioUrl: string }
  target: { text: string; textNative?: string; voice1Url: string; voice2Url: string }
  pauseDuration?: number // ms — set by toSimpleRounds formula
  lingerMs?: number // ms — extra hold after voice2 (intro/debut: lets learner read tiles)
  legoId?: string // The LEGO this cycle is practising
  seedId?: string // S#### seed prefix — used by telemetry/logEvent
  componentLegoIds?: string[]
  componentLegoTexts?: string[]
  componentLegoTextsNative?: string[]
  /** Authoritative content-level tiling from the backend (Popty), served
   * verbatim on course_practice_phrases.decomposition. When present the player
   * renders these blocks directly instead of re-deriving by runtime alignment. */
  decomposition?: Array<{ legoId: string | null; target: string; known: string; isGhost: boolean; isSalient?: boolean }>
  /** Authored display tiles from course_practice_phrases.display_tiling —
   * {n: native, r: roman, salient} per tile, built and validated in Popty.
   * When present the player renders these tiles directly (native primary,
   * roman ruby) and skips the runtime segmenter entirely. */
  displayTiling?: Array<{ n: string; r: string; salient?: boolean }>

  /** M-LEGO component breakdown for visual display */
  components?: Array<{ known: string; target: string }>
  componentsNative?: Array<{ known: string; target: string }>
  /** Listening phase: playback speed multiplier (1.0 = normal, 2.0 = double) */
  playbackSpeed?: number
  /** Raw target audio durations (ms). Kept on the cycle so runtime overrides
   * (e.g. the active learning mode) can recompute pauseDuration with a
   * different formula instead of just scaling the baked value. */
  target1DurationMs?: number
  target2DurationMs?: number
  /** True for cycles that carry AT MOST one audio track (listening / pod /
   * bookend / drained-seed-sandwich sub-cycles) — the other 3-phase gaps are
   * by design, not missing data. Lets SimplePlayer suppress its "no audio,
   * skipping" warnings without switch-casing on `type` string values. */
  singleAudio?: boolean
}

export interface Round {
  roundNumber: number
  legoId: string
  seedId: string
  /** Canonical LEGO target text (from intro item — never inferred from cycles) */
  legoTargetText?: string
  /** Native script variant of legoTargetText */
  legoTargetTextNative?: string
  /** Canonical LEGO known text (from intro item) */
  legoKnownText?: string
  cycles: Cycle[]
}
