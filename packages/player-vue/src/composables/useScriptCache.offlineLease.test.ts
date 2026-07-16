/**
 * Learner-scoped offline lease — vitest, fake-indexeddb.
 *
 * FAMILY-PLAN-SPEC.md §5: the lease must partition per signed-in user on a
 * shared device, not live once per course. Covers: two users/one course,
 * legacy single-lease adoption into the current user's slot (persisted,
 * once), the anon bucket, and the sign-out/sign-in flip.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  getCachedScript,
  setCachedScript,
  getOfflineLease,
  setOfflineLease,
  getAllOfflineLeases,
  type CachedScript,
} from './useScriptCache'
import type { OfflineLease } from '../config/offlineLease'

const NOW = 1_700_000_000_000

function makeLease(over: Partial<OfflineLease> = {}): OfflineLease {
  return {
    grantedAt: NOW,
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    lastValidatedAt: NOW,
    ...over,
  }
}

async function seedScript(courseCode: string, extra: Partial<CachedScript> = {}): Promise<void> {
  await setCachedScript(courseCode, {
    rounds: [{ roundNumber: 1, legoId: 'L1', seedId: 'S1', items: [] }],
    totalSeeds: 1,
    totalLegos: 1,
    totalCycles: 1,
    audioMapObj: {},
    ...extra,
  } as any)
}

// Unique course code AND user id per test — the scriptDb connection is
// module-cached and not reset between tests (a full-store scan like
// getAllOfflineLeases sees every course ever seeded in this file), so
// isolation comes from never reusing a course code or user id across tests.
let seq = 0
const courseCode = () => `family-lease-test-${++seq}`
const userId = (label: string) => `${label}-${++seq}`

describe('offline lease — per-user keying', () => {
  it('gives two users on the same course their own independent lease slots', async () => {
    const code = courseCode()
    await seedScript(code)
    const leaseA = makeLease({ expiresAt: NOW + 10 * 24 * 60 * 60 * 1000 })
    const leaseB = makeLease({ expiresAt: NOW + 20 * 24 * 60 * 60 * 1000 })

    expect(await setOfflineLease(code, 'user-A', leaseA)).toBe(true)
    expect(await setOfflineLease(code, 'user-B', leaseB)).toBe(true)

    expect(await getOfflineLease(code, 'user-A')).toEqual(leaseA)
    expect(await getOfflineLease(code, 'user-B')).toEqual(leaseB)
    // A third, never-leased user on the same shared device gets nothing.
    expect(await getOfflineLease(code, 'user-C')).toBeNull()
  })

  it('gives a signed-out user their own anon bucket, independent of any signed-in lease', async () => {
    const code = courseCode()
    await seedScript(code)
    const leaseSignedIn = makeLease()
    await setOfflineLease(code, 'user-A', leaseSignedIn)

    expect(await getOfflineLease(code, 'anon')).toBeNull()

    const anonLease = makeLease({ expiresAt: NOW + 5 * 24 * 60 * 60 * 1000 })
    await setOfflineLease(code, 'anon', anonLease)
    expect(await getOfflineLease(code, 'anon')).toEqual(anonLease)
    expect(await getOfflineLease(code, 'user-A')).toEqual(leaseSignedIn) // untouched
  })

  it('is a no-op (returns false) for a course that was never downloaded', async () => {
    const code = courseCode()
    expect(await setOfflineLease(code, 'user-A', makeLease())).toBe(false)
    expect(await getOfflineLease(code, 'user-A')).toBeNull()
  })

  it('adopts a legacy single-lease field into the current user\'s slot and persists the migration once', async () => {
    const code = courseCode()
    const legacyLease = makeLease({ expiresAt: NOW + 7 * 24 * 60 * 60 * 1000 })
    // Simulate a pre-family-plan cache: the old single `offlineLease` field,
    // no `offlineLeases` map yet.
    await seedScript(code, { offlineLease: legacyLease } as any)

    const adopted = await getOfflineLease(code, 'user-A')
    expect(adopted).toEqual(legacyLease)

    // Persisted: re-reading the raw row shows the map, legacy field gone.
    const raw = await getCachedScript(code)
    expect(raw?.offlineLeases).toEqual({ 'user-A': legacyLease })
    expect(raw?.offlineLease).toBeUndefined()
  })

  it('does NOT retroactively adopt a legacy lease for a second user once it has been claimed', async () => {
    const code = courseCode()
    const legacyLease = makeLease()
    await seedScript(code, { offlineLease: legacyLease } as any)

    await getOfflineLease(code, 'user-A') // adopts + persists under user-A
    expect(await getOfflineLease(code, 'user-B')).toBeNull() // sibling gets nothing
  })

  it('sign-out/sign-in flip: a course downloaded while signed out stays in the anon bucket after sign-in', async () => {
    const code = courseCode()
    await seedScript(code)
    const anonLease = makeLease()
    await setOfflineLease(code, 'anon', anonLease)

    // App reload, learner signs in as user-A — the anon lease does not
    // silently become user-A's lease.
    expect(await getOfflineLease(code, 'user-A')).toBeNull()
    expect(await getOfflineLease(code, 'anon')).toEqual(anonLease)
  })

  it('getAllOfflineLeases scopes to the requesting user only, across multiple courses', async () => {
    // getAllOfflineLeases is a full-store scan (every course ever seeded in
    // this file), so it needs user ids unique to THIS test, unlike the
    // single-course read/write tests above which are isolated by course code.
    const [uA, uB] = [userId('user'), userId('user')]
    const codeA = courseCode()
    const codeB = courseCode()
    await seedScript(codeA)
    await seedScript(codeB)
    await setOfflineLease(codeA, uA, makeLease())
    await setOfflineLease(codeB, uA, makeLease())
    await setOfflineLease(codeA, uB, makeLease())

    const forA = await getAllOfflineLeases(uA)
    expect(forA.map((l) => l.courseCode).sort()).toEqual([codeA, codeB].sort())

    const forB = await getAllOfflineLeases(uB)
    expect(forB.map((l) => l.courseCode)).toEqual([codeA])
  })

  it('getAllOfflineLeases includes a legacy lease adopted in-memory for the requesting user', async () => {
    const uA = userId('user')
    const code = courseCode()
    const legacyLease = makeLease()
    await seedScript(code, { offlineLease: legacyLease } as any)

    const forA = await getAllOfflineLeases(uA)
    expect(forA).toEqual([{ courseCode: code, lease: legacyLease }])

    // Seal the claim (mirrors the real renewer, which always follows a scan
    // with a persisting setOfflineLease) — an unclaimed legacy row must not
    // leak into every later full-store scan in this file for a fresh user id.
    await getOfflineLease(code, uA)
  })

  it('a legacy lease is claimed for good only once something actually persists the adoption', async () => {
    const [uA, uB] = [userId('user'), userId('user')]
    const code = courseCode()
    const legacyLease = makeLease()
    await seedScript(code, { offlineLease: legacyLease } as any)

    // The renewer's real sequence: scan, then act with a persisting call
    // (setOfflineLease/getOfflineLease) — this is what actually claims the row.
    await getOfflineLease(code, uA)

    // Now that user-A's claim is persisted, a second user scanning the same
    // row sees nothing — the legacy lease cannot be claimed twice.
    const forB = await getAllOfflineLeases(uB)
    expect(forB).toEqual([])
  })
})
