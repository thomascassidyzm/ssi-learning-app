import { describe, it, expect } from 'vitest'
import { applyAudioRef, buildAudioRef, fetchRevisedAudioRefs, stampRowAudioRefs } from './revisedAudioRefs'

const UUID_A = '2ba6d5a2-1234-4abc-9def-abcdef123449'
const UUID_B = '8f1c0e77-5678-4bcd-8123-abcdef987654'

/** Minimal Supabase stub for `.from().select().eq().gt()`. */
function refsStub(rows: unknown[] | null, error: unknown = null) {
  const result = Promise.resolve({ data: rows, error })
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    gt: () => result,
  }
  return { from: () => chain } as any
}

describe('buildAudioRef', () => {
  it('leaves revision 1 (and absent) as a bare uuid so existing caches are untouched', () => {
    expect(buildAudioRef(UUID_A, 1)).toBe(UUID_A)
    expect(buildAudioRef(UUID_A, null)).toBe(UUID_A)
    expect(buildAudioRef(UUID_A, undefined)).toBe(UUID_A)
  })

  it('suffixes revisions above 1', () => {
    expect(buildAudioRef(UUID_A, 2)).toBe(`${UUID_A}.v2`)
    expect(buildAudioRef(UUID_A, 37)).toBe(`${UUID_A}.v37`)
  })
})

describe('fetchRevisedAudioRefs', () => {
  it('maps only the revised clips', async () => {
    const refs = await fetchRevisedAudioRefs(
      refsStub([{ id: UUID_A, audio_revision: 2 }, { id: UUID_B, audio_revision: 5 }]),
      'deu_for_eng',
    )
    expect(refs.get(UUID_A)).toBe(`${UUID_A}.v2`)
    expect(refs.get(UUID_B)).toBe(`${UUID_B}.v5`)
    expect(refs.size).toBe(2)
  })

  it('returns an empty map on a query error rather than throwing', async () => {
    const refs = await fetchRevisedAudioRefs(refsStub(null, { message: 'boom' }), 'deu_for_eng')
    expect(refs.size).toBe(0)
  })

  it('returns an empty map with no client or no course code', async () => {
    expect((await fetchRevisedAudioRefs(null, 'deu_for_eng')).size).toBe(0)
    expect((await fetchRevisedAudioRefs(refsStub([]), '')).size).toBe(0)
  })
})

describe('stampRowAudioRefs', () => {
  const refs = new Map([[UUID_A, `${UUID_A}.v2`]])

  it('stamps every audio-id column that names a revised clip', () => {
    const rows = [{
      seed_number: 1,
      known_audio_id: UUID_A,
      target1_audio_id: UUID_B,
      target2_audio_id: null,
      presentation_audio_id: UUID_A,
    }]
    const [out] = stampRowAudioRefs(refs, rows)
    expect(out.known_audio_id).toBe(`${UUID_A}.v2`)
    expect(out.presentation_audio_id).toBe(`${UUID_A}.v2`)
    // Unrevised and null columns are untouched — their URLs and cached bytes stay valid.
    expect(out.target1_audio_id).toBe(UUID_B)
    expect(out.target2_audio_id).toBeNull()
    expect(out.seed_number).toBe(1)
  })

  it('stamps a course_audio row on its own primary key (listen bookends)', () => {
    const [out] = stampRowAudioRefs(refs, [{ role: 'bookend_listen_intro', id: UUID_A }])
    expect(out.id).toBe(`${UUID_A}.v2`)
  })

  it('does not mutate the input rows', () => {
    const row = { known_audio_id: UUID_A }
    const [out] = stampRowAudioRefs(refs, [row])
    expect(row.known_audio_id).toBe(UUID_A)
    expect(out.known_audio_id).toBe(`${UUID_A}.v2`)
  })

  it('is a pass-through (same array identity) when nothing in the course is revised', () => {
    const rows = [{ known_audio_id: UUID_A }]
    expect(stampRowAudioRefs(new Map(), rows)).toBe(rows)
  })
})

describe('applyAudioRef', () => {
  const refs = new Map([[UUID_A, `${UUID_A}.v2`]])

  it('stamps a revised id and passes through everything else', () => {
    expect(applyAudioRef(refs, UUID_A)).toBe(`${UUID_A}.v2`)
    expect(applyAudioRef(refs, UUID_B)).toBe(UUID_B)
    expect(applyAudioRef(refs, null)).toBeNull()
    expect(applyAudioRef(refs, undefined)).toBeNull()
  })
})
