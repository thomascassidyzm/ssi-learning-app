/**
 * loadIntroAudio must follow the LEGO's own presentation link, not the lego_id
 * a clip happens to carry.
 *
 * THE DEFECT THIS PINS (Greek, reported on the forum 2026-08-11):
 * 54 Greek presentation clips read their bracketed grammar tag out loud —
 * "The Greek for: 'to answer (I, aorist)', is:". The content fix repointed
 * course_legos.presentation_audio_id at 54 already-recorded clean clips, but
 * it could not correct or delete the dirty ones, and a clip keeps the lego_id
 * it was cut for forever. So any resolver that finds a clip by
 * `role='presentation' AND lego_id=<id>` still handed back the labelled
 * recording, and the Course Explorer / "View Script" surface still played it.
 *
 * The link is the single source of truth for WHICH clip belongs to a LEGO.
 * The lego_id on a clip only records which LEGO it was cut for — those two
 * diverge the moment content repoints a LEGO, which is exactly what a
 * repair-by-repointing does.
 *
 * Before the fix this file's first test returns the labelled clip.
 */

import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { loadIntroAudio } from './useScriptCache'

const COURSE = 'ell_for_eng'
const LEGO = 'S0043L03'

// The two real Greek clips, by their live ids.
const DIRTY = {
  id: '9a659028-559d-4a67-a90e-2c425d4cb041',
  s3_key: 'mastered/DIRTY.mp3',
  text: "the greek for: 'to answer (i, aorist)', is:",
}
const CLEAN = {
  id: 'b42fd600-668f-4de1-9d5d-c33e1f99bcbc',
  s3_key: 'mastered/CLEAN.mp3',
  text: "the greek for: 'to answer', is:",
}

type Rows = Record<string, any[]>

/**
 * Minimal PostgREST-shaped stub: .from().select().eq().in().order() → { data }.
 * Filters are applied in the order they are chained, which is all these
 * queries need.
 *
 * Every builder method the resolver chains MUST exist here. loadIntroAudio
 * wraps its whole body in one try/catch, so a missing method is a TypeError
 * that gets swallowed and shows up as "this LEGO simply has no intro audio" —
 * indistinguishable from a real resolution gap. That is exactly how the
 * `.order('created_at')` added on 2026-08-27 turned this file red.
 */
function makeSupabase(tables: Rows) {
  const queries: string[] = []
  const from = (table: string) => {
    let rows = [...(tables[table] || [])]
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: any) => {
        rows = rows.filter(r => r[col] === val)
        return builder
      },
      in: (col: string, vals: any[]) => {
        rows = rows.filter(r => vals.includes(r[col]))
        return builder
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        const dir = opts?.ascending === false ? -1 : 1
        rows = [...rows].sort((a, b) =>
          a[col] === b[col] ? 0 : (a[col] < b[col] ? -1 : 1) * dir
        )
        return builder
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => {
        queries.push(table)
        return Promise.resolve({ data: rows, error: null }).then(resolve)
      },
    }
    return builder
  }
  return { supabase: { from } as any, queries }
}

describe('loadIntroAudio — the LEGO link beats the lego_id a clip carries', () => {
  it('plays the clip the LEGO is linked to, not the one stamped with its id', async () => {
    const { supabase } = makeSupabase({
      course_legos: [
        // Repointed by the content fix at the clean clip.
        { lego_id: LEGO, course_code: COURSE, presentation_audio_id: CLEAN.id },
      ],
      lego_introductions: [],
      course_audio: [
        // The superseded clip still carries the LEGO's id — this is the trap.
        { id: DIRTY.id, lego_id: LEGO, course_code: COURSE, role: 'presentation', s3_key: DIRTY.s3_key, text_normalized: DIRTY.text },
        { id: CLEAN.id, lego_id: 'S0271L02', course_code: COURSE, role: 'presentation', s3_key: CLEAN.s3_key, text_normalized: CLEAN.text },
      ],
    })

    const audioMap = new Map<string, any>()
    await loadIntroAudio(supabase, COURSE, new Set([LEGO]), audioMap)

    expect(audioMap.get(`intro:${LEGO}`)).toEqual({ intro: CLEAN.s3_key })
  })

  it('still resolves a LEGO with no link at all, via lego_id (Portuguese-shaped courses)', async () => {
    const { supabase } = makeSupabase({
      course_legos: [{ lego_id: LEGO, course_code: COURSE, presentation_audio_id: null }],
      lego_introductions: [],
      course_audio: [
        { id: DIRTY.id, lego_id: LEGO, course_code: COURSE, role: 'presentation', s3_key: DIRTY.s3_key, created_at: '2026-05-14T11:00:00Z' },
      ],
    })

    const audioMap = new Map<string, any>()
    await loadIntroAudio(supabase, COURSE, new Set([LEGO]), audioMap)

    expect(audioMap.get(`intro:${LEGO}`)).toEqual({ intro: DIRTY.s3_key })
  })

  it('falls back to lego_introductions when course_legos has no link', async () => {
    const { supabase } = makeSupabase({
      course_legos: [{ lego_id: LEGO, course_code: COURSE, presentation_audio_id: null }],
      lego_introductions: [
        { lego_id: LEGO, course_code: COURSE, presentation_audio_id: CLEAN.id, audio_uuid: null },
      ],
      course_audio: [
        { id: DIRTY.id, lego_id: LEGO, course_code: COURSE, role: 'presentation', s3_key: DIRTY.s3_key },
        { id: CLEAN.id, lego_id: 'S0271L02', course_code: COURSE, role: 'presentation', s3_key: CLEAN.s3_key },
      ],
    })

    const audioMap = new Map<string, any>()
    await loadIntroAudio(supabase, COURSE, new Set([LEGO]), audioMap)

    expect(audioMap.get(`intro:${LEGO}`)).toEqual({ intro: CLEAN.s3_key })
  })

  /**
   * Canon C23 (2026-08-27): a lego_id can carry two role='presentation' rows —
   * a superseded clip and its replacement. The lego_id fallback must take the
   * NEWEST RENDERED one. These pin the rule the `.order()` + pending-skip in
   * step 3 exists for.
   */
  it('takes the newest presentation row when a lego_id carries two', async () => {
    const { supabase } = makeSupabase({
      course_legos: [{ lego_id: LEGO, course_code: COURSE, presentation_audio_id: null }],
      lego_introductions: [],
      course_audio: [
        { id: DIRTY.id, lego_id: LEGO, course_code: COURSE, role: 'presentation', s3_key: DIRTY.s3_key, created_at: '2026-05-14T11:00:00Z' },
        { id: CLEAN.id, lego_id: LEGO, course_code: COURSE, role: 'presentation', s3_key: CLEAN.s3_key, created_at: '2026-08-27T09:00:00Z' },
      ],
    })

    const audioMap = new Map<string, any>()
    await loadIntroAudio(supabase, COURSE, new Set([LEGO]), audioMap)

    expect(audioMap.get(`intro:${LEGO}`)).toEqual({ intro: CLEAN.s3_key })
  })

  it('skips a newer `pending/` clip and keeps the rendered one', async () => {
    const { supabase } = makeSupabase({
      course_legos: [{ lego_id: LEGO, course_code: COURSE, presentation_audio_id: null }],
      lego_introductions: [],
      course_audio: [
        // Listed newest-first, as the ordered query returns it: the resolver
        // must step over the placeholder rather than take row one.
        { id: 'pending-row', lego_id: LEGO, course_code: COURSE, role: 'presentation', s3_key: 'pending/NOT-RENDERED-YET.mp3', created_at: '2026-08-27T09:00:00Z' },
        { id: CLEAN.id, lego_id: LEGO, course_code: COURSE, role: 'presentation', s3_key: CLEAN.s3_key, created_at: '2026-05-14T11:00:00Z' },
      ],
    })

    const audioMap = new Map<string, any>()
    await loadIntroAudio(supabase, COURSE, new Set([LEGO]), audioMap)

    expect(audioMap.get(`intro:${LEGO}`)).toEqual({ intro: CLEAN.s3_key })
  })
})
