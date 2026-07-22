/**
 * Structural cache freshness — the content_stamp lane of checkContentVersion.
 * vitest, fake-indexeddb.
 *
 * courses.content_stamp is trigger-maintained in the DB (migration
 * 20260722_course_content_stamp.sql): any learner-visible content write moves
 * it. The client compares it against the vintage recorded on each cache
 * entry. Covers:
 *  1. stamp moved (incl. pre-stamp entries) → script cache entry dropped,
 *     listening bundle refresh dispatched.
 *  2. stamp unchanged → nothing invalidated.
 *  3. offline / query failure → nothing invalidated (stale-offline is
 *     correct behaviour).
 *  4. offline lease survives a stamp invalidation (entitlement state is
 *     rescued onto the regenerated entry).
 *  5. new entries are stamped with the live vintage seen at boot.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./listeningMetaCache', () => ({
  refreshListeningMetaIfStale: vi.fn(async () => false),
}))

import {
  checkContentVersion,
  getCachedScript,
  setCachedScript,
  setOfflineLease,
  getOfflineLease,
  type CachedScript,
} from './useScriptCache'
import { refreshListeningMetaIfStale } from './listeningMetaCache'
import type { OfflineLease } from '../config/offlineLease'

const NOW = 1_700_000_000_000

function makeLease(): OfflineLease {
  return { grantedAt: NOW, expiresAt: NOW + 30 * 86_400_000, lastValidatedAt: NOW }
}

// Unique course code per test — the scriptDb connection is module-cached and
// not reset between tests (same isolation convention as the lease tests).
let seq = 0
const courseCode = () => `stamp-test-${++seq}`

function fakeClient(row: { content_version?: string; content_stamp?: string } | null, error = false) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            error ? { data: null, error: { message: 'offline' } } : { data: row, error: null },
        }),
      }),
    }),
  } as any
}

async function seedScript(code: string, extra: Partial<CachedScript> = {}): Promise<void> {
  await setCachedScript(code, {
    rounds: [{ roundNumber: 1, legoId: 'L1', seedId: 'S1', items: [] }],
    totalSeeds: 1,
    totalLegos: 1,
    totalCycles: 1,
    audioMapObj: {},
    ...extra,
  } as any)
}

describe('checkContentVersion — content_stamp lane', () => {
  it('drops a pre-stamp (months-stale) script entry when a live stamp exists', async () => {
    const code = courseCode()
    await seedScript(code) // no contentStamp — a device cached before the mechanism
    expect(await getCachedScript(code)).not.toBeNull()

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: '2026-07-22T00:00:00Z' }), code)

    expect(invalidated).toBe(true)
    expect(await getCachedScript(code)).toBeNull()
    expect(refreshListeningMetaIfStale).toHaveBeenCalledWith(
      expect.anything(), code, '2026-07-22T00:00:00Z')
  })

  it('drops an entry whose vintage differs from the live stamp', async () => {
    const code = courseCode()
    await seedScript(code, { contentStamp: 'old-stamp' } as any)

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'new-stamp' }), code)

    expect(invalidated).toBe(true)
    expect(await getCachedScript(code)).toBeNull()
  })

  it('keeps an entry whose vintage matches the live stamp', async () => {
    const code = courseCode()
    // Boot once so the module learns the live stamp, then write the entry —
    // it inherits that stamp, mirroring the real generation flow.
    await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'stamp-A' }), code)
    await seedScript(code)
    expect((await getCachedScript(code))!.contentStamp).toBe('stamp-A')

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'stamp-A' }), code)

    expect(invalidated).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
  })

  it('never invalidates offline (query failure) — stale offline is correct', async () => {
    const code = courseCode()
    await seedScript(code) // stamp-less, would be "stale" if we could check
    const invalidated = await checkContentVersion(fakeClient(null, true), code)
    expect(invalidated).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
  })

  it('rescues the offline lease across a stamp invalidation', async () => {
    const code = courseCode()
    await seedScript(code, { contentStamp: 'old-stamp' } as any)
    await setOfflineLease(code, 'user-A', makeLease())

    await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'new-stamp' }), code)
    expect(await getCachedScript(code)).toBeNull() // entry gone…

    await seedScript(code) // …the regeneration walk rewrites it…
    const lease = await getOfflineLease(code, 'user-A') // …and the lease survived
    expect(lease).not.toBeNull()
    expect(lease!.expiresAt).toBe(NOW + 30 * 86_400_000)
  })
})
