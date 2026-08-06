/**
 * Per-clip audio freshness — the audio_stamp lane of checkContentVersion.
 * vitest, fake-indexeddb.
 *
 * courses.audio_stamp is trigger-maintained in the DB (migration
 * 20260806_course_audio_stamp.sql): it moves when a clip's BYTES change under
 * a stable row id — an audio_revision bump or an s3_key swap, i.e. a repair.
 *
 * This lane DROPS the script cache rather than marking it stale, and that is
 * the whole point. The failure it exists to prevent was observed live on
 * staging 2026-08-06: a device that had cached the course two minutes before
 * the versioned-URL deploy replayed nine repaired German clips at their old
 * revision — every request a cache hit, no error anywhere. Stale-while-
 * revalidate would have played the damaged clips for one more session, and
 * "damaged" is exactly what we had declared them.
 *
 * Covers:
 *  1. audio stamp moved → script entry DROPPED (not merely marked stale).
 *  2. audio stamp unchanged → entry kept.
 *  3. first sight of a stamp → recorded, nothing dropped (no false positive on
 *     a device that has never seen this course).
 *  4. the stamp is recorded after a drop, so the next boot is quiet.
 *  5. offline / query failure → nothing dropped (stale-offline is correct).
 *  6. a course with no audio_stamp at all (pre-migration row) → no crash,
 *     nothing dropped.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./listeningMetaCache', () => ({
  refreshListeningMetaIfStale: vi.fn(async () => false),
}))

import {
  checkContentVersion,
  getCachedScript,
  setCachedScript,
  type CachedScript,
} from './useScriptCache'

const VERSION = '0.1766.44'
const STAMP_A = '2026-08-06T01:00:00.000Z'
const STAMP_B = '2026-08-06T02:00:00.000Z'

let seq = 0
const courseCode = () => `audio-stamp-test-${++seq}`

function fakeClient(
  row: { content_version?: string; content_stamp?: string; audio_stamp?: string } | null,
  error = false
) {
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

async function seedScript(code: string): Promise<void> {
  await setCachedScript(code, {
    rounds: [{ roundNumber: 1, legoId: 'L1', seedId: 'S1', items: [] }],
    totalSeeds: 1,
    totalLegos: 1,
    totalCycles: 1,
    audioMapObj: {},
  } as any)
}

beforeEach(() => {
  localStorage.clear()
})

describe('checkContentVersion — audio_stamp lane (hard drop)', () => {
  it('drops the cached script when a clip has been repaired', async () => {
    const code = courseCode()
    await seedScript(code)
    // Device last saw the course before the repair.
    localStorage.setItem(`ssi-audio-stamp-${code}`, STAMP_A)
    localStorage.setItem(`ssi-content-version-${code}`, VERSION)

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: VERSION, audio_stamp: STAMP_B }),
      code
    )

    expect(invalidated).toBe(true)
    // DROPPED, not stale — the next read must go to the network and pick up
    // the `<uuid>.vN` refs for the repaired clips.
    expect(await getCachedScript(code)).toBeNull()
  })

  it('records the new stamp after a drop, so the next boot is quiet', async () => {
    const code = courseCode()
    await seedScript(code)
    localStorage.setItem(`ssi-audio-stamp-${code}`, STAMP_A)
    localStorage.setItem(`ssi-content-version-${code}`, VERSION)

    await checkContentVersion(fakeClient({ content_version: VERSION, audio_stamp: STAMP_B }), code)
    expect(localStorage.getItem(`ssi-audio-stamp-${code}`)).toBe(STAMP_B)

    await seedScript(code)
    const second = await checkContentVersion(
      fakeClient({ content_version: VERSION, audio_stamp: STAMP_B }),
      code
    )
    expect(second).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
  })

  it('keeps the cached script when no clip has changed', async () => {
    const code = courseCode()
    await seedScript(code)
    localStorage.setItem(`ssi-audio-stamp-${code}`, STAMP_A)
    localStorage.setItem(`ssi-content-version-${code}`, VERSION)

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: VERSION, audio_stamp: STAMP_A }),
      code
    )

    expect(invalidated).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
  })

  it('does not drop on first sight of a course', async () => {
    const code = courseCode()
    await seedScript(code)
    // No stored stamp: a device that has never seen this course must not have
    // its freshly-built cache thrown away.
    localStorage.setItem(`ssi-content-version-${code}`, VERSION)

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: VERSION, audio_stamp: STAMP_B }),
      code
    )

    expect(invalidated).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
    expect(localStorage.getItem(`ssi-audio-stamp-${code}`)).toBe(STAMP_B)
  })

  it('drops nothing when the freshness query fails (offline)', async () => {
    const code = courseCode()
    await seedScript(code)
    localStorage.setItem(`ssi-audio-stamp-${code}`, STAMP_A)

    const invalidated = await checkContentVersion(fakeClient(null, true), code)

    expect(invalidated).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
  })

  it('tolerates a course row with no audio_stamp', async () => {
    const code = courseCode()
    await seedScript(code)
    localStorage.setItem(`ssi-content-version-${code}`, VERSION)

    const invalidated = await checkContentVersion(
      fakeClient({ content_version: VERSION }),
      code
    )

    expect(invalidated).toBe(false)
    expect(await getCachedScript(code)).not.toBeNull()
  })
})
