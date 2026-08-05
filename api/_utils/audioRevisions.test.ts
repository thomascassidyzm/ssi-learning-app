/**
 * getAudioRevisions — the server half of the in-place audio repair flow.
 *
 * Three things must hold, and each has a cost attached to getting it wrong:
 *  - it queries ONLY repaired clips, so the normal answer is an empty object
 *    and the payload doesn't grow;
 *  - it memoises per course, so it stays off the instant-playback critical
 *    path on a warm lambda;
 *  - it NEVER throws. A failure here means bare URLs (today's behaviour), not
 *    a dead playback endpoint. We do not take playback down to fix clipped
 *    audio for a few clips.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getAudioRevisions, __clearAudioRevisionCache } from './audioRevisions'

type Row = { id: string; audio_revision: number | null }

/** Minimal Supabase double capturing the filters the helper applies. */
function makeSupabase(result: { data: Row[] | null; error: { message: string } | null }) {
  const calls: { table?: string; select?: string; eq?: [string, string]; gt?: [string, number] } = {}
  const builder = {
    select(cols: string) {
      calls.select = cols
      return this
    },
    eq(col: string, val: string) {
      calls.eq = [col, val]
      return this
    },
    gt(col: string, val: number) {
      calls.gt = [col, val]
      return Promise.resolve(result)
    },
  }
  const from = vi.fn((table: string) => {
    calls.table = table
    return builder
  })
  return { supabase: { from } as unknown as SupabaseClient, from, calls }
}

describe('getAudioRevisions', () => {
  beforeEach(() => {
    __clearAudioRevisionCache()
  })

  it('asks only for repaired clips of the one course', async () => {
    const { supabase, calls } = makeSupabase({ data: [], error: null })
    await getAudioRevisions(supabase, 'deu_for_eng')

    expect(calls.table).toBe('course_audio')
    expect(calls.select).toBe('id, audio_revision')
    expect(calls.eq).toEqual(['course_code', 'deu_for_eng'])
    // > 1, not >= 1: revision 1 is every clip in the course.
    expect(calls.gt).toEqual(['audio_revision', 1])
  })

  it('returns an id -> revision map', async () => {
    const { supabase } = makeSupabase({
      data: [
        { id: 'a', audio_revision: 2 },
        { id: 'b', audio_revision: 7 },
      ],
      error: null,
    })
    expect(await getAudioRevisions(supabase, 'deu_for_eng')).toEqual({ a: 2, b: 7 })
  })

  it('drops junk rows rather than emitting a broken ?v=', async () => {
    const { supabase } = makeSupabase({
      data: [
        { id: 'a', audio_revision: null },
        { id: 'b', audio_revision: 1 },
        { id: 'c', audio_revision: 3 },
      ],
      error: null,
    })
    expect(await getAudioRevisions(supabase, 'deu_for_eng')).toEqual({ c: 3 })
  })

  it('returns {} on a query error — degrade to bare URLs, never fail playback', async () => {
    // The likely cause during rollout is `audio_revision` not existing yet.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { supabase } = makeSupabase({
      data: null,
      error: { message: 'column "audio_revision" does not exist' },
    })
    expect(await getAudioRevisions(supabase, 'deu_for_eng')).toEqual({})
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('caches a failure too, so a missing column is not queried per request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { supabase, from } = makeSupabase({
      data: null,
      error: { message: 'column "audio_revision" does not exist' },
    })
    await getAudioRevisions(supabase, 'deu_for_eng')
    await getAudioRevisions(supabase, 'deu_for_eng')
    expect(from).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('memoises per course, and re-queries once the TTL lapses', async () => {
    const { supabase, from } = makeSupabase({
      data: [{ id: 'a', audio_revision: 2 }],
      error: null,
    })

    await getAudioRevisions(supabase, 'deu_for_eng', 1_000)
    await getAudioRevisions(supabase, 'deu_for_eng', 30_000)
    expect(from).toHaveBeenCalledTimes(1)

    // A different course is a different key.
    await getAudioRevisions(supabase, 'fra_for_eng', 30_000)
    expect(from).toHaveBeenCalledTimes(2)

    // Past the 60s TTL, so a repair applied meanwhile is picked up.
    await getAudioRevisions(supabase, 'deu_for_eng', 62_000)
    expect(from).toHaveBeenCalledTimes(3)
  })

  it('returns {} when the query throws outright', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const supabase = {
      from: () => {
        throw new Error('network down')
      },
    } as unknown as SupabaseClient
    expect(await getAudioRevisions(supabase, 'deu_for_eng')).toEqual({})
    warn.mockRestore()
  })
})
