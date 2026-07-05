/**
 * @ssi/core/pods — the pure pod composition engine.
 *
 * Canonical home for the Stage-0 breakdown ladder (stage0Sequence) and the
 * whole-sentence stage composer (podStageComposition). Framework-agnostic and
 * shared by BOTH the player (main-flow delivery) and the dashboard Pod Lab, so
 * the two assemble pods from ONE engine — there is deliberately no second,
 * drifting copy (the root cause of the 2026-06 listening-vs-main-flow mismatch).
 */
export * from './stage0Sequence'
export * from './podStageComposition'
export * from './fusionDrill'
