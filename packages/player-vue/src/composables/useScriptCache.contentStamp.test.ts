/**
 * Structural cache freshness — the content_stamp lane of checkContentVersion.
 * vitest, fake-indexeddb.
 *
 * courses.content_stamp is trigger-maintained in the DB (migration
 * 20260722_course_content_stamp.sql): any learner-visible content write moves
 * it. The client compares it against the vintage recorded on each cache
 * entry.
 *
 * STALE-WHILE-REVALIDATE (founder ruling 2026-07-27): a stamp mismatch no
 * longer DROPS the entry — the session plays from the cached script
 * immediately and the player revalidates in the background; the fresh script
 * applies from the next session. Covers:
 *  1. stamp moved (incl. pre-stamp entries) → entry KEPT, marked stale
 *     (getScriptStaleness), listening bundle refresh dispatched.
 *  2. stamp unchanged → nothing stale.
 *  3. offline / query failure → nothing stale (stale-offline is correct).
 *  4. a live-vintage rewrite (the background revalidation) clears staleness;
 *     a vintage-preserving rewrite (offline-download persist of the old
 *     queue) leaves the staleness standing.
 *  5. offline lease survives script rewrites (entitlement state carries over
 *     when the new write brings no leases of its own).
 *  6. new entries are stamped with the live vintage seen at boot.
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
  getScriptStaleness,
  awaitFreshnessCheck,
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

describe('checkContentVersion — content_stamp lane (SWR)', () => {
  it('keeps a pre-stamp (months-stale) entry but marks it stale when a live stamp exists', async () => {
    const code = courseCode()
    await seedScript(code) // no contentStamp — a device cached before the mechanism
    expect(await getCachedScript(code)).not.toBeNull()

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: '2026-07-22T00:00:00Z' }), code)

    expect(invalidated).toBe(true)
    // SWR: the entry SURVIVES — this session plays from it.
    expect(await getCachedScript(code)).not.toBeNull()
    expect(getScriptStaleness(code)).toEqual({
      cachedStamp: null,
      liveStamp: '2026-07-22T00:00:00Z',
    })
    expect(refreshListeningMetaIfStale).toHaveBeenCalledWith(
      expect.anything(), code, '2026-07-22T00:00:00Z')
  })

  it('keeps-but-marks-stale an entry whose vintage differs from the live stamp', async () => {
    const code = courseCode()
    await seedScript(code, { contentStamp: 'old-stamp' } as any)

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'new-stamp' }), code)

    expect(invalidated).toBe(true)
    expect(await getCachedScript(code)).not.toBeNull()
    expect(getScriptStaleness(code)).toEqual({ cachedStamp: 'old-stamp', liveStamp: 'new-stamp' })
  })

  it('keeps an entry whose vintage matches the live stamp, with no staleness', async () => {
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
    expect(getScriptStaleness(code)).toBeNull()
  })

  it('never marks stale offline (query failure) — stale offline is correct', async () => {
    const code = courseCode()
    await seedScript(code) // stamp-less, would be "stale" if we could check
    const invalidated = await checkContentVersion(fakeClient(null, true), code)
    expect(invalidated).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
    expect(getScriptStaleness(code)).toBeNull()
  })

  it('awaitFreshnessCheck resolves after an in-flight check settles', async () => {
    const code = courseCode()
    await seedScript(code, { contentStamp: 'old-stamp' } as any)
    // Fire without awaiting, then wait via the helper — the verdict must be in.
    void checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'new-stamp' }), code)
    await awaitFreshnessCheck(code)
    expect(getScriptStaleness(code)).toEqual({ cachedStamp: 'old-stamp', liveStamp: 'new-stamp' })
  })

  it('a live-vintage rewrite (background revalidation) clears the staleness', async () => {
    const code = courseCode()
    await seedScript(code, { contentStamp: 'old-stamp' } as any)
    await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'new-stamp' }), code)
    expect(getScriptStaleness(code)).not.toBeNull()

    // The revalidation walk rewrites the entry; default stamping applies the
    // live vintage learned at boot.
    await seedScript(code)
    expect((await getCachedScript(code))!.contentStamp).toBe('new-stamp')
    expect(getScriptStaleness(code)).toBeNull()
  })

  it('a vintage-preserving rewrite (offline persist of the old queue) leaves staleness standing', async () => {
    const code = courseCode()
    await seedScript(code, { contentStamp: 'old-stamp' } as any)
    await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'new-stamp' }), code)

    // An SWR session persisting its in-memory (old-vintage) queue passes the
    // queue's own stamp — old rounds must never be mis-stamped as fresh.
    await seedScript(code, { contentStamp: 'old-stamp' } as any)
    expect((await getCachedScript(code))!.contentStamp).toBe('old-stamp')
    expect(getScriptStaleness(code)).toEqual({ cachedStamp: 'old-stamp', liveStamp: 'new-stamp' })
  })

  it('the offline lease survives a script rewrite that brings no leases', async () => {
    const code = courseCode()
    await seedScript(code, { contentStamp: 'old-stamp' } as any)
    await setOfflineLease(code, 'user-A', makeLease())

    await checkContentVersion(
      fakeClient({ content_version: '1.0.0', content_stamp: 'new-stamp' }), code)
    expect(await getCachedScript(code)).not.toBeNull() // SWR: entry kept

    await seedScript(code) // the background revalidation rewrites it…
    const lease = await getOfflineLease(code, 'user-A') // …and the lease carried over
    expect(lease).not.toBeNull()
    expect(lease!.expiresAt).toBe(NOW + 30 * 86_400_000)
  })
})
