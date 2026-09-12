/**
 * podChangeover — what happens between two rows of a pod dialogue, in one place.
 *
 * Tom, 2026-09-12, listening to the Italian method pod in Immersion: "The
 * changeovers between speakers need to be different depending on whether the
 * speakers are jumping in — in which there should be no gap, in fact it should
 * be overlap if possible, but if not, at least no gap at all. Whereas genuine
 * turn taking — asking or answering questions etc. — should be as they are
 * now, with whatever gap they currently have. So it's more like a proper
 * conversation."
 *
 * A line that jumps in carries `jumpIn: true` (Popty marks it on the pod line
 * row as `jump_in`; useListeningPods hands it to the overlay as `jumpIn`). A
 * genuine turn is false or absent and keeps today's gaps exactly.
 *
 * Two questions, two functions:
 *   changeoverGapMs — the silent gap the overlay plays AFTER a row, before the
 *                     next one. Today's numbers for a turn; ZERO for a jump-in
 *                     in Immersion.
 *   jumpInLeadMs    — how far before the previous clip's END the jump-in clip
 *                     starts (the overlap), derived from the previous clip's
 *                     own trailing silence when it carries word timings.
 *
 * Immersion only. Drill plays each line as target · known · target · target
 * with a translation in the middle and a rep at the end, so the sound before
 * a line is the third repetition of the line before, not the other speaker's
 * turn — an interruption of a drill rep is not a conversation, and Drill keeps
 * today's gaps unchanged.
 */

// Inter-clip / inter-row gaps (Aran 2026-06-29: tighten everything to ≤0.1s).
// The chosen speed in Drill is the "normal" rate — fast reps are 2× of it.
export const GAP_DEFAULT_MS = 90        // Core/All between phrases + dialogue speaker-change (was 800)
export const GAP_DRILL_MS = 90          // between Drill reps + Drill within-turn (was 300 / 350)
export const GAP_IMMERSION_JOIN_MS = 50 // same-speaker sentence join in Immersion (deliberately tightest)

/** The fixed part of a jump-in overlap: how far into the previous speaker's
 *  last audible word the interrupter lands, in media milliseconds. */
export const JUMP_IN_OVERLAP_MS = 120
/** What a jump-in leads by when the previous clip carries no word timings, so
 *  its trailing silence is unknown: enough to eat a typical TTS tail. */
export const JUMP_IN_LEAD_UNTIMED_MS = 200
/** Ceiling on the lead, so a clip with a long silent tail never has its last
 *  word swallowed by the interrupter. */
export const JUMP_IN_LEAD_MAX_MS = 700

export interface ChangeoverRow {
  /** True only on a speaker change — the row opens a new paragraph. */
  isTurnStart?: boolean
  /** True when this line interrupts / jumps in on the previous speaker. */
  jumpIn?: boolean
}

export interface ChangeoverContext {
  /** Dialogues tab with a scene open (rows are per-chunk dialogue lines). */
  inDialogue: boolean
  listenMode: string
  /** The row that plays next; undefined at the end of the list. */
  nextRow: ChangeoverRow | null | undefined
}

/** Is the next row a jump-in that this changeover honours? */
export function isJumpInChangeover(ctx: ChangeoverContext): boolean {
  return ctx.inDialogue && ctx.listenMode === 'immersion' && ctx.nextRow?.jumpIn === true
}

/**
 * The silent gap after a row. Exactly the overlay's pre-existing rule for a
 * turn: the steady between-phrases pause on a speaker change or outside a
 * dialogue; the within-paragraph join otherwise (tightest in Immersion, a
 * touch more room in Drill). A jump-in in Immersion gets nothing at all.
 */
export function changeoverGapMs(ctx: ChangeoverContext): number {
  if (isJumpInChangeover(ctx)) return 0
  let gap = GAP_DEFAULT_MS
  if (ctx.inDialogue && ctx.nextRow && !ctx.nextRow.isTurnStart) {
    gap = ctx.listenMode === 'immersion' ? GAP_IMMERSION_JOIN_MS : GAP_DRILL_MS
  }
  return gap
}

export interface LeadInput {
  /** The previous clip's duration in seconds, as the audio element reports it. */
  prevDurationSec: number | null | undefined
  /** The previous clip's normalised word timings (breathGroups.ts shape) or null. */
  prevTimings: { ends: number[] } | null | undefined
}

/**
 * How far before the previous clip ENDS the jump-in starts, in media ms.
 * With timings: the clip's trailing silence (duration − last word end) plus
 * the fixed overlap, so the interrupter lands on the last word rather than
 * on the silence after it. Without timings: a fixed lead. Both capped.
 * Media time, not wall time — the caller compares against the element's own
 * clock, so playback speed needs no correction here.
 */
export function jumpInLeadMs(input: LeadInput): number {
  const dur = Number(input.prevDurationSec)
  const ends = input.prevTimings?.ends
  const lastEnd = Array.isArray(ends) && ends.length ? Number(ends[ends.length - 1]) : NaN
  let lead: number
  if (Number.isFinite(dur) && dur > 0 && Number.isFinite(lastEnd) && lastEnd >= 0 && lastEnd <= dur) {
    lead = Math.round((dur - lastEnd) * 1000) + JUMP_IN_OVERLAP_MS
  } else {
    lead = JUMP_IN_LEAD_UNTIMED_MS
  }
  if (Number.isFinite(dur) && dur > 0) lead = Math.min(lead, Math.round(dur * 1000))
  return Math.max(0, Math.min(JUMP_IN_LEAD_MAX_MS, lead))
}
