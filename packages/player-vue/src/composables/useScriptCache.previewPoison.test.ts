/**
 * #676 — a cached script that is the 19-seed FREE PREVIEW must never be served
 * to a learner who now holds a session token.
 *
 * How the poison gets in: `/api/courses/:code/bundle` answered `private,
 * max-age=300` with no `Vary: Authorization`, so a browser cache handed the
 * anonymous preview body to the very next authorised fetch of the same URL.
 * The player built a 57-round, seed-1-to-19 script from it and wrote it to
 * `ssi-script-cache` — keyed by course code, no TTL. From then on the payer's
 * Orange Belt read "isn't on this device yet" on that course, permanently.
 * That is what Tom hit on `zho_for_eng` while `fra`/`ita`/`jpn` were fine.
 *
 * The server half of the fix is `api/_utils/entitlementVary.ts`. This is the
 * healing half, for devices that already carry the poison.
 */

import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getCachedScript, setCachedScript } from './useScriptCache'
import { setCourseBundleAuthProvider } from './useCourseBundle'

const round = (seed: number) => ({
  seedId: `S${String(seed).padStart(4, '0')}`,
  legoId: `S${String(seed).padStart(4, '0')}L01`,
  roundNumber: seed,
  cycles: [],
})

const script = (maxSeed: number) => ({
  rounds: Array.from({ length: maxSeed }, (_, i) => round(i + 1)) as never,
  totalSeeds: maxSeed,
  totalLegos: maxSeed,
  totalCycles: 0,
  audioMapObj: {},
  mainLoopRoundCount: maxSeed,
})

describe('#676 preview-poison guard on the script cache', () => {
  beforeEach(() => {
    setCourseBundleAuthProvider(null)
    vi.restoreAllMocks()
  })

  it('discards a preview-extent script (stops at Yellow) for a signed-in learner', async () => {
    await setCachedScript('zho_for_eng', script(19) as never)
    setCourseBundleAuthProvider(async () => 'a-real-session-token')

    expect(await getCachedScript('zho_for_eng')).toBeNull()
    // …and it is GONE, not merely skipped, so the next write replaces it.
    setCourseBundleAuthProvider(null)
    expect(await getCachedScript('zho_for_eng')).toBeNull()
  })

  it('keeps the preview script for a signed-out visitor — it is the right script for them', async () => {
    await setCachedScript('zho_for_eng', script(19) as never)
    setCourseBundleAuthProvider(async () => null)

    const got = await getCachedScript('zho_for_eng')
    expect(got).not.toBeNull()
    expect(got!.rounds.length).toBe(19)
  })

  it('keeps a full-course script for a signed-in learner', async () => {
    await setCachedScript('fra_for_eng', script(120) as never)
    setCourseBundleAuthProvider(async () => 'a-real-session-token')

    const got = await getCachedScript('fra_for_eng')
    expect(got).not.toBeNull()
    expect(got!.rounds.length).toBe(120)
  })

  it('keeps a script that reaches exactly one seed past the preview ceiling', async () => {
    await setCachedScript('ita_for_eng', script(20) as never)
    setCourseBundleAuthProvider(async () => 'a-real-session-token')

    expect(await getCachedScript('ita_for_eng')).not.toBeNull()
  })
})
