/**
 * PER-VOICE NATURAL PACE, AND THE RULE THAT DECIDES PLAYBACK SPEED.
 *
 * A TypeScript port of `ssi-dashboard-v7-clean/services/shared/voice-pace.cjs`.
 * Same rule, same clamp, same null semantics. That file is the original and
 * carries the full reasoning; this header states only what a reader of the
 * PLAYER needs, plus the two things that are specific to being the second copy.
 *
 * ── THE RULE (Tom, 2026-08-29, plate S-345). THE BELT RAMP IS RETIRED ───────
 * Speed is a function of what the learner is DOING (role) and which setting
 * they chose (mode). It is not a function of belt, seed or course position.
 *
 *     target language, Easy   → 0.80
 *     target language, Fast   → 0.90
 *     known language, any     → 1.00   (instruction they already understand)
 *     listening, any language → 1.00   (listening trains them for real life)
 *
 * The four-step ladder — white 0.8, yellow 0.9, orange 0.95, green 1.0 — is
 * gone from the speaking path. Nothing in this module takes a belt or a seed.
 *
 * ── 0.8 OF WHAT? OF THE LANGUAGE'S REFERENCE, NOT OF EACH VOICE ─────────────
 * so a naturally brisk voice on Easy is not still faster than a measured voice
 * on Fast:
 *
 *     multiplier = clamp(targetPace / effectivePaceRatio(voice), MIN, MAX)
 *
 * ── THE TWO THINGS THAT MATTER ABOUT THIS BEING A SECOND COPY ───────────────
 * 1. `__fixtures__/voice-pace-cases.json` is the shared case table. The test
 *    beside this file asserts this port reproduces every row of it. The
 *    dashboard needs the MIRROR test against the same fixture; as of
 *    2026-09-07 it does not have one. Two copies of one rule is a bug waiting
 *    to happen and the cjs file says so itself about MIN_SPEED.
 * 2. `combineMeasurements` is deliberately NOT ported. It turns per-language
 *    measurements into the ratio stored on a `voices` row — a measurement-side
 *    concern that belongs to the lab. The player consumes the stored ratio and
 *    never derives one.
 */

/**
 * The speed floor. Below this, TTS output stops sounding slow and starts
 * sounding broken. Same number as `MIN_SPEED` in voice-pace.cjs, and the same
 * number `providers/toSimpleRounds.ts` has held since long before per-voice
 * pace existed — that file now imports this one, so the player has ONE copy.
 */
export const MIN_SPEED = 0.7

/**
 * The ceiling, and it is 1.0 ON PURPOSE.
 *
 * Everything in the estate is minted at 1.0×, so a multiplier above 1.0 means
 * playing a clip FASTER than it was rendered — new behaviour nobody has asked
 * for, on the most exposed surface there is. A voice slower than its language's
 * reference is played at its own natural pace and no faster; the correction is
 * one-sided until Tom says otherwise.
 *
 * DEFAULT taken 2026-08-29 in voice-pace.cjs, flagged for Tom rather than ruled
 * by him, and carried across unchanged here.
 */
export const MAX_SPEED = 1.0

/** The two settings the player already has. */
export type PaceMode = 'easy' | 'fast'

/** What the learner is doing when this clip plays. */
export type PaceRole = 'target' | 'known' | 'listening'

/**
 * The estate's own slot names, mapped onto the three roles the rule knows.
 * `presentation` speaks the known language, like `known`; target1/target2 are
 * the target language.
 */
export const ROLE_ALIASES: Readonly<Record<string, PaceRole>> = Object.freeze({
  target: 'target', target1: 'target', target2: 'target',
  known: 'known', presentation: 'known', source: 'known',
  listening: 'listening', listen: 'listening',
})

/** The pace fields off a `voices` row, in either the DB's snake_case or the
 *  bundle's camelCase. Both shapes are accepted so a caller never has to
 *  reshape a row before asking a question about it. */
export interface VoicePaceFields {
  natural_pace_ratio?: number | string | null
  natural_pace_nudge?: number | string | null
  naturalPaceRatio?: number | string | null
  naturalPaceNudge?: number | string | null
  /** Pre-multiplied ratio, as `course_voice_pace()` ships it. Preferred when
   *  present; null still means "never measured", never 1.0. */
  effectivePaceRatio?: number | string | null
}

export interface TargetPaceDecision {
  targetPace: number
  correctByVoice: boolean
  role: PaceRole | null
  mode: PaceMode
  reason: string
}

export interface PlaybackSpeedDecision extends TargetPaceDecision {
  speed: number
  /** Did the voice's own measured pace change anything? */
  corrected: boolean
  /** Did MIN_SPEED / MAX_SPEED bite? */
  clamped: boolean
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * THE RULE. What fraction of the language's reference pace should a learner
 * hear, given what they are doing and which setting they chose?
 *
 * Returns the target AND whether the per-voice correction applies at all,
 * because those are two different questions and the second one is a taste call:
 *
 * KNOWN AND LISTENING ARE 1.0 FLAT, WITH NO PER-VOICE CORRECTION — "played
 * exactly as rendered", full stop. Correcting a slow voice UP to the reference
 * would mean playing a clip faster than it was rendered (MAX_SPEED already
 * forbids it). DEFAULT taken 2026-08-29, flagged for Tom: his rule says
 * "always 1.0x" and this is the conservative reading of it.
 */
export function targetPace(role: string | null | undefined, mode: string | null | undefined): TargetPaceDecision {
  const r = ROLE_ALIASES[String(role ?? '').toLowerCase()] ?? null
  const m: PaceMode = String(mode ?? '').toLowerCase() === 'fast' ? 'fast' : 'easy'
  if (r === 'listening') {
    return { targetPace: 1.0, correctByVoice: false, role: r, mode: m,
      reason: 'listening exercise — full speed in any language, because listening trains them for everyday life' }
  }
  if (r === 'known') {
    return { targetPace: 1.0, correctByVoice: false, role: r, mode: m,
      reason: 'known language — instruction they already understand, played exactly as rendered' }
  }
  if (r === 'target') {
    const t = m === 'fast' ? 0.9 : 0.8
    return { targetPace: t, correctByVoice: true, role: r, mode: m,
      reason: `target language on ${m} — ${t} of the language's reference pace` }
  }
  // An UNKNOWN role is not guessed at. Guessing here would silently slow (or
  // fail to slow) a surface nobody has thought about; full speed and a stated
  // reason is the honest answer.
  return { targetPace: 1.0, correctByVoice: false, role: null, mode: m,
    reason: `unrecognised role "${role}" — played as rendered rather than guessed at` }
}

/**
 * The effective pace ratio for a voice: the measurement, corrected by the
 * human's nudge.
 *
 * Returns null for a voice that has never been measured — and null must mean
 * "behave exactly as before per-voice pace existed", never "assume 1.0". Those
 * two are the same number and completely different claims: one says we know
 * this voice is typical, the other says we have not looked. Callers branch on
 * null; nothing silently substitutes a number for an absence.
 */
export function effectivePaceRatio(voice: VoicePaceFields | null | undefined): number | null {
  if (!voice) return null
  const pre = toNumber(voice.effectivePaceRatio)
  if (pre !== null) return pre > 0 ? pre : null
  const measured = toNumber(voice.natural_pace_ratio ?? voice.naturalPaceRatio)
  if (measured === null || measured <= 0) return null
  const nudge = toNumber(voice.natural_pace_nudge ?? voice.naturalPaceNudge)
  if (nudge === null || nudge <= 0) return measured
  return measured * nudge
}

/**
 * The playback multiplier for one voice at one target pace.
 *
 * `corrected` says whether the voice's own pace changed anything, and `reason`
 * says why in words — because a speed number with no explanation is exactly how
 * the old ladder became impossible to reason about.
 */
export function paceMultiplier(args: {
  paceRatio: number | null | undefined
  targetPace: number | null | undefined
  min?: number
  max?: number
}): { speed: number; corrected: boolean; clamped: boolean; reason: string } {
  const { paceRatio, min = MIN_SPEED, max = MAX_SPEED } = args
  const target = toNumber(args.targetPace)
  if (target === null || target <= 0) {
    return { speed: 1.0, corrected: false, clamped: false, reason: 'no target pace given' }
  }
  if (paceRatio === null || paceRatio === undefined) {
    // UNMEASURED VOICE: the target number itself, uncorrected. This is the
    // invariant that makes shipping this safe — an unmeasured voice behaves
    // exactly as it would with no per-voice pace at all.
    const speed = clamp(target, min, max)
    return {
      speed,
      corrected: false,
      clamped: speed !== target,
      reason: 'voice has no measured pace — target used unchanged, uncorrected',
    }
  }
  const raw = target / paceRatio
  const speed = clamp(raw, min, max)
  return {
    speed: round3(speed),
    corrected: true,
    clamped: speed !== raw,
    reason: speed === raw
      ? `voice speaks at ${round3(paceRatio)}x its language's reference, so ${round3(target)} target → ${round3(raw)}`
      : `voice speaks at ${round3(paceRatio)}x its language's reference (${round3(target)} target → ${round3(raw)}), clamped to ${round3(speed)}`,
  }
}

/**
 * The one call the player and the lab should both make: what speed does THIS
 * voice play at, for THIS role, in THIS mode?
 */
export function playbackSpeedForVoice(
  voice: VoicePaceFields | null | undefined,
  role: string | null | undefined,
  mode: string | null | undefined,
): PlaybackSpeedDecision {
  const policy = targetPace(role, mode)
  if (!policy.correctByVoice) {
    return { ...policy, speed: policy.targetPace, corrected: false, clamped: false }
  }
  const result = paceMultiplier({ paceRatio: effectivePaceRatio(voice), targetPace: policy.targetPace })
  return { ...policy, ...result, targetPace: policy.targetPace }
}

// ---------------------------------------------------------------------------
// The wire shape: what `course_voice_pace()` ships, and how the player asks it
// a question. Facts only — the rule above is the only thing that decides.
// ---------------------------------------------------------------------------

/** One voice's pace facts, as derived from the clips it actually rendered. */
export interface VoicePaceFacts {
  voiceId: string
  /** How many of this course's referenced clips this voice rendered in this role. */
  clips: number
  naturalPaceRatio: number | null
  naturalPaceNudge: number | null
  /** ratio × nudge. NULL means never measured — never 1.0. */
  effectivePaceRatio: number | null
  /** The EXPLICIT flag. `false` means "we have not looked", not "it is typical". */
  measured: boolean
  /** Whether a `voices` row exists for this rendered voice id at all. A false
   *  here is an upstream data gap: the clip names a voice the estate has no
   *  record of, so it can never be measured until that is fixed. */
  knownVoice: boolean
  samples?: number | null
  method?: string | null
  measuredAt?: string | null
  nudgeNote?: string | null
}

export interface RoleVoicePace {
  /** The voice on the most clips for this role — the one whose pace is applied. */
  primary: VoicePaceFacts
  /** Everything else rendered under this role, most clips first. A voice in
   *  here with a materially different pace means a partial recast: visible
   *  rather than silently outvoted. */
  others: VoicePaceFacts[]
  totalClips: number
}

export interface CourseVoicePace {
  courseCode: string
  derivedFrom: string
  roles: Partial<Record<string, RoleVoicePace>>
  /** Set when the derivation could not be run (timeout, RPC error). The player
   *  then behaves exactly as it did before per-voice pace existed, and says so. */
  unavailable?: boolean
  unavailableReason?: string
}

/**
 * The pace facts for one audio slot of one course, or null if we have none.
 *
 * `slot` is the estate's own slot name — 'target1', 'target2', 'known'. A slot
 * with no entry falls back to the other target slot, because a course whose
 * target2 clips were never tallied is far more likely to share target1's voice
 * than to want no correction at all — and if it does not, `primary.voiceId`
 * in the payload says whose pace was used.
 */
export function voicePaceForSlot(
  pace: CourseVoicePace | null | undefined,
  slot: string,
): VoicePaceFacts | null {
  if (!pace || pace.unavailable) return null
  const direct = pace.roles?.[slot]
  if (direct?.primary) return direct.primary
  if (slot === 'target1' || slot === 'target2') {
    const other = slot === 'target1' ? pace.roles?.target2 : pace.roles?.target1
    if (other?.primary) return other.primary
  }
  return null
}
