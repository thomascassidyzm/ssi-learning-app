/**
 * @ssi/core/pods — the pure pod composition engine.
 *
 * Canonical home for the whole-sentence stage composer (podStageComposition),
 * the pairwise fusion ladder for Listening Mode Drill (fusionDrill), and turn
 * grouping for the always-visible whole-turn display (podTurns).
 * Framework-agnostic and shared by BOTH the player (main-flow delivery) and
 * the dashboard Pod Lab, so the two assemble pods from ONE engine — there is
 * deliberately no second, drifting copy (the root cause of the 2026-06
 * listening-vs-main-flow mismatch).
 *
 * stage0Sequence's AUDIO ladder (tierSequence/buildLadder/DEFAULT_STAGE0) is
 * retired from the main-flow pod path (2026-07-14, Tom + Aran) — the atom-map
 * breakdown a sentence used to get from repeated AUDIO reps is now an
 * ALWAYS-VISIBLE LEGO-tile display (player-vue's PodTurnDisplay.vue, reusing
 * LegoAssembly), never played. stage0Sequence's atom-resolution types
 * (AtomMapEntry/ResolvedAtom/resolveAtoms) and its sequencing functions stay —
 * the admin-only Pod stage auditioner (/admin/pod-auditioner) still uses them
 * to preview/tune Stage-0 timing for content authoring, and nothing about
 * that tool changed here.
 */
export * from './stage0Sequence'
export * from './podStageComposition'
export * from './fusionDrill'
export * from './podTurns'
export * from './podCohorts'
