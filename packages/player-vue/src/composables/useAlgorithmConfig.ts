/**
 * useAlgorithmConfig
 *
 * Fetches and caches admin-tweakable algorithm parameters from Supabase.
 * Follows "everything is a parameter" philosophy - no hardcoded algorithm values.
 *
 * Usage:
 *   const { getConfig, easyConfig, fastConfig, isLoaded } = useAlgorithmConfig(supabase)
 *   await loadConfigs()
 *   const pauseMs = fastConfig.value.pause_base_ms
 */

import { ref, computed, type Ref } from 'vue'
import { type Stage0Config, DEFAULT_STAGE0 } from '@ssi/core/pods'
import { type RatePolicyBounds, DEFAULT_RATE_POLICY_BOUNDS } from '@ssi/core'
import { countSyllables, hasSyllableCounter, syllableLangOf } from '@ssi/core/text'
import { DEFAULT_REPEATED_CYCLE_TYPES, MAX_PHRASE_REPEAT_COUNT } from '../playback/modeRenderRules'
import {
  type ListeningRampStep,
  type ListeningSlot,
  type ListeningSpeedSource,
  type ListeningBeltCeiling,
  DEFAULT_EASY_BELT_CEILINGS,
  DEFAULT_EASY_LISTENING_RAMP,
  DEFAULT_FAST_BELT_CEILINGS,
  DEFAULT_FAST_LISTENING_RAMP,
  DEFAULT_LISTENING_PATTERN,
  DEFAULT_LISTENING_SPEED_SOURCE,
  LISTENING_SPEED_CEILING,
  normalizeBeltCeilings,
  normalizeListeningRamp,
  resolveListeningPattern,
} from '../playback/listeningExposureRamp'
import {
  type EncouragementTaperConfig,
  DEFAULT_ENCOURAGEMENT_TAPER,
} from '../services/MetaCommentaryService'

// Type definitions for algorithm configs
export interface ModeConfig {
  playback_speed: number      // 1.0 = normal, 1.25 = 25% faster
  pause_base_ms: number       // Base pause before multiplier
  pause_multiplier: number    // Multiplied by target audio duration
  min_pause_ms: number        // Floor for pause duration
  max_pause_ms: number        // Ceiling for pause duration
  /** Reference duration the pause scales with (default 'sum' = legacy t1+t2).
   *  See computePauseDuration.ts. */
  pause_reference?: 'avg' | 'target1' | 'sum'
  /** LEGACY knee model — reference (ms) past which the gentler tail kicks in. */
  pause_knee_ms?: number
  /** LEGACY knee model — slope beyond the knee (default = pause_multiplier). */
  pause_tail_multiplier?: number
  /** Boot / reaction floor (ms) — length-independent spin-up. See
   *  computePauseDuration.ts (boot + assembly model). */
  pause_boot_ms?: number
  /** Reference (ms) below which there is no assembly cost (short = pure boot). */
  pause_assembly_threshold_ms?: number
  /** Linear assembly per ms of reference past the threshold. */
  pause_assembly_lin?: number
  /** Quadratic assembly (ms per second² past the threshold) — super-linear
   *  long-phrase cost. 0 ⇒ a straight assembly ramp. */
  pause_assembly_quad?: number
  /** Boot multiplier at Green belt (White=1.0; interpolated). <1 shrinks
   *  short-phrase gaps as the learner advances. */
  pause_belt_boot?: number
  /** Assembly multiplier at Green belt (White=1.0). Keep nearer 1.0 than
   *  belt_boot so long phrases shorten less than short ones across belts. */
  pause_belt_assembly?: number
  /**
   * Extra silence (ms) held AFTER voice2, before the next cycle's prompt —
   * "to stop the next cycle just coming in and taking over" (Tom, 2026-08-07).
   * Voice2 is the phase carrying the target text on screen, so the same gap
   * also leaves that text up for longer. Easy holds 1s; Fast holds none.
   * Absent / 0 ⇒ the historic behaviour (next cycle starts immediately).
   */
  post_voice2_gap_ms?: number
  spaced_rep_fraction: number // 1.0 = full, 0.33 = skip 2/3
  debut_phrases_fraction: number // 1.0 = all, 0.5 = half
  skip_voice2: boolean        // Skip second target voice?
  /**
   * RETIRED as a mode input (Tom, 2026-08-08): "exactly the same script, but
   * with different rules". Easy and Fast now share ONE generated script, so
   * nothing here may reshape it per mode — the player builds the script from
   * the GLOBAL `script_shape` row alone. Both live rows carry `{}`, so nothing
   * changed underneath anyone.
   *
   * The field stays readable rather than being dropped (no migration, no lost
   * rows), and `resolveScriptShape` stays as the one merge rule for any future
   * NON-mode overlay. Do not wire it back to `learningMode`.
   */
  scriptShape?: Partial<ScriptShapeConfig>
  /**
   * RETIRED as a mode input (Tom, 2026-08-08) — see `scriptShape` above. A
   * character cap on the phrase POOL is generation-time by nature, so it
   * cannot be part of a mode that must switch live. Easy's long phrases are
   * now passed over at PLAY time instead (`reviewMaxKnownSyllables`, applied
   * by playback/modeRenderRules.ts), which is one rule where there were three
   * and lands on the very next cycle.
   *
   * `capPhrasesByLength()` remains the one place the rule lives for any
   * non-mode caller. The row stays readable; the player passes 1.0 (uncapped)
   * for every learner.
   */
  maxPhraseLengthFraction?: number
  /**
   * How many times each practice cycle plays, back to back — "in EASY mode,
   * double up every phrase, every BLD, every USE, every REVIEW, every
   * CONSOLIDATE" (Tom, 2026-08-07). Easy ships 2; Fast ships 1.
   *
   * HARD CEILING OF 2, from Tom's rule rather than from taste: "we do NOT ever
   * want to repeat exactly the same phrase more than 2x - a phrase repeated 3x
   * would drive people nuts, but doubled up is perfect". A row asking for 3 is
   * clamped to 2 and warns. Absent / ≤1 ⇒ no repetition at all.
   */
  phraseRepeatCount?: number
  /**
   * WHICH cycle types `phraseRepeatCount` applies to. Default is the four Tom
   * named — BLD, REVIEW, USE and CONSOLIDATE, which are `build`, `spaced_rep`
   * and `use` in script terms. The INTRO and bare-LEGO debut are absent by his
   * ruling ("of course not - the intro LEGO and not the LEGO alone"); adding
   * them here is a config decision, not a code change.
   *
   * SEED-PHASE production reviews are never repeated whatever this says — that
   * sandwich is already several cycles of one sentence, so repeating it would
   * breach the never-more-than-twice rule. Structural, not a setting.
   */
  repeatedCycleTypes?: string[]
  /**
   * RETIRED as a mode input (Tom, 2026-08-08) — see `scriptShape` above. With
   * no per-mode character cap left to bypass, there is nothing for Easy to opt
   * out of at generation time. Tom's underlying ruling — "no filtering on BLD
   * phrases" (2026-08-07) — is now carried by the play-time skip, which never
   * touches a BUILD or debut cycle (LENGTH_SKIPPABLE_CYCLE_TYPES).
   */
  filterBuildPhrases?: boolean
  /**
   * PLAY-TIME ceiling on a practice cycle's KNOWN-language syllables — the
   * "skip" half of Easy (Tom, 2026-08-08: "certain phrases - the longest ones
   * are skipped in easy mode. Anything greater than x syllables. Set as
   * default 15 but it could change in admin configs").
   *
   * It counts the KNOWN side — the prompt the learner hears in their own
   * language — not the target: an earlier flat target-syllable cap counted the
   * wrong side of the pair. It is applied at the cycle boundary by
   * `playback/modeRenderRules.ts`, so changing mode mid-session changes what
   * the very next cycle does, with no regeneration.
   *
   * REVIEW and USE/CONSOLIDATE cycles only. BUILD, the debut, the intro and
   * every listening/pod/bookend cycle are exempt. A course whose known
   * language has no registered syllable counter is inert and says so — an
   * unmeasurable cycle always plays.
   *
   * Absent / ≤0 ⇒ no skip, which is Fast's value. Easy ships 15, from the DB
   * row, so retuning by ear is a Supabase edit rather than a deploy.
   */
  reviewMaxKnownSyllables?: number
  /**
   * RETIRED (Tom, 2026-08-08): the skip is course-wide with no round cutoff —
   * "anything greater than x syllables", with no condition attached. The row
   * stays readable so no migration is needed; nothing reads it.
   *
   * Historic note — last course round on which `reviewMaxKnownSyllables`
   * applied. From the next round the filter simply came off — nothing is backlogged and
   * nothing cascades. Tom, 2026-08-07: "the whole idea of you've got a
   * cascade, you've got a wall, once you get to 100 and 101, all these space
   * repetitions is complete nonsense, makes no difference at all", because
   * "it's the LEGO that you are practicing" and the phrase carrying it need
   * never have been met before. Easy ships 100.
   */
  reviewSyllableFilterMaxRound?: number
  /**
   * LISTENING speed ramp for this mode, over a phrase's EXPOSURES (Tom,
   * 2026-08-07): "it might be 0.8. Or maybe even Notepoint. Seven, the very
   * first time, and it might be 0.8, then it might stay on 0.8 for a few
   * times, then it might go up to one, never more than one, depending on what
   * mode we're in. Fast can probably start at the regular speed."
   *
   * A step table: `[{speed, plays}, …]`, walked by exposure count, last step
   * terminal. ALL four slots of a phrase — including the KNOWN-language one —
   * play at the step's speed, so a phrase is internally uniform.
   *
   * Easy ships 0.7 ×1 → 0.8 ×4 → 1.0 for ever; Fast ships a single 1.0 step.
   * 1.0 is a HARD ceiling enforced in code (LISTENING_SPEED_CEILING), not by
   * these values — a DB row asking for 1.5 still plays at 1.0.
   *
   * Absent / malformed ⇒ the shipped ramp for that mode (never "no ramp":
   * that would hand a beginner full speed, which is the bug this fixes).
   */
  listeningSpeedRamp?: ListeningRampStep[]
  /**
   * BELT CEILING table for listening in this mode — Tom, 2026-08-07 23:56Z,
   * correcting the exposure-only reading that shipped first: "for Easy the BELT
   * TABLE is authoritative... 0.8x for white/yellow belt, 0.9x for orange/green,
   * 1.0x for blue and beyond, NEVER above 1.0. The per-exposure ramp applies
   * UNDERNEATH the belt ceiling."
   *
   * So the two ramps COMPOSE rather than compete: the belt rung is the maximum
   * for that learner, and `listeningSpeedRamp` is what approaches it from below
   * on early hearings. A white-belt Easy learner never exceeds 0.8x however
   * many times they have heard the phrase.
   *
   * Keyed on the LEARNER's position, not the replayed phrase's — Tom's wording
   * is learner-centric ("a white-belt LEARNER's ceiling").
   *
   * Easy ships white/yellow 0.8, orange/green 0.9, blue+ 1.0. Fast ships a
   * single 1.0 rung, i.e. no ceiling — "this correction is Easy-only".
   * Absent / malformed ⇒ the shipped table for that mode (never "no ceiling").
   */
  listeningBeltCeilings?: ListeningBeltCeiling[]
}

/** The two learning modes (Aran's ruling 2026-08-06). Fast is the default. */
export type LearningMode = 'easy' | 'fast'

/** The mode a learner has not explicitly chosen. */
export const DEFAULT_LEARNING_MODE: LearningMode = 'fast'

/** `algorithm_config` row key for a mode. */
export const MODE_CONFIG_KEY: Record<LearningMode, string> = {
  easy: 'easy_mode',
  fast: 'fast_mode',
}

/**
 * Listening slot roles — full set including runtime playback rates.
 *   ps08x = 0.8×, ps = 1×, ps15x = 1.5×, ps2x = 2×, trans = known audio at 1×
 */
export type ListeningSlotRole = 'ps08x' | 'ps' | 'ps15x' | 'ps2x' | 'trans'
// Layer-2 pods additionally know 'explainer' (2026-06-10): Tom-voiced bilingual
// chunk breakdown — Phase 0 plays it INSTEAD of trans. Layer 1 never uses it.
export type PodSlotRole = ListeningSlotRole | 'explainer'

/** Layer 2 (Listening Pod) scheduler — gap matrix + stage progression. */
export interface PodsConfig {
  stagePlaylist: Record<string, PodSlotRole[]>  // keyed by stage number as string
  stageDuration: number       // pod-rounds per transitional stage; highest key = eternal
  /** Per-stage duration overrides (e.g. {'1': 2, '2': 3} — Phase 0 explainer
   *  plays twice, Phase 1 three times). Unlisted stages use stageDuration. */
  stageDurations?: Record<string, number>
  gapSuperTightMs: number     // known→target, target→target
  gapTightMs: number          // target→known
  gapGluedMs: number          // chunk → glued chunk (early stages)
  gapBetweenMs: number        // chunk → non-glued, intro→first, last→outro
  /** Fire a pod-lap every N main rounds from podActivationRound onward.
   *  Default 1 (every round, legacy behaviour). Stretches every pod stage
   *  proportionally because the pod-round ratchet only ticks on actual
   *  fires — not session rounds. */
  roundInterval: number
  /** Main-round at which Layer 2 pods START FIRING for new learners.
   *  Returning learners get their own pin on `course_enrollments.pod_activation_round`
   *  which always wins over this default. Moved here from ListeningModeConfig
   *  so the admin "pod activation" knob lives next to the other pod controls. */
  podActivationRound: number
}

/**
 * Resume regression — long absences re-engage the learner with familiar
 * territory. Cursor regression is one-way (only on resume); ceiling
 * (highest_completed_*) is always preserved so they keep access.
 */
export interface ResumeConfig {
  /** After this gap in MINUTES, ignore current_cycle_index on resume and
   *  restart the in-progress round (replays the LEGO intro). A brief pause
   *  resumes the exact cycle; a real break restarts the round. ~5 min cutoff. */
  cycleResetMinutes: number
  /** After this gap in days, walk the round cursor back to the start of
   *  the learner's current belt. Set to a very large number to disable. */
  beltRegressionDays: number
}

/** Per-round script shape — phrase counts + Fibonacci spaced-rep schedule. */
export interface ScriptShapeConfig {
  spacedRepOffsets: number[]   // fib offsets at which spaced rep fires
  maxBuildPhrases: number      // BUILD slots per round
  useConsolidationCount: number  // USE phrases per LEGO
  maxSpacedRepPhrases: number    // total spaced-rep cap per round
  n1PhraseCount: number          // phrases at the N-1 review (vs 1 elsewhere)
}

/**
 * Layer 1 + Layer 2 listening config — mirrored to DB row
 * `algorithm_config` key='listening'. Admins tweak in Supabase Studio
 * and the change takes effect on next session (5-min cache TTL).
 */
export interface ListeningModeConfig {
  enabled: boolean
  offset: number              // rounds after last LEGO before seed graduates
  /** @deprecated Moved to PodsConfig.podActivationRound (2026-05-17).
   *  Optional/read-only here for legacy rows whose `pods` config hasn't
   *  been re-saved yet. The dashboard backfills on next load.
   *  KEPT: still the #2 fallback link for un-migrated `listening` config
   *  rows (LearningPlayer.vue) — removing changes pod-activation timing
   *  for un-migrated learners. Keep until the dashboard backfills `pods`. */
  podActivationRound?: number
  /**
   * THE listening play pattern (Tom, 2026-08-07): "Every single phrase. It's
   * played Target, Known, Target, Target. And I think that's all that
   * happens." One pattern, mode-agnostic, layer-agnostic — Layer 1 maps it
   * onto a seed's two recorded voices, Layer 2 onto a pod sentence's target
   * and translation clips.
   *
   * This SUPERSEDES the nine-stage `PodsConfig.stagePlaylist`, which no longer
   * drives listening at all (see `listeningUseStagePlaylist` below for the one
   * escape hatch). Absent / malformed ⇒ DEFAULT_LISTENING_PATTERN. A pattern
   * ending on 'known' is rejected — never strand the learner on their own
   * language.
   */
  playPattern?: ListeningSlot[]
  /**
   * Ceiling on any listening playback rate. Intersected with the code constant
   * LISTENING_SPEED_CEILING (1.0), so this key can only ever lower the ceiling
   * — "never more than one" is not negotiable from the DB.
   */
  maxSpeed?: number
  /**
   * Which axis decides a listening clip's speed:
   *
   *   'exposure' (default, Tom 2026-08-07) — the per-mode step table over how
   *      many times the learner has met THIS phrase (ModeConfig.listeningSpeedRamp).
   *   'belt' — the pre-existing BELT curve Tom ruled on 2026-08-06 (0.8 white
   *      → 0.9 yellow → 0.95 orange → 1.0 green), via computeListeningSpeed.
   *
   * Both exist because Tom has ruled on both and has not said which wins: the
   * belt ruling is 2026-08-06, the exposure spec is 2026-08-07, and they are
   * ramps over DIFFERENT axes rather than one superseding the other. The
   * exposure ramp ships as the default; flipping this key restores the belt
   * curve without a deploy. `computeListeningSpeed`/`beltSpeed` and their tests
   * are deliberately kept intact for exactly this reason.
   */
  speedSource?: ListeningSpeedSource
  /**
   * ESCAPE HATCH ONLY — replay the retired nine-stage `PodsConfig.stagePlaylist`
   * instead of the single pattern. Default false; there is no learner-facing
   * way to reach it. It exists so the old behaviour can be restored from the
   * DB row if the simplification turns out wrong on Tom's ear, not as a
   * supported alternative mode.
   */
  listeningUseStagePlaylist?: boolean
}

/**
 * Meta-commentary knobs — DB row `algorithm_config` key='meta_commentary'.
 * Encouragement taper (owner ruling 2026-08-06, superseding 2026-07-24):
 * random encouragements dial down with learner experience and switch fully off
 * past a threshold. The experience unit is the learner's CUMULATIVE LEARNING
 * MINUTES ACROSS ALL COURSES — not their position in the current course, which
 * made a veteran starting a new course look like a beginner. Defaults: taper
 * starts at 600 min (10h), off at 1800 min (30h). Instructions (the once-ever
 * science bits) are never tapered.
 */
export interface MetaCommentaryConfig {
  encouragementTaper: EncouragementTaperConfig
}

export interface AlgorithmConfigs {
  fast_mode: ModeConfig
  easy_mode: ModeConfig
  listening: ListeningModeConfig
  pods: PodsConfig
  script_shape: ScriptShapeConfig
  resume: ResumeConfig
  stage0: Stage0Config
  adaptation_v2: AdaptationV2Config
  meta_commentary: MetaCommentaryConfig
  [key: string]: ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig | Stage0Config | AdaptationV2Config | MetaCommentaryConfig
}

// Default fallbacks (used if DB fetch fails)
//
// Normal-mode pause formula: clamp(min_pause_ms, max_pause_ms, pause_base_ms + (target1 + target2) × pause_multiplier).
// The previous fallback (base 1500, mul 1.0, ceiling 8000) was the legacy too-tight curve;
// values below match the formula deployed for SSi's generate-from-prompt loop, so when
// the DB algorithm_config row is missing the fallback gives the same answer.
export const DEFAULT_FAST: ModeConfig = {
  playback_speed: 1.0,
  // Boot + assembly model (see computePauseDuration.ts). These defaults
  // reproduce the previous White-belt curve for medium/long phrases exactly
  // (boot 1000 + 2.5×ref-past-1000ms ≡ the old floor-1000 / knee-1600 / tail-2.0
  // curve at White), while the boot/knee makes the shortest phrases a touch
  // shorter. Belt taper: short phrases (boot) belt-independent by default,
  // long phrases (assembly) shrink ~20% by Green — matching the old speed ramp.
  pause_reference: 'avg',
  pause_boot_ms: 1000,
  pause_assembly_threshold_ms: 1000,
  pause_assembly_lin: 2.5,
  pause_assembly_quad: 0,
  pause_belt_boot: 1.0,
  pause_belt_assembly: 0.8,
  pause_base_ms: 0,
  pause_multiplier: 1.05,
  min_pause_ms: 700,
  max_pause_ms: 15000,
  // Fast is unchanged: the next cycle follows voice2 immediately, as it always has.
  post_voice2_gap_ms: 0,
  spaced_rep_fraction: 1.0,
  debut_phrases_fraction: 1.0,
  skip_voice2: false,
  // Identity override: Fast generates EXACTLY the global script_shape, so its
  // behaviour is provably unchanged from the pre-2026-08-06 'normal_mode'.
  scriptShape: {},
  // Uncapped phrase length — Fast meets exactly the phrases it always did.
  maxPhraseLengthFraction: 1.0,
  // Every Easy lever explicitly OFF, so Fast's script is provably unchanged
  // by the 2026-08-07 redesign: each cycle plays once, BUILD filtered as it
  // always was, no known-side pull filter. The type list is carried even
  // though the count of 1 makes it inert, so both modes present the same
  // knobs on the admin page.
  phraseRepeatCount: 1,
  repeatedCycleTypes: ['build', 'spaced_rep', 'use'],
  filterBuildPhrases: true,
  reviewMaxKnownSyllables: 0,
  /**
   * LISTENING — "Fast can probably start at the regular speed" (Tom,
   * 2026-08-07). One terminal step at 1.0×, which is also the ceiling, so Fast
   * listening never ramps: it is flat native pace, modulated only by the
   * course's own globalSpeed. It still plays the SAME four-slot pattern as
   * Easy, at one uniform speed per phrase — the pattern is the mode-agnostic
   * part of the redesign; only the ramp differs by mode.
   */
  listeningSpeedRamp: DEFAULT_FAST_LISTENING_RAMP,
  // No belt ceiling — a single 1.0 rung. Tom, 2026-08-07: "Fast may still start
  // at 1.0 as you built it — this correction is Easy-only."
  listeningBeltCeilings: DEFAULT_FAST_BELT_CEILINGS,
}

/**
 * EASY mode — the gentler of the two modes (Aran's ruling 2026-08-06: exactly
 * two modes, Turbo deleted).
 *
 * TUNING STATUS: these are FIRST-PASS defaults, chosen to be coherent, not
 * calibrated by ear. Every value is a DB row (`algorithm_config.easy_mode`),
 * so retuning Easy is a Supabase edit, not a deploy.
 *
 * These MIRROR the seeded DB rows (Popty's scripts/learning-modes/
 * create-mode-rows.cjs) and are pitched at roughly a learner's FIRST 10 HOURS,
 * adjusting upwards from there (Aran, 2026-08-06). Aran's three seeds: double
 * the time, double the reps, halve the longest possible phrase. On the time he
 * added that it "does not need to be dramatic", so the doubling is confined to
 * boot + floor and deliberately does NOT touch the assembly slope or the
 * ceiling — doubling those too would compound into a sluggish gap on long
 * sentences.
 *
 * SPEED: Easy does NOT have a speed of its own. It rides the same belt/target-
 * language ramp as Fast (Tom's ruling, 2026-08-07: "Easy should follow the
 * exact speed pattern on-ramps for the target language as Fast — but just with
 * bigger pauses, more repetitions and so on"). Easy used to force a flat 1.0×,
 * which made a White-belt beginner on Easy hear FASTER speech than the same
 * beginner on Fast. `playback_speed` below is therefore INERT for both modes —
 * kept only because the DB row carries the column.
 */
export const DEFAULT_EASY: ModeConfig = {
  playback_speed: 1.0,
  pause_reference: 'avg',
  // DOUBLE the time, confined to boot + floor (see above).
  pause_boot_ms: 4000,
  pause_assembly_threshold_ms: 750,
  pause_assembly_lin: 3.5,
  pause_assembly_quad: 75,
  pause_belt_boot: 0.8,
  pause_belt_assembly: 0.95,
  pause_base_ms: 0,
  pause_multiplier: 1.05,
  min_pause_ms: 2000,
  max_pause_ms: 15000,
  // A beat of silence after voice2 so the next cycle doesn't come straight in
  // over the top of the one just heard, and the target text stays on screen
  // that bit longer (Tom, 2026-08-07). Easy only — Fast holds 0.
  post_voice2_gap_ms: 1000,
  spaced_rep_fraction: 1.0,
  debut_phrases_fraction: 1.0,
  skip_voice2: false,
  /**
   * NO PHRASE-COUNT INFLATION (Tom's ruling, 2026-08-07: "JUST DOUBLE").
   *
   * Easy plays the SAME phrase set as Fast — every override here is empty, so
   * the global script_shape row comes through byte for byte — and its extra
   * repetition comes entirely from playing each cycle twice. That is ~2x a
   * Fast round. Easy previously ALSO doubled the phrase COUNTS (14/4/24/6
   * against the global 7/2/12/3), which compounded with the doubling into a
   * ~2.5x round nobody asked for: more DIFFERENT phrases, where what was asked
   * for was the SAME phrase heard twice.
   *
   * This stays here as the knob rather than being deleted: it IS the
   * phrase-count multiplier, editable per mode from the admin Speaking page,
   * and it defaults to no inflation.
   */
  scriptShape: {},
  // INERT since 2026-08-08 — nothing reads this. It was Aran's "halve the
  // longest possible phrase" (2026-08-06), a character cap on the phrase POOL
  // and therefore generation-time by nature, which is exactly why it could not
  // survive a mode that has to switch live. Easy's length rule is now the
  // play-time skip below. The value stays so the live DB row (which still
  // carries 0.5) keeps a matching shape; it changes nothing for any learner.
  maxPhraseLengthFraction: 0.5,
  /**
   * DOUBLE EVERY PRACTICE CYCLE (Tom, 2026-08-07). Easy's repetition comes
   * from hearing each phrase twice in a row rather than from meeting more
   * different phrases: "we want more repetitions in each ROUND for a LEGO,
   * but we do NOT ever want to repeat exactly the same phrase more than 2x".
   * 2 is also the hard ceiling — see normalizePhraseRepeatCount.
   */
  phraseRepeatCount: 2,
  /** BLD, REVIEW, USE and CONSOLIDATE — the four he named. Intro and the bare
   *  LEGO are absent: "of course not - the intro LEGO and not the LEGO alone". */
  repeatedCycleTypes: ['build', 'spaced_rep', 'use'],
  /**
   * INERT since 2026-08-08 — nothing reads this. Tom's underlying ruling ("no
   * filtering on BLD phrases", 2026-08-07) survives it: with the character cap
   * gone there is nothing for BUILD to opt out of at generation time, and the
   * play-time skip never touches a build or debut cycle
   * (LENGTH_SKIPPABLE_CYCLE_TYPES in playback/modeRenderRules.ts).
   */
  filterBuildPhrases: false,
  /**
   * THE LIVE EASY LENGTH RULE, read at PLAY time: a REVIEW or USE/CONSOLIDATE
   * cycle whose KNOWN side runs past 15 syllables is passed over (Tom,
   * 2026-08-08: "the longest ones are skipped in easy mode. Anything greater
   * than x syllables. Set as default 15 but it could change in admin configs").
   * It counts the KNOWN side — the prompt in the learner's own language — not
   * the target. A DB row, so retuning by ear is a Supabase edit, not a deploy.
   *
   * KNOW WHAT CHANGED WITH IT. Until 2026-08-08 this was a pull-time PREFERENCE
   * applied while generating the script, and it had a starvation guard: a LEGO
   * whose basket held nothing at or under the cap still got its SHORTEST phrase
   * (`filterReviewPool`). As a play-time SKIP there is no such guard — a LEGO
   * whose use phrases are all long simply is not reviewed in Easy. That is the
   * price of the rule switching live, and it is deliberate, not an oversight.
   */
  reviewMaxKnownSyllables: 15,
  /**
   * INERT since 2026-08-08 — nothing reads this. The play-time skip carries no
   * round cutoff ("anything greater than x syllables", with no condition
   * attached), so the rule now runs for the whole course rather than lifting
   * after round 100 as it did while it lived in the generator.
   */
  reviewSyllableFilterMaxRound: 100,
  /**
   * LISTENING — minimal cognitive load, and slower than Fast (Tom,
   * 2026-08-07: "they should probably have A minimal cognitive load for
   * listening and it should be slower on easy mode in the listening").
   *
   * 0.7 on the very first hearing of a phrase, 0.8 for the next four, then
   * 1.0 for ever — a phrase reaches full speed on its sixth exposure. Tom's
   * numbers read literally; "a few times" is the 4, and it is the one number
   * here he left deliberately vague. All of it is a DB row
   * (`algorithm_config.easy_mode.listeningSpeedRamp`), so retuning by ear is a
   * Supabase edit, not a deploy.
   */
  listeningSpeedRamp: DEFAULT_EASY_LISTENING_RAMP,
  /**
   * The BELT CEILING the ramp above lives underneath (Tom, 2026-08-07 23:56Z).
   * White/yellow 0.8, orange/green 0.9, blue and beyond 1.0 — a gentler table
   * than the speaking side's `beltSpeed`, deliberately its own, because these
   * are the numbers Tom gave for Easy listening specifically.
   *
   * A white-belt learner therefore hears 0.7 once, then 0.8 for ever: the
   * exposure ramp's 1.0 step is unreachable until they are a blue belt.
   */
  listeningBeltCeilings: DEFAULT_EASY_BELT_CEILINGS,
}

/**
 * Layer a mode's optional `scriptShape` over the global `script_shape` row.
 * THE single place this merge happens — modes differ by OVERRIDE, never by a
 * parallel shape object. A mode with no override (Fast) resolves to the
 * global row byte-for-byte.
 */
export function resolveScriptShape(
  global: ScriptShapeConfig,
  mode?: Pick<ModeConfig, 'scriptShape'> | null,
): ScriptShapeConfig {
  return { ...global, ...(mode?.scriptShape || {}) }
}

/**
 * Coerce a mode's `maxPhraseLengthFraction` into (0, 1].
 * Anything missing, non-finite, ≤0 or >1 degrades to 1.0 — UNCAPPED, i.e. the
 * historic behaviour. A bad DB value must never silently shorten a course.
 */
export function normalizeMaxPhraseLengthFraction(fraction?: number | null): number {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return 1
  if (fraction <= 0 || fraction > 1) return 1
  return fraction
}

/** Warned-once ledger for a config row asking for more repeats than the rule allows. */
let repeatCeilingWarned = false

/**
 * Coerce a mode's `phraseRepeatCount` into 1..MAX_PHRASE_REPEAT_COUNT.
 *
 * Absent / non-finite / ≤1 ⇒ 1, i.e. no repetition, which is Fast's value.
 * ABOVE THE CEILING ⇒ clamped to 2, loudly. That ceiling is Tom's rule, not a
 * preference — "a phrase repeated 3x would drive people nuts" — so it is the
 * one thing on this row config cannot raise.
 */
export function normalizePhraseRepeatCount(count?: number | null): number {
  if (typeof count !== 'number' || !Number.isFinite(count)) return 1
  const floored = Math.floor(count)
  if (floored <= 1) return 1
  if (floored > MAX_PHRASE_REPEAT_COUNT) {
    if (!repeatCeilingWarned) {
      repeatCeilingWarned = true
      console.warn(
        `[mode-config] phraseRepeatCount ${floored} exceeds the hard ceiling of ${MAX_PHRASE_REPEAT_COUNT} and has been clamped. ` +
        'Tom, 2026-08-07: "we do NOT ever want to repeat exactly the same phrase more than 2x - a phrase repeated 3x would drive people nuts."',
      )
    }
    return MAX_PHRASE_REPEAT_COUNT
  }
  return floored
}

/**
 * Coerce a mode's `repeatedCycleTypes` into a set of cycle types.
 * Absent / not an array ⇒ the four types Tom named. An EMPTY array is honoured
 * as "repeat nothing" — that is a deliberate configuration, not a bad value.
 */
export function normalizeRepeatedCycleTypes(types?: string[] | null): ReadonlySet<string> {
  if (!Array.isArray(types)) return new Set(DEFAULT_REPEATED_CYCLE_TYPES)
  return new Set(types.filter((t) => typeof t === 'string' && t.length > 0))
}

/**
 * Coerce a mode's `reviewMaxKnownSyllables` into a positive limit, or Infinity.
 * Anything missing, non-finite or ≤0 degrades to Infinity — NO FILTER, i.e.
 * Fast's behaviour. Same degrade-to-permissive discipline as
 * normalizeMaxPhraseLengthFraction above: a bad DB value must never silently
 * narrow what a learner meets. Non-integers are floored, so 15.7 filters at 15
 * rather than admitting a phantom half-syllable.
 */
export function normalizeMaxKnownSyllables(max?: number | null): number {
  if (typeof max !== 'number' || !Number.isFinite(max)) return Infinity
  if (max <= 0) return Infinity
  return Math.floor(max)
}

/**
 * Coerce `reviewSyllableFilterMaxRound` into a positive round number.
 * Absent / non-finite / ≤0 degrades to the shipped 100 — the filter's whole
 * point is that it lifts, so a bad DB value must never leave it on for ever.
 */
export const DEFAULT_REVIEW_FILTER_MAX_ROUND = 100
export function normalizeReviewFilterMaxRound(round?: number | null): number {
  if (typeof round !== 'number' || !Number.isFinite(round)) return DEFAULT_REVIEW_FILTER_MAX_ROUND
  if (round <= 0) return DEFAULT_REVIEW_FILTER_MAX_ROUND
  return Math.floor(round)
}

/** Warned-once ledger for the known-side filter going inert, keyed by course. */
const syllableCapWarnedCourses = new Set<string>()

/** What `makeKnownSyllableResolver` hands back. */
export interface PhraseSyllableResolver {
  /** The registry key derived from the course's `known_lang`. */
  lang: string
  /** False ⇒ no counter for this language ⇒ the filter is INERT here. */
  countable: boolean
  /**
   * A phrase's KNOWN-side syllables, or null when uncountable — in which case
   * the filter cannot judge this phrase and must let it through.
   */
  syllablesOf: (phrase: { known_text?: string | null }) => number | null
}

/**
 * THE one place a phrase's KNOWN-side syllable count is resolved for the
 * review/consolidate pull filter (Tom, 2026-08-07 — the filter counts the
 * learner's own language, not the target).
 *
 * There is no stored known-side count anywhere in the schema, so this is the
 * canonical counter for the course's KNOWN language (@ssi/core/text, ported
 * verbatim from Popty's tools/lib/syllable-counters.cjs) or nothing.
 *
 * WHEN THERE IS NO COUNTER this returns `countable: false` and warns ONCE per
 * course. It does NOT throw, and it does NOT guess with another language's
 * rules. The filter simply does not apply, and says so — which is precisely
 * how the FIRST syllable attempt failed: it computed a ceiling from an all-1s
 * heuristic and silently did nothing. Loud inertness is the fix. English is
 * the known language of most courses and English is registered, so the filter
 * is live on the great majority of the estate; the character cap still stands
 * behind it everywhere.
 */
export function makeKnownSyllableResolver(
  courseCode: string,
  knownLang: string | null | undefined,
): PhraseSyllableResolver {
  const lang = syllableLangOf(knownLang)
  const countable = hasSyllableCounter(lang)

  if (!countable && !syllableCapWarnedCourses.has(courseCode)) {
    syllableCapWarnedCourses.add(courseCode)
    console.warn(
      `[phrase-cap] reviewMaxKnownSyllables is INERT for ${courseCode}: no syllable counter registered for known language '${lang || '(unknown)'}'. ` +
      'Review and consolidate phrases will NOT be filtered by known-side syllable count on this course — the maxPhraseLengthFraction character cap is the only length cap in force. ' +
      'To make it apply, add a counter to packages/core/src/text/syllables.ts and mirror it into ssi-dashboard-v7-clean/tools/lib/syllable-counters.cjs.',
    )
  }

  return {
    lang,
    countable,
    syllablesOf: (phrase) => {
      if (!countable) return null
      const text = phrase.known_text
      if (!text) return null
      return countSyllables(text, lang)
    },
  }
}

/**
 * How the CAP measures phrase length: CHARACTERS of target text.
 *
 * Not syllables, and this is measured rather than assumed. On real data
 * (ara_for_eng, 11,340 phrases): `target_syllable_count` is NULL for every
 * row, and the `countTargetSyllables` fallback is a Latin vowel-cluster
 * heuristic that returns 1 for every Arabic phrase — it special-cases CJK but
 * not Arabic. A syllable-based ceiling therefore computed to 0.5 and the cap
 * silently did nothing. Character length is always present and works in every
 * script.
 *
 * The shortest-first SORT still uses syllables, exactly as it always has.
 * Only the cap's measure is characters. Mirrors `phraseLengthOf` in Popty's
 * services/learning-modes.cjs.
 *
 * EXTENDED 2026-08-07 — everything above remains true, and the character cap
 * stays exactly as it is. It is now JOINED by, not replaced by, an absolute
 * syllable cap (`maxPhraseSyllables`); the two compose, a phrase being dropped
 * if it exceeds EITHER. What makes the syllable measure viable this time is
 * that it no longer relies on that all-scripts vowel-cluster heuristic: it
 * uses the canonical per-language counter (@ssi/core/text), which registers
 * nine languages and THROWS rather than guess for the rest. On a course whose
 * target language has no counter — ara among them — the syllable cap declares
 * itself INERT and warns, instead of silently computing nothing. The character
 * cap remains the universal backstop that covers exactly those courses, which
 * is why it must not be removed in favour of syllables.
 */
export function phraseTextLength(text: string | null | undefined): number {
  return (text || '').length
}

/**
 * The longest phrase in the COURSE — the "longest possible phrase" the cap
 * fraction is a fraction OF.
 *
 * Course-wide, deliberately, NOT per-LEGO. A per-LEGO pool max was implemented
 * first and is useless on real data: BUILD pools average 3.2 phrases
 * (ara_for_eng, 1,384 pools), so half-the-pool-max left under one eligible
 * phrase and the starvation guard fired on 100% of LEGOs — the cap never bit
 * at all. Mirrors `courseMaxPhraseLength` in Popty's learning-modes.cjs.
 */
export function courseMaxPhraseLength<T>(
  phraseLists: Iterable<readonly T[] | null | undefined>,
  lengthOf: (phrase: T) => number,
): number {
  let max = 0
  for (const list of phraseLists) {
    if (!list) continue
    for (const p of list) {
      const n = lengthOf(p)
      if (n > max) max = n
    }
  }
  return max
}

/**
 * Sort a LEGO's candidate phrase pool shortest-first and cap it at an
 * ABSOLUTE length ceiling computed once per run from the whole course.
 *
 * THE single place the phrase-length cap lives (Aran, 2026-08-06: Easy halves
 * the longest possible phrase). The rules, in order:
 *   1. sort shortest-first by SYLLABLES — unchanged, historic, and what makes
 *      an uncapped run byte-identical to the pre-2026-08-06 behaviour;
 *   2. drop phrases whose target text is longer than `limit` CHARACTERS;
 *   3. STARVATION GUARD — if that leaves fewer than `minKeep`, return the
 *      shortest `minKeep` instead. `minKeep` is the methodology's per-LEGO
 *      phrase floor (4 BUILD / 5 USE), deliberately NOT the round's ceiling:
 *      passing the ceiling makes the guard swallow the cap on every LEGO
 *      smaller than it, which is most of them. Phrase volume is a hard rail —
 *      fewer phrases is a FAIL — so the cap yields to it, not the reverse.
 *   4. `limit` of Infinity (fraction 1.0 — Fast) short-circuits to the plain
 *      historic sort.
 *
 * 2026-08-07: the absolute TARGET-syllable ceiling that briefly composed with
 * this cap is gone — superseded by the known-side pull filter on review and
 * consolidate slots (see ModeConfig.reviewMaxKnownSyllables). It counted the
 * wrong side of the pair, applied to the whole script rather than to the pull,
 * and never lifted. This function is back to the one measure it can always
 * take in every script: characters of target text.
 */
export function capPhrasesByLength<T>(
  phrases: readonly T[],
  syllablesOf: (phrase: T) => number,
  lengthOf: (phrase: T) => number,
  limit: number,
  minKeep: number,
): T[] {
  const sorted = [...phrases].sort((a, b) => syllablesOf(a) - syllablesOf(b))

  if (!Number.isFinite(limit) || limit <= 0 || sorted.length === 0) return sorted

  const capped = sorted.filter((phrase) => lengthOf(phrase) <= limit)

  return capped.length >= Math.min(minKeep, sorted.length) ? capped : sorted.slice(0, minKeep)
}

/**
 * The KNOWN-side pull filter for REVIEW and CONSOLIDATE slots (Tom,
 * 2026-08-07). THE one place this rule lives.
 *
 * Given a LEGO's basket of use phrases and the round being generated, return
 * the sub-basket the pull is allowed to draw from:
 *
 *   1. filter off, or past `maxRound` ⇒ the whole basket, untouched. Nothing
 *      is backlogged when it lifts and nothing cascades — the LEGO is what is
 *      being practised, so a phrase the learner has never met is fine;
 *   2. otherwise keep phrases of at most `limit` KNOWN-language syllables. A
 *      phrase whose known side cannot be counted (no counter for this course's
 *      known language) passes — that is the inert path, per phrase;
 *   3. SHORTEST-IN-BASKET FALLBACK — if that leaves nothing, return the single
 *      shortest phrase in the basket. A LEGO is never skipped and a review
 *      slot is never left empty because the basket happens to be long.
 */
export interface ReviewPullFilter<T> {
  /** Max known-language syllables, inclusive. Infinity ⇒ filter off. */
  limit: number
  /** Last round on which the filter applies. */
  maxRound: number
  /** Known-side syllables of a phrase, or null when uncountable. */
  syllablesOf: (phrase: T) => number | null
}

export function filterReviewPool<T>(
  pool: readonly T[],
  roundNumber: number,
  filter: ReviewPullFilter<T> | null | undefined,
): readonly T[] {
  if (!filter || !Number.isFinite(filter.limit) || filter.limit <= 0) return pool
  if (roundNumber > filter.maxRound) return pool
  if (pool.length === 0) return pool

  const kept = pool.filter((phrase) => {
    const n = filter.syllablesOf(phrase)
    if (typeof n !== 'number' || !Number.isFinite(n)) return true // uncountable ⇒ passes
    return n <= filter.limit
  })
  if (kept.length > 0) return kept

  let shortest = pool[0]
  let shortestN = Infinity
  for (const phrase of pool) {
    const n = filter.syllablesOf(phrase)
    const value = typeof n === 'number' && Number.isFinite(n) ? n : Infinity
    if (value < shortestN) { shortestN = value; shortest = phrase }
  }
  return [shortest]
}

/** Methodology per-LEGO phrase floors the cap must never breach (ralph: >=4
 *  BUILD, >=5 USE — "fewer phrases is a FAIL"). */
export const MIN_BUILD_PHRASES_AFTER_CAP = 4
export const MIN_USE_PHRASES_AFTER_CAP = 5

const DEFAULT_LISTENING: ListeningModeConfig = {
  enabled: true,
  offset: 90,
  // The 2026-08-07 simplification: ONE pattern, exposure-ramped, capped at 1.0,
  // and the nine-stage playlist off. See listeningExposureRamp.ts.
  playPattern: DEFAULT_LISTENING_PATTERN,
  maxSpeed: LISTENING_SPEED_CEILING,
  speedSource: DEFAULT_LISTENING_SPEED_SOURCE,
  listeningUseStagePlaylist: false,
}

/**
 * Resolve the whole listening play/speed policy from the live `listening` row
 * plus the active mode's `listeningSpeedRamp`. THE one place the DB row is
 * turned into something the two listening schedulers can use, so Layer 1 and
 * Layer 2 provably agree.
 *
 * Degrade-to-gentle, not degrade-to-permissive: every malformed value falls
 * back to the shipped default rather than to "off". A missing ramp must never
 * mean full speed for a beginner.
 */
export interface ListeningPlayPolicy {
  pattern: ListeningSlot[]
  ramp: ListeningRampStep[]
  /** Per-mode belt ceilings — the maximum the ramp may approach, by learner
   *  position. See ModeConfig.listeningBeltCeilings. */
  beltCeilings: ListeningBeltCeiling[]
  ceiling: number
  speedSource: ListeningSpeedSource
  /** True ⇒ replay the retired nine-stage playlist (escape hatch only). */
  useStagePlaylist: boolean
}

export function resolveListeningPlayPolicy(
  listening: Partial<ListeningModeConfig> | null | undefined,
  mode: LearningMode,
  modeConfig?: Partial<ModeConfig> | null,
): ListeningPlayPolicy {
  const shippedRamp = mode === 'easy' ? DEFAULT_EASY_LISTENING_RAMP : DEFAULT_FAST_LISTENING_RAMP
  const shippedBelts = mode === 'easy' ? DEFAULT_EASY_BELT_CEILINGS : DEFAULT_FAST_BELT_CEILINGS
  const rawCeiling = listening?.maxSpeed
  const ceiling = typeof rawCeiling === 'number' && Number.isFinite(rawCeiling) && rawCeiling > 0
    ? Math.min(rawCeiling, LISTENING_SPEED_CEILING)
    : LISTENING_SPEED_CEILING
  const source = listening?.speedSource === 'belt' ? 'belt' : DEFAULT_LISTENING_SPEED_SOURCE
  return {
    pattern: resolveListeningPattern(listening?.playPattern),
    ramp: normalizeListeningRamp(modeConfig?.listeningSpeedRamp, shippedRamp),
    beltCeilings: normalizeBeltCeilings(modeConfig?.listeningBeltCeilings, shippedBelts),
    ceiling,
    speedSource: source,
    useStagePlaylist: listening?.listeningUseStagePlaylist === true,
  }
}

const DEFAULT_PODS: PodsConfig = {
  // Stage count is dynamic — the runtime reads the key count, the
  // highest-numbered key is the eternal hold.
  // Stage 1 = "Phase 0" (Tom 2026-06-10): the explainer plays INSTEAD of
  // the translation, for 2 pod-rounds, then retires for good. Sentences
  // without explainer audio (fully-repeat lines, vocab codas) play their
  // translation in that slot via the scheduler fallback.
  // Stage 2 = "Phase 1": plain translation pattern, 3 rounds. The speed
  // ramp (Aran's 2026-05-07 bridge) follows from stage 3.
  stagePlaylist: {
    '1': ['ps08x', 'explainer', 'ps08x'],
    '2': ['ps08x', 'trans', 'ps08x', 'ps08x'],
    '3': ['ps08x', 'trans', 'ps', 'ps15x'],
    '4': ['ps', 'trans', 'ps15x', 'ps15x'],
    '5': ['ps', 'trans', 'ps2x', 'ps2x'],
    '6': ['ps', 'trans', 'ps2x'],
    '7': ['ps', 'ps2x'],
    '8': ['ps2x', 'ps2x'],
    '9': ['ps2x'],
  },
  stageDuration: 5,
  stageDurations: { '1': 2, '2': 3 },
  gapSuperTightMs: 100,
  gapTightMs: 200,
  gapGluedMs: 300,
  gapBetweenMs: 1000,
  /* L2 pod-lap fires every 5 main rounds from activation. Hotfix
   * 2026-05-20: stale activation values (21+ from an earlier rule) are
   * capped at 5 on read in usePodLapScheduler so the first pod surfaces
   * ~5 rounds in (gives the learner time to settle into speaking practice
   * before pods interleave). The growing-interval scheduler (2/2/3/3/4/4
   * /5/5/5/5...) lands separately. */
  roundInterval: 5,
  podActivationRound: 5,
}

const DEFAULT_SCRIPT_SHAPE: ScriptShapeConfig = {
  spacedRepOffsets: [1, 2, 3, 5, 8, 13, 21, 34, 55, 89],
  maxBuildPhrases: 7,
  useConsolidationCount: 2,
  maxSpacedRepPhrases: 12,
  n1PhraseCount: 3,
}

const DEFAULT_RESUME: ResumeConfig = {
  cycleResetMinutes: 5,
  beltRegressionDays: 60,
}

/**
 * Adaptation v2 safety rails (`docs/adaptation/adaptation-v2-build-spec.md`
 * §6, WP-5). Two independent gates:
 *   - `enabled`: the kill switch. false ⇒ the whole v2 pipeline (evidence →
 *     curvature → RatePolicyEngine → shadow log) never even computes for a
 *     round boundary — not just "computes but doesn't apply". The v1 pause
 *     ladder keeps running untouched regardless.
 *   - `shadow`: when `enabled` is true, gates APPLICATION only. true ⇒ the
 *     engine computes a RoundPlan and logs it (`adaptation_plan` event) every
 *     round boundary, but never touches playback. false ⇒ the plan is
 *     actually applied via SimplePlayer's overrides surface.
 * Shipping default is `enabled:true, shadow:true` — "compute and log, never
 * apply" — which is exactly what "ship with the DB flag absent" needs to mean
 * (executive summary point 9). Flipping `enabled:false` later is the harder
 * kill switch for if the shadow logs themselves look wrong.
 */
export interface AdaptationV2Config {
  enabled: boolean
  shadow: boolean
  /** Stage 2 (envelope metadata, WP-6..9) — separately gated, off until that track ships. */
  stage2_enabled: boolean
  bounds: RatePolicyBounds
  /** Stage-2 delta-producer weights (§5.3) — unused until WP-8 lands; carried here so the shape is stable. */
  weights: { duration: number; peaks: number; shape: number }
}

const DEFAULT_ADAPTATION_V2: AdaptationV2Config = {
  enabled: true,
  shadow: true,
  stage2_enabled: false,
  bounds: DEFAULT_RATE_POLICY_BOUNDS,
  weights: { duration: 0.5, peaks: 0.3, shape: 0.2 },
}

const DEFAULT_META_COMMENTARY: MetaCommentaryConfig = {
  encouragementTaper: DEFAULT_ENCOURAGEMENT_TAPER,
}

/** Read the taper out of a loaded DB row, honouring only the known
 *  minute-denominated keys — see the call site for why. Exported for tests. */
export function pickTaper(loaded: any): EncouragementTaperConfig {
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  return {
    taperStartMinutes: num(loaded?.taperStartMinutes, DEFAULT_ENCOURAGEMENT_TAPER.taperStartMinutes),
    offAtMinutes: num(loaded?.offAtMinutes, DEFAULT_ENCOURAGEMENT_TAPER.offAtMinutes),
  }
}

// Singleton cache - shared across all component instances
let configCache: AlgorithmConfigs | null = null
let cacheTimestamp: number = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export function useAlgorithmConfig(supabase: Ref<any> | null) {
  const configs = ref<AlgorithmConfigs>({
    fast_mode: DEFAULT_FAST,
    easy_mode: DEFAULT_EASY,
    listening: DEFAULT_LISTENING,
    pods: DEFAULT_PODS,
    script_shape: DEFAULT_SCRIPT_SHAPE,
    resume: DEFAULT_RESUME,
    stage0: DEFAULT_STAGE0,
    adaptation_v2: DEFAULT_ADAPTATION_V2,
    meta_commentary: DEFAULT_META_COMMENTARY,
  })
  const isLoaded = ref(false)
  const loadError = ref<string | null>(null)

  // Load configs from Supabase (with caching)
  const loadConfigs = async (forceRefresh = false): Promise<void> => {
    // Check cache first
    const now = Date.now()
    if (!forceRefresh && configCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
      configs.value = configCache
      isLoaded.value = true
      return
    }

    if (!supabase?.value) {
      console.warn('[AlgorithmConfig] Supabase not available, using defaults')
      isLoaded.value = true
      return
    }

    try {
      const { data, error } = await supabase.value
        .from('algorithm_config')
        .select('key, config')

      if (error) {
        console.error('[AlgorithmConfig] Fetch error:', error)
        loadError.value = error.message
        // Fall back to defaults
        isLoaded.value = true
        return
      }

      if (data && data.length > 0) {
        const loaded: Record<string, any> = {}
        for (const row of data) {
          loaded[row.key] = row.config
        }

        // Merge with defaults (in case some keys are missing). Field-level
        // merge for keyed configs so a partial DB row doesn't drop fields.
        configs.value = {
          ...loaded,
          // Promotion-window read: 'fast_mode' is the new key, 'normal_mode'
          // is the live fallback alias it was copied from. An old bundle
          // reading a new DB and a new bundle reading an old DB both work —
          // whichever row exists wins, new key first. NOTE 'normal_mode' is
          // NOT retired-mode residue — it is fast_mode's live alias and must
          // stay until the promotion window closes.
          fast_mode: { ...DEFAULT_FAST, ...(loaded.fast_mode || loaded.normal_mode || {}) },
          easy_mode: { ...DEFAULT_EASY, ...(loaded.easy_mode || {}) },
          listening: { ...DEFAULT_LISTENING, ...(loaded.listening || {}) },
          pods: { ...DEFAULT_PODS, ...(loaded.pods || {}) },
          script_shape: { ...DEFAULT_SCRIPT_SHAPE, ...(loaded.script_shape || {}) },
          resume: { ...DEFAULT_RESUME, ...(loaded.resume || {}) },
          stage0: { ...DEFAULT_STAGE0, ...(loaded.stage0 || {}) },
          adaptation_v2: {
            ...DEFAULT_ADAPTATION_V2,
            ...(loaded.adaptation_v2 || {}),
            bounds: { ...DEFAULT_ADAPTATION_V2.bounds, ...(loaded.adaptation_v2?.bounds || {}) },
            weights: { ...DEFAULT_ADAPTATION_V2.weights, ...(loaded.adaptation_v2?.weights || {}) },
          },
          meta_commentary: {
            ...DEFAULT_META_COMMENTARY,
            ...(loaded.meta_commentary || {}),
            // Pick ONLY the known (minute-denominated) keys. A stale row still
            // carrying the pre-2026-08-06 seed keys (taperStartSeeds /
            // offAtSeeds) must not leak through — it would silently switch
            // encouragements off after 8 MINUTES. Unknown keys are ignored and
            // the new defaults stand.
            encouragementTaper: pickTaper(loaded.meta_commentary?.encouragementTaper),
          },
        }

        // Update cache
        configCache = configs.value
        cacheTimestamp = now

        console.log('[AlgorithmConfig] Loaded from Supabase:', Object.keys(loaded))
      }

      isLoaded.value = true
    } catch (err) {
      console.error('[AlgorithmConfig] Unexpected error:', err)
      loadError.value = String(err)
      isLoaded.value = true
    }
  }

  // Convenience getters
  const fastConfig = computed(() => configs.value.fast_mode as ModeConfig)
  const easyConfig = computed(() => configs.value.easy_mode as ModeConfig)
  /** The ModeConfig for a given learning mode. */
  const modeConfig = (mode: LearningMode): ModeConfig =>
    mode === 'easy' ? easyConfig.value : fastConfig.value
  const listeningConfig = computed(() => configs.value.listening as ListeningModeConfig)
  const podsConfig = computed(() => configs.value.pods as PodsConfig)
  const scriptShapeConfig = computed(() => configs.value.script_shape as ScriptShapeConfig)
  const resumeConfig = computed(() => configs.value.resume as ResumeConfig)
  const stage0Config = computed(() => configs.value.stage0 as Stage0Config)
  const adaptationV2Config = computed(() => configs.value.adaptation_v2 as AdaptationV2Config)
  const metaCommentaryConfig = computed(() => configs.value.meta_commentary as MetaCommentaryConfig)

  // Get any config by key
  const getConfig = (key: string): ModeConfig | ListeningModeConfig | PodsConfig | ScriptShapeConfig | ResumeConfig | Stage0Config | AdaptationV2Config | MetaCommentaryConfig | null => {
    return configs.value[key] || null
  }

  // Calculate pause duration based on config and target audio length
  const calculatePause = (config: ModeConfig, targetDurationMs: number): number => {
    const calculated = config.pause_base_ms + (targetDurationMs * config.pause_multiplier)
    return Math.min(config.max_pause_ms, Math.max(config.min_pause_ms, calculated))
  }

  // Invalidate cache (call after admin updates)
  const invalidateCache = () => {
    configCache = null
    cacheTimestamp = 0
  }

  return {
    configs,
    isLoaded,
    loadError,
    loadConfigs,
    fastConfig,
    easyConfig,
    modeConfig,
    listeningConfig,
    podsConfig,
    scriptShapeConfig,
    resumeConfig,
    stage0Config,
    adaptationV2Config,
    metaCommentaryConfig,
    getConfig,
    calculatePause,
    invalidateCache,
    // Export defaults for reference
    DEFAULT_FAST,
    DEFAULT_EASY,
    DEFAULT_LISTENING,
    DEFAULT_PODS,
    DEFAULT_SCRIPT_SHAPE,
    DEFAULT_RESUME,
    DEFAULT_ADAPTATION_V2,
    DEFAULT_META_COMMENTARY,
  }
}
