/**
 * useSectorMerge — the integration seam for the sector-helix merge scheduler.
 *
 * The ordering rule itself lives in `playback/sectorMerge.ts` (pure, framework
 * free). This composable is the thin reactive wrapper the player would hold:
 * it owns one `SectorMergeCursor`, exposes its state as refs, and pulls the
 * next merged round from whatever rounds each thread has loaded so far.
 *
 * NOT WIRED INTO PLAYBACK YET, deliberately: no sector segment has any content
 * in the estate, so a merge spliced into every learner's session could not be
 * exercised. Everything here is written so wiring it in later is a small diff —
 * see the module header of sectorMerge.ts for the rules it guarantees, and note
 * the passthrough case (no sector / inactive / gate closed) reproduces today's
 * core ordering exactly.
 *
 * Lap cadence is INJECTED, never reimplemented: pass
 * usePodLapScheduler's own `shouldFireLapAt`.
 */

import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import {
  SectorMergeCursor,
  type MergeInputs,
  type MergeResult,
  type MergeRound,
  type SectorMergeState,
  type ThreadKey,
  type ThreadView,
} from '../playback/sectorMerge'

export interface UseSectorMergeOptions {
  /** Core thread's loaded rounds + whether the script is fully loaded. */
  core: () => ThreadView
  /** Sector thread view, or null when the learner has no sector thread. */
  sector?: () => ThreadView | null
  /**
   * Sector thread exists, `active`, and the core ceiling has reached the
   * segment's anchor (see `hasReachedAnchor`). False → pure core passthrough.
   */
  sectorEnabled?: () => boolean
  /** usePodLapScheduler's `shouldFireLapAt`, over the TOTAL rounds counter. */
  shouldFireLapAt?: (totalRound: number) => boolean
  /** Resume state, e.g. rehydrated from enrollment_threads. */
  initial?: Partial<SectorMergeState>
}

export interface UseSectorMergeReturn {
  /** Serve the next round in merged order; advances the cursor on 'round'. */
  nextRound: () => MergeResult
  /** Same answer, no advance. */
  peekRound: () => MergeResult
  /** The last round actually served, for the UI / telemetry. */
  lastServed: Ref<MergeRound | null>
  /** Rounds served across BOTH threads — the listening-lap counter. */
  totalRounds: ComputedRef<number>
  /** Thread currently mid-stint. */
  activeThread: ComputedRef<ThreadKey>
  /** True when the merge is behaving as a plain core passthrough. */
  isPassthrough: ComputedRef<boolean>
  /** Serialisable cursor state — cursor only; no review state exists here. */
  snapshot: () => Readonly<SectorMergeState>
  /** Overwrite the cursor (resume, role change, reset). */
  restore: (patch: Partial<SectorMergeState>) => void
}

export function useSectorMerge(options: UseSectorMergeOptions): UseSectorMergeReturn {
  const cursor = new SectorMergeCursor({
    shouldFireLapAt: options.shouldFireLapAt,
    initial: options.initial,
  })

  const lastServed = shallowRef<MergeRound | null>(null)
  const stateRef = ref<SectorMergeState>({ ...cursor.state })

  const inputs = (): MergeInputs => {
    const sector = options.sector?.() ?? null
    return {
      core: options.core(),
      sector,
      sectorEnabled: !!sector && (options.sectorEnabled?.() ?? false),
    }
  }

  const nextRound = (): MergeResult => {
    const result = cursor.next(inputs())
    stateRef.value = { ...cursor.state }
    if (result.status === 'round') lastServed.value = result
    return result
  }

  const peekRound = (): MergeResult => cursor.peek(inputs())

  return {
    nextRound,
    peekRound,
    lastServed,
    totalRounds: computed(() => stateRef.value.totalRounds),
    activeThread: computed(() => stateRef.value.serving),
    isPassthrough: computed(() => !inputs().sectorEnabled),
    snapshot: () => cursor.state,
    restore: (patch) => {
      cursor.setState(patch)
      stateRef.value = { ...cursor.state }
    },
  }
}
