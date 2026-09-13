/**
 * podChangeover — a jump-in has no gap; a genuine turn keeps today's gap.
 * (Tom, 2026-09-12, listening to the Italian method pod on staging.)
 *
 * The turn numbers below are the overlay's pre-existing gaps, pinned so the
 * jump-in rule can never move them: 90 ms on a speaker change, 50 ms between
 * one speaker's sentences in Immersion, 90 ms in Drill, 90 ms outside a
 * dialogue.
 */
import { describe, expect, it } from 'vitest'
import {
  changeoverGapMs, isJumpInChangeover, jumpInLeadMs,
  GAP_DEFAULT_MS, GAP_DRILL_MS, GAP_IMMERSION_JOIN_MS,
  JUMP_IN_OVERLAP_MS, JUMP_IN_LEAD_UNTIMED_MS, JUMP_IN_LEAD_MAX_MS,
} from './podChangeover'

const turnStart = { isTurnStart: true, jumpIn: false }
const sameSpeaker = { isTurnStart: false, jumpIn: false }
const jumpIn = { isTurnStart: true, jumpIn: true }
const unmarked = { isTurnStart: true } // jumpIn absent = a turn

describe('changeoverGapMs — a genuine turn plays exactly as today', () => {
  it('Immersion: 90 ms on a speaker change, 50 ms within a paragraph, 90 ms at the end of the list', () => {
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'immersion', nextRow: turnStart })).toBe(GAP_DEFAULT_MS)
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'immersion', nextRow: unmarked })).toBe(GAP_DEFAULT_MS)
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'immersion', nextRow: sameSpeaker })).toBe(GAP_IMMERSION_JOIN_MS)
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'immersion', nextRow: undefined })).toBe(GAP_DEFAULT_MS)
    expect(GAP_DEFAULT_MS).toBe(90)
    expect(GAP_IMMERSION_JOIN_MS).toBe(50)
    expect(GAP_DRILL_MS).toBe(90)
  })
  it('Drill: 90 ms on a speaker change, 90 ms within a paragraph', () => {
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'drill', nextRow: turnStart })).toBe(GAP_DEFAULT_MS)
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'drill', nextRow: sameSpeaker })).toBe(GAP_DRILL_MS)
  })
  it('outside a dialogue scene the steady between-phrases pause, whatever the row says', () => {
    expect(changeoverGapMs({ inDialogue: false, listenMode: 'immersion', nextRow: sameSpeaker })).toBe(GAP_DEFAULT_MS)
    expect(changeoverGapMs({ inDialogue: false, listenMode: 'immersion', nextRow: jumpIn })).toBe(GAP_DEFAULT_MS)
  })
})

describe('changeoverGapMs — a jump-in has no gap', () => {
  it('Immersion dialogue, next row jumps in → 0 ms', () => {
    expect(isJumpInChangeover({ inDialogue: true, listenMode: 'immersion', nextRow: jumpIn })).toBe(true)
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'immersion', nextRow: jumpIn })).toBe(0)
  })
  it('Drill keeps its gap even for a marked line — the sound before it is a drill rep, not the other speaker', () => {
    expect(isJumpInChangeover({ inDialogue: true, listenMode: 'drill', nextRow: jumpIn })).toBe(false)
    expect(changeoverGapMs({ inDialogue: true, listenMode: 'drill', nextRow: jumpIn })).toBe(GAP_DEFAULT_MS)
  })
  it('only a literal true counts — a truthy string or 1 from a loose payload is not a jump-in', () => {
    expect(isJumpInChangeover({ inDialogue: true, listenMode: 'immersion', nextRow: { jumpIn: 'yes' as unknown as boolean } })).toBe(false)
    expect(isJumpInChangeover({ inDialogue: true, listenMode: 'immersion', nextRow: { jumpIn: 1 as unknown as boolean } })).toBe(false)
  })
})

describe('jumpInLeadMs — the overlap, from the previous clip\'s own trailing silence', () => {
  it('with timings: trailing silence plus the fixed overlap', () => {
    // 2.0 s clip, last word ends at 1.7 s → 300 ms of silence + 120 ms overlap.
    expect(jumpInLeadMs({ prevDurationSec: 2.0, prevTimings: { ends: [0.4, 1.1, 1.7] } })).toBe(300 + JUMP_IN_OVERLAP_MS)
  })
  it('without timings: the fixed untimed lead', () => {
    expect(jumpInLeadMs({ prevDurationSec: 2.0, prevTimings: null })).toBe(JUMP_IN_LEAD_UNTIMED_MS)
    expect(jumpInLeadMs({ prevDurationSec: 2.0, prevTimings: { ends: [] } })).toBe(JUMP_IN_LEAD_UNTIMED_MS)
  })
  it('capped, so a long silent tail never swallows the last word', () => {
    expect(jumpInLeadMs({ prevDurationSec: 3.0, prevTimings: { ends: [0.5] } })).toBe(JUMP_IN_LEAD_MAX_MS)
  })
  it('never longer than the clip itself, never negative, and timings past the duration are ignored', () => {
    expect(jumpInLeadMs({ prevDurationSec: 0.1, prevTimings: null })).toBe(100)
    expect(jumpInLeadMs({ prevDurationSec: 2.0, prevTimings: { ends: [2.5] } })).toBe(JUMP_IN_LEAD_UNTIMED_MS)
    expect(jumpInLeadMs({ prevDurationSec: NaN, prevTimings: null })).toBe(JUMP_IN_LEAD_UNTIMED_MS)
    expect(jumpInLeadMs({ prevDurationSec: undefined, prevTimings: { ends: [1] } })).toBe(JUMP_IN_LEAD_UNTIMED_MS)
  })
})
