/**
 * MetaCommentaryService — exposure persistence + encouragement taper.
 *
 * The owner ruling (2026-07-24): each learner hears each science bit
 * (instruction) ONCE, EVER — a replay is a bug. Server state
 * (learner_meta_commentary_state) is truth; a wiped device must recover from
 * it. Random encouragements dial down with experience and switch fully off
 * past a threshold (default: the first belt equivalent, 8 seeds).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  MetaCommentaryService,
  encouragementIntervalMultiplier,
  DEFAULT_ENCOURAGEMENT_TAPER,
} from './MetaCommentaryService'
import {
  backfillInstructionState,
} from './commentaryBackfillSpec'

const LEARNER_UUID = '11111111-2222-3333-4444-555555555555'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeInstructions(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `instr-${i}`,
    url: `https://audio/instr-${i}.mp3`,
    text: `Science bit ${i}`,
    position: i,
  }))
}

function fakeProvider(instructionCount = 5, encouragementCount = 3) {
  return {
    getCourseId: () => 'spa_for_eng',
    getInstructions: async () => makeInstructions(instructionCount),
    getEncouragements: async () =>
      Array.from({ length: encouragementCount }, (_, i) => ({
        id: `enc-${i}`,
        url: `https://audio/enc-${i}.mp3`,
        text: `Well done ${i}`,
      })),
    getWelcomeAudio: async () => null,
  } as any
}

/** In-memory stand-in for the learner_meta_commentary_state table. */
function fakeSupabase(store: Map<string, { instruction_index: number; instructions_complete: boolean }>) {
  return {
    from: (table: string) => {
      if (table !== 'learner_meta_commentary_state') throw new Error(`unexpected table ${table}`)
      return {
        select: () => ({
          eq: (_col: string, learnerId: string) => ({
            maybeSingle: async () => ({ data: store.get(learnerId) ?? null, error: null }),
          }),
        }),
        upsert: async (row: any) => {
          store.set(row.learner_id, {
            instruction_index: row.instruction_index,
            instructions_complete: row.instructions_complete,
          })
          return { error: null }
        },
      }
    },
  } as any
}

/** Drive rounds until the service fires, or `maxRounds` boundaries pass. */
function playUntilFire(svc: MetaCommentaryService, cyclesPerRound = 10, maxRounds = 100) {
  for (let r = 0; r < maxRounds; r++) {
    const c = svc.onRoundComplete(r + 1, cyclesPerRound, true)
    if (c) return { commentary: c, roundsElapsed: r + 1 }
  }
  return { commentary: null, roundsElapsed: maxRounds }
}

beforeEach(() => {
  localStorage.clear()
  // Kill interval jitter: factor = 1 + (2*0.5 - 1)*0.3 = 1 → interval is
  // exactly BASE_INTERVAL_CYCLES (55). Also makes the shuffle deterministic.
  vi.spyOn(Math, 'random').mockReturnValue(0.5)
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Once-ever invariant
// ---------------------------------------------------------------------------

describe('once-ever instruction exposure', () => {
  it('plays instructions strictly in order, never repeating one', async () => {
    const svc = new MetaCommentaryService(fakeProvider(3), LEARNER_UUID, null)
    await svc.initialize()
    const heard: number[] = []
    for (let i = 0; i < 3; i++) {
      const { commentary } = playUntilFire(svc)
      expect(commentary?.type).toBe('instruction')
      heard.push((commentary as any).position)
    }
    expect(heard).toEqual([0, 1, 2])
    // Sequence exhausted — everything after is an encouragement, never a replay.
    const { commentary } = playUntilFire(svc)
    expect(commentary?.type).toBe('encouragement')
  })

  it('recovers exposure from the server after a simulated device wipe', async () => {
    const store = new Map()
    const supabase = fakeSupabase(store)

    // Session 1: hear two instructions; progress mirrors to the server.
    const svc1 = new MetaCommentaryService(fakeProvider(5), LEARNER_UUID, supabase)
    await svc1.initialize()
    playUntilFire(svc1)
    playUntilFire(svc1)
    // Fire-and-forget server writes — let them settle.
    await new Promise((r) => setTimeout(r, 0))
    expect(store.get(LEARNER_UUID)?.instruction_index).toBe(2)

    // Device wipe (?reset=1 clears ALL localStorage).
    localStorage.clear()

    // Session 2 on the wiped device: server is truth — no replay of bits 0/1.
    const svc2 = new MetaCommentaryService(fakeProvider(5), LEARNER_UUID, supabase)
    await svc2.initialize()
    const { commentary } = playUntilFire(svc2)
    expect(commentary?.type).toBe('instruction')
    expect((commentary as any).position).toBe(2)
  })

  it('completing the sequence persists instructions_complete to the server', async () => {
    const store = new Map()
    const svc = new MetaCommentaryService(fakeProvider(2), LEARNER_UUID, fakeSupabase(store))
    await svc.initialize()
    playUntilFire(svc)
    playUntilFire(svc)
    await new Promise((r) => setTimeout(r, 0))
    expect(store.get(LEARNER_UUID)?.instructions_complete).toBe(true)

    // Wiped device + complete server row ⇒ instructions never play again.
    localStorage.clear()
    const svc2 = new MetaCommentaryService(fakeProvider(2), LEARNER_UUID, fakeSupabase(store))
    await svc2.initialize()
    const { commentary } = playUntilFire(svc2)
    expect(commentary?.type).toBe('encouragement')
  })

  it('local progress ahead of the server (offline play) is pushed up on init', async () => {
    const store = new Map()
    store.set(LEARNER_UUID, { instruction_index: 1, instructions_complete: false })
    localStorage.setItem(
      `ssi_commentary_global_${LEARNER_UUID}`,
      JSON.stringify({ instructionIndex: 4, instructionsComplete: false }),
    )
    const svc = new MetaCommentaryService(fakeProvider(5), LEARNER_UUID, fakeSupabase(store))
    await svc.initialize()
    await new Promise((r) => setTimeout(r, 0))
    expect(store.get(LEARNER_UUID)?.instruction_index).toBe(4)
    const { commentary } = playUntilFire(svc)
    expect((commentary as any).position).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Identity re-key (guest → signed-in)
// ---------------------------------------------------------------------------

describe('setLearnerId re-key', () => {
  it('adopts the server truth when the real learner id resolves after setup', async () => {
    const store = new Map()
    store.set(LEARNER_UUID, { instruction_index: 3, instructions_complete: false })
    const supabase = fakeSupabase(store)

    // Constructed with the guest snapshot (the setup-time race): no sync.
    const svc = new MetaCommentaryService(fakeProvider(5), 'guest-abc', supabase)
    await svc.initialize()
    expect(svc.getInstructionProgress().current).toBe(0)

    svc.setLearnerId(LEARNER_UUID)
    await new Promise((r) => setTimeout(r, 0))
    expect(svc.getInstructionProgress().current).toBe(3)
    const { commentary } = playUntilFire(svc)
    expect((commentary as any).position).toBe(3)
  })

  it('carries progress made under the guest identity forward (furthest wins)', async () => {
    const store = new Map()
    store.set(LEARNER_UUID, { instruction_index: 1, instructions_complete: false })
    const supabase = fakeSupabase(store)

    const svc = new MetaCommentaryService(fakeProvider(5), 'guest-abc', supabase)
    await svc.initialize()
    playUntilFire(svc) // heard bit 0 as guest
    playUntilFire(svc) // heard bit 1 as guest

    svc.setLearnerId(LEARNER_UUID)
    await new Promise((r) => setTimeout(r, 0))
    // Guest progress (2) beats the stale server row (1) — and is pushed up.
    expect(svc.getInstructionProgress().current).toBe(2)
    expect(store.get(LEARNER_UUID)?.instruction_index).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Encouragement taper
// ---------------------------------------------------------------------------

// The unit is CUMULATIVE CROSS-COURSE LEARNING MINUTES (owner ruling
// 2026-08-06), not the current course's seed position. Defaults: full
// frequency below 600 min (10h), off at/past 1800 min (30h).
const HOURS = 60

describe('encouragementIntervalMultiplier', () => {
  it('is 1 (full frequency) for a genuine beginner', () => {
    expect(encouragementIntervalMultiplier(0)).toBe(1)
    expect(encouragementIntervalMultiplier(5 * HOURS)).toBe(1) // still under the start
  })
  it('stretches the interval smoothly through the taper zone', () => {
    expect(encouragementIntervalMultiplier(20 * HOURS)).toBeCloseTo(2) // halfway → 2×
    expect(encouragementIntervalMultiplier(25 * HOURS)).toBeCloseTo(4) // 3/4 → 4×
  })
  it('grows monotonically with cumulative time through the zone', () => {
    const points = [11, 15, 20, 25, 29].map((h) => encouragementIntervalMultiplier(h * HOURS))
    points.forEach((m) => expect(m).toBeGreaterThan(1))
    for (let i = 1; i < points.length; i++) expect(points[i]).toBeGreaterThan(points[i - 1])
  })
  it('is off (Infinity) at and past Toms 30-hour threshold', () => {
    expect(encouragementIntervalMultiplier(30 * HOURS)).toBe(Infinity)
    expect(encouragementIntervalMultiplier(500 * HOURS)).toBe(Infinity)
  })
  it('respects a custom taper window', () => {
    const cfg = { taperStartMinutes: 100, offAtMinutes: 200 }
    expect(encouragementIntervalMultiplier(50, cfg)).toBe(1)
    expect(encouragementIntervalMultiplier(150, cfg)).toBeCloseTo(2)
    expect(encouragementIntervalMultiplier(250, cfg)).toBe(Infinity)
  })
  it('degenerate config (off <= start) is a hard cutoff', () => {
    const cfg = { taperStartMinutes: 300, offAtMinutes: 300 }
    expect(encouragementIntervalMultiplier(299, cfg)).toBe(1)
    expect(encouragementIntervalMultiplier(300, cfg)).toBe(Infinity)
  })
  it('ignores a stale seed-denominated config and uses the new defaults', () => {
    // A pre-2026-08-06 algorithm_config row. Honouring `offAtSeeds: 8` as
    // minutes would kill encouragements after 8 minutes of learning.
    const stale = { taperStartSeeds: 0, offAtSeeds: 8 } as any
    expect(encouragementIntervalMultiplier(0, stale)).toBe(1)
    expect(encouragementIntervalMultiplier(60, stale)).toBe(1) // 1h in: still full
    expect(encouragementIntervalMultiplier(30 * HOURS, stale)).toBe(Infinity)
  })
  it('missing/garbage keys do not throw', () => {
    expect(() => encouragementIntervalMultiplier(60, {} as any)).not.toThrow()
    expect(encouragementIntervalMultiplier(60, {} as any)).toBe(1)
    expect(encouragementIntervalMultiplier(60, { offAtMinutes: NaN } as any)).toBe(1)
    expect(encouragementIntervalMultiplier(60, null)).toBe(1)
  })
})

describe('taper gating in onRoundComplete', () => {
  async function encouragementPhaseService(minutes: number | null) {
    // 0 instructions ⇒ straight to encouragement phase.
    const svc = new MetaCommentaryService(fakeProvider(0, 3), LEARNER_UUID, null)
    await svc.initialize()
    svc.setCumulativeLearningMinutes(minutes)
    return svc
  }

  it('fires encouragements at base cadence for a fresh learner', async () => {
    const svc = await encouragementPhaseService(0)
    const { commentary, roundsElapsed } = playUntilFire(svc)
    expect(commentary?.type).toBe('encouragement')
    expect(roundsElapsed).toBe(6) // 55-cycle interval / 10 cycles per round
  })

  it('treats an unknown (null) cumulative time as a beginner', async () => {
    // Guest / offline / server number not landed yet — over-encouraging a
    // beginner beats patronising a veteran, and a beginner is the likelier
    // person behind a missing signal.
    const svc = await encouragementPhaseService(null)
    const { commentary } = playUntilFire(svc)
    expect(commentary?.type).toBe('encouragement')
  })

  it('stretches the gap mid-taper', async () => {
    const svc = await encouragementPhaseService(20 * HOURS) // halfway → 2× interval
    const { roundsElapsed } = playUntilFire(svc)
    expect(roundsElapsed).toBe(11) // 110 cycles instead of 55
  })

  it('never fires past the off threshold (default: 30 cumulative hours)', async () => {
    const svc = await encouragementPhaseService(30 * HOURS)
    const { commentary } = playUntilFire(svc, 10, 500)
    expect(commentary).toBeNull()
  })

  // REGRESSION — Tom's bug, staging 2026-08-06. He was on SEED 2 of a brand new
  // German course with hundreds of hours across all his other courses, and got
  // Aran's beginner encouragement. Position in the current course must have NO
  // say; only cumulative cross-course time does. Must never break silently.
  it('REGRESSION: seed 2 of a fresh course + 100h cumulative ⇒ no encouragement', async () => {
    const svc = await encouragementPhaseService(100 * HOURS)
    const { commentary } = playUntilFire(svc, 10, 500)
    expect(commentary).toBeNull()
  })

  it('never tapers instructions — the science bits play regardless of experience', async () => {
    const svc = new MetaCommentaryService(fakeProvider(3, 3), LEARNER_UUID, null)
    await svc.initialize()
    svc.setCumulativeLearningMinutes(100 * HOURS) // the same veteran
    const { commentary, roundsElapsed } = playUntilFire(svc)
    expect(commentary?.type).toBe('instruction')
    expect((commentary as any).position).toBe(0)
    expect(roundsElapsed).toBe(6) // base cadence, untapered
  })

  it('admin config override moves the threshold', async () => {
    const svc = await encouragementPhaseService(100 * HOURS)
    svc.setEncouragementTaper({ taperStartMinutes: 0, offAtMinutes: 500 * HOURS })
    const { commentary } = playUntilFire(svc, 10, 500)
    expect(commentary?.type).toBe('encouragement')
  })

  it('null config falls back to the default taper', async () => {
    const svc = await encouragementPhaseService(30 * HOURS)
    svc.setEncouragementTaper(null)
    expect(encouragementIntervalMultiplier(30 * HOURS, DEFAULT_ENCOURAGEMENT_TAPER)).toBe(Infinity)
    const { commentary } = playUntilFire(svc, 10, 500)
    expect(commentary).toBeNull()
  })

  it('a stale seed-denominated config does not silently kill encouragements', async () => {
    const svc = await encouragementPhaseService(60) // 1 hour of learning
    svc.setEncouragementTaper({ taperStartSeeds: 0, offAtSeeds: 8 } as any)
    const { commentary } = playUntilFire(svc)
    expect(commentary?.type).toBe('encouragement')
  })
})

// ---------------------------------------------------------------------------
// Backfill rule (executable spec of the gated SQL)
// ---------------------------------------------------------------------------

describe('backfillInstructionState (spec for 20260724 gated migration)', () => {
  it('no evidence ⇒ no row (genuinely new learners start at 0)', () => {
    const r = backfillInstructionState({
      existingIndex: 0, existingComplete: false,
      telemetryInstructionCount: 0, totalPracticeMinutes: 0,
    })
    expect(r.instructionIndex).toBeNull()
  })

  it('telemetry count restores the index', () => {
    const r = backfillInstructionState({
      existingIndex: 0, existingComplete: false,
      telemetryInstructionCount: 12, totalPracticeMinutes: 0,
    })
    expect(r).toEqual({ instructionIndex: 12, instructionsComplete: false })
  })

  it('practice minutes estimate 1 instruction per 10 min, capped at 30', () => {
    const r = backfillInstructionState({
      existingIndex: 0, existingComplete: false,
      telemetryInstructionCount: 0, totalPracticeMinutes: 125,
    })
    expect(r.instructionIndex).toBe(12)
    const veteran = backfillInstructionState({
      existingIndex: 0, existingComplete: false,
      telemetryInstructionCount: 0, totalPracticeMinutes: 160 * 60, // Tom: 160 hours
    })
    expect(veteran).toEqual({ instructionIndex: 30, instructionsComplete: true })
  })

  it('furthest signal wins; existing row only ever ratchets forward', () => {
    const r = backfillInstructionState({
      existingIndex: 20, existingComplete: false,
      telemetryInstructionCount: 5, totalPracticeMinutes: 100,
    })
    expect(r).toEqual({ instructionIndex: 20, instructionsComplete: false })
  })

  it('existing complete flag is never revoked', () => {
    const r = backfillInstructionState({
      existingIndex: 30, existingComplete: true,
      telemetryInstructionCount: 1, totalPracticeMinutes: 10,
    })
    expect(r.instructionsComplete).toBe(true)
  })

  it('sub-threshold minutes alone are not evidence', () => {
    const r = backfillInstructionState({
      existingIndex: 0, existingComplete: false,
      telemetryInstructionCount: 0, totalPracticeMinutes: 20,
    })
    expect(r.instructionIndex).toBeNull()
  })
})
