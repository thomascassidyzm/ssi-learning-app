/**
 * @ssi/core/text — text measurement primitives shared by the player and the
 * script generator. Currently: the per-language syllable-counting registry
 * (a verbatim port of Popty's tools/lib/syllable-counters.cjs — see the
 * duplication-debt header in syllables.ts), and bidi direction detection for
 * RTL target text (direction.ts).
 */
export * from './syllables'
export * from './direction'
