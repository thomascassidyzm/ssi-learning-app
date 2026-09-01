/**
 * sectorMerge — the two-thread merge scheduler for the sector helix.
 *
 * WHY (Tom, 2026-09-01): "I'm a nurse and I want rn to be learning things that
 * relate to my work — not after I've done 30 hours of core content SEEDS that
 * all learners get." A sector thread runs ALONGSIDE the core course from the
 * start. This module is the ordering rule for that.
 *
 * THE RULES IT ENCODES (ratified — do not re-open):
 *
 *  • THREADS SWAP AT SEED BOUNDARIES ONLY, never at round boundaries. "It's
 *    continuity over rounds that leads to the completion of a SEED." So the
 *    merge plays ALL rounds of the next core seed, then ALL rounds of the next
 *    sector seed, then all rounds of the next core seed… Core goes first. The
 *    result is DELIBERATELY ASYMMETRIC in rounds (a five-round core seed
 *    against a one-round sector seed) — ruled-correct behaviour, not a defect.
 *
 *  • ONE TOTAL-ROUNDS COUNTER across both threads drives listening laps.
 *    The lap cadence arithmetic is NOT reimplemented here: the caller injects
 *    `shouldFireLapAt`, which in the app is usePodLapScheduler's own function
 *    (activation 6, interval 5, unchanged). Which pod stream serves a due lap
 *    alternates with the thread whose seed is in play — the core thread's laps
 *    draw against `course_enrollments.completed_pod_rounds`, the sector
 *    thread's against `enrollment_threads.completed_pod_rounds`. Each ratchet
 *    advances only on delivery, so a deferred lap leaves it where it was.
 *    Laps land mid-seed; they already do today, and a lap never moves a thread
 *    boundary.
 *
 *  • ROUND NUMBERING INSIDE EACH THREAD IS UNTOUCHED. Round numbers are the
 *    spine (round-map view, resume anchors, Fibonacci review pairing). The
 *    merge ORDERS rounds; it never renumbers one and never drops one. Shared
 *    chunks are deduped at AUTHORING time (is_new=false), so there is NO
 *    runtime dedupe here and none must ever be added.
 *
 *  • PASSTHROUGH GUARANTEE. Gate closed, thread absent, thread inactive, or
 *    sector script exhausted → the merge is a pure passthrough of the core
 *    thread, byte-for-byte today's ordering. That is the whole-population
 *    no-strand guarantee.
 *
 *  • STATEFUL CURSOR, not a precomputed list. The player loads rounds lazily
 *    and incrementally (useInstantPlayback + SimplePlayer.addRounds), so this
 *    is a pull API over whatever is loaded so far. When the rounds it needs
 *    have not arrived it says `waiting` — it never swaps early and never
 *    silently reorders.
 *
 *  • Per-thread state is EXACTLY cursor, ceiling, cycle index, pod ratchet.
 *    Review needs NO new state: spaced repetition is positional within each
 *    script, so a thread parked for a month resumes intact. Nothing about
 *    review lives here.
 */

import type { Round } from './SimplePlayer'

export type ThreadKey = 'core' | 'sector'

/** One thread's lazily-growing window onto its own script. */
export interface ThreadView {
  /** Rounds loaded so far, in the thread's own play order. */
  rounds: readonly Round[]
  /**
   * True once every remaining round of this thread's script is present in
   * `rounds` — i.e. nothing more is coming. Distinguishes "end of script"
   * from "not loaded yet", which is the whole of the lazy-loading contract.
   */
  complete: boolean
}

export interface MergeInputs {
  core: ThreadView
  /** Absent when the learner has no sector thread at all. */
  sector?: ThreadView | null
  /**
   * True only when the sector thread exists, is `active`, and the learner's
   * core ceiling has reached the segment's `core_anchor_lego_id`. False for
   * every learner today → pure core passthrough.
   */
  sectorEnabled: boolean
}

export interface MergeRound {
  status: 'round'
  /** Which thread this round came from. */
  thread: ThreadKey
  /** The round itself — unmodified, unrenumbered. */
  round: Round
  /** 1-based count across BOTH threads. The listening-lap counter. */
  totalRound: number
  /** True when a listening lap is due on entering this round. */
  lapDue: boolean
  /**
   * Pod ratchet a due lap draws against: 'core' →
   * course_enrollments.completed_pod_rounds, 'sector' →
   * enrollment_threads.completed_pod_rounds. Equals `thread`.
   */
  lapStream: ThreadKey
}

/** The rounds needed next have not loaded yet. Ask again once they have. */
export interface MergeWaiting {
  status: 'waiting'
  waitingOn: ThreadKey
}

/** Both threads have run out. */
export interface MergeExhausted {
  status: 'exhausted'
}

export type MergeResult = MergeRound | MergeWaiting | MergeExhausted

/** Everything the merge remembers. Serialisable; safe to persist. */
export interface SectorMergeState {
  /** Index of the next unconsumed round in the core thread. */
  coreIndex: number
  /** Index of the next unconsumed round in the sector thread. Frozen while off. */
  sectorIndex: number
  /** Rounds served across both threads so far — the lap counter. */
  totalRounds: number
  /** Thread currently mid-stint. */
  serving: ThreadKey
  /** Seed of the stint in progress, or null when the next round starts a stint. */
  servingSeedId: string | null
}

export interface SectorMergeOptions {
  /**
   * Lap cadence predicate over the TOTAL round counter. In the app this is
   * usePodLapScheduler's `shouldFireLapAt` — passed in, never reimplemented.
   * Omitted → no laps are ever reported (the merge is ordering-only).
   */
  shouldFireLapAt?: (totalRound: number) => boolean
  /** Resume state. Defaults to a fresh cursor at the top of the core thread. */
  initial?: Partial<SectorMergeState>
}

const FRESH: SectorMergeState = {
  coreIndex: 0,
  sectorIndex: 0,
  totalRounds: 0,
  serving: 'core',
  servingSeedId: null,
}

type Peeked =
  | { kind: 'round'; round: Round }
  | { kind: 'waiting' }
  | { kind: 'exhausted' }

const EMPTY_VIEW: ThreadView = { rounds: [], complete: true }

/**
 * The merge cursor. Pull `next(inputs)` once per round boundary; feed it the
 * rounds loaded so far each time.
 */
export class SectorMergeCursor {
  private st: SectorMergeState
  private readonly lapAt: (totalRound: number) => boolean

  constructor(options: SectorMergeOptions = {}) {
    this.st = { ...FRESH, ...(options.initial ?? {}) }
    this.lapAt = options.shouldFireLapAt ?? (() => false)
  }

  get state(): Readonly<SectorMergeState> {
    return { ...this.st }
  }

  /** Overwrite the cursor (resume, role change, reset). */
  setState(patch: Partial<SectorMergeState>): void {
    this.st = { ...this.st, ...patch }
  }

  /** What `next()` would return, without advancing anything. */
  peek(inputs: MergeInputs): MergeResult {
    const saved = { ...this.st }
    const result = this.next(inputs)
    this.st = saved
    return result
  }

  /** Serve the next round in merged order, advancing the cursor. */
  next(inputs: MergeInputs): MergeResult {
    const sectorLive = inputs.sectorEnabled && !!inputs.sector

    // Toggle-off mid-session (or gate closed): collapse to core alone and
    // leave the sector cursor frozen exactly where it was.
    if (!sectorLive && this.st.serving === 'sector') {
      this.st.serving = 'core'
      this.st.servingSeedId = null
    }

    const serving = sectorLive ? this.st.serving : 'core'
    const other: ThreadKey = serving === 'core' ? 'sector' : 'core'

    const head = this.peekThread(serving, inputs)

    if (head.kind === 'waiting') {
      // Mid-seed and the rest of this seed has not arrived. Do NOT treat a
      // short load as a seed boundary — that would swap early and reorder the
      // course permanently.
      return { status: 'waiting', waitingOn: serving }
    }

    if (head.kind === 'exhausted') {
      if (!sectorLive) return { status: 'exhausted' }
      const alt = this.peekThread(other, inputs)
      if (alt.kind === 'round') {
        this.st.serving = other
        this.st.servingSeedId = null
        return this.serve(other, alt.round)
      }
      return alt.kind === 'waiting'
        ? { status: 'waiting', waitingOn: other }
        : { status: 'exhausted' }
    }

    const continuesSeed =
      this.st.servingSeedId === null || head.round.seedId === this.st.servingSeedId

    if (continuesSeed) return this.serve(serving, head.round)

    // Seed boundary on the serving thread — this is the ONLY place a swap
    // happens.
    if (!sectorLive) return this.serve(serving, head.round)

    const alt = this.peekThread(other, inputs)
    if (alt.kind === 'round') {
      this.st.serving = other
      this.st.servingSeedId = null
      return this.serve(other, alt.round)
    }
    if (alt.kind === 'exhausted') {
      // Other thread done for good — carry on alone, next seed included.
      return this.serve(serving, head.round)
    }
    // The thread we owe the next stint to has nothing loaded yet.
    return { status: 'waiting', waitingOn: other }
  }

  private viewOf(thread: ThreadKey, inputs: MergeInputs): ThreadView {
    if (thread === 'core') return inputs.core
    return inputs.sector ?? EMPTY_VIEW
  }

  private indexOf(thread: ThreadKey): number {
    return thread === 'core' ? this.st.coreIndex : this.st.sectorIndex
  }

  private peekThread(thread: ThreadKey, inputs: MergeInputs): Peeked {
    const view = this.viewOf(thread, inputs)
    const idx = this.indexOf(thread)
    if (idx < view.rounds.length) return { kind: 'round', round: view.rounds[idx] }
    return view.complete ? { kind: 'exhausted' } : { kind: 'waiting' }
  }

  private serve(thread: ThreadKey, round: Round): MergeRound {
    if (thread === 'core') this.st.coreIndex += 1
    else this.st.sectorIndex += 1
    this.st.serving = thread
    this.st.servingSeedId = round.seedId
    this.st.totalRounds += 1
    const totalRound = this.st.totalRounds
    return {
      status: 'round',
      thread,
      round,
      totalRound,
      lapDue: this.lapAt(totalRound),
      lapStream: thread,
    }
  }
}

/**
 * Pure preview of the first `n` merged entries from two fully-loaded scripts.
 * For tests and for the verification artefact — never used by playback.
 */
export function mergePreview(
  core: readonly Round[],
  sector: readonly Round[] | null,
  n: number,
  options: { shouldFireLapAt?: (totalRound: number) => boolean } = {},
): MergeRound[] {
  const cursor = new SectorMergeCursor({ shouldFireLapAt: options.shouldFireLapAt })
  const inputs: MergeInputs = {
    core: { rounds: core, complete: true },
    sector: sector ? { rounds: sector, complete: true } : null,
    sectorEnabled: !!sector,
  }
  const out: MergeRound[] = []
  while (out.length < n) {
    const r = cursor.next(inputs)
    if (r.status !== 'round') break
    out.push(r)
  }
  return out
}

/**
 * Entry gate: has the learner's core ceiling reached the segment's anchor?
 *
 * LEGO ids are zero-padded `S####L##`, so ordering is a numeric compare of
 * (seed, lego). Returns false when either id is missing or unparseable — a
 * closed gate is the safe answer, and a closed gate is a pure core passthrough.
 */
export function hasReachedAnchor(
  highestCompletedLegoId: string | null | undefined,
  anchorLegoId: string | null | undefined,
): boolean {
  const a = parseLegoId(highestCompletedLegoId)
  const b = parseLegoId(anchorLegoId)
  if (!a || !b) return false
  if (a.seed !== b.seed) return a.seed > b.seed
  return a.lego >= b.lego
}

function parseLegoId(id: string | null | undefined): { seed: number; lego: number } | null {
  if (!id) return null
  const m = /^S(\d+)L(\d+)/i.exec(id.trim())
  if (!m) return null
  return { seed: parseInt(m[1], 10), lego: parseInt(m[2], 10) }
}
