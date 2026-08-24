/**
 * The intro-clip precedence rule.
 *
 * THE DEFECT THIS PINS (Greek, forum complaint 2026-08-11): a presentation
 * clip keeps the lego_id it was cut for forever. When content repaired 54
 * Greek LEGOs by repointing course_legos at already-clean clips, the
 * superseded clips kept those lego_ids — so anything resolving by lego_id kept
 * playing "The Greek for: 'to answer (I, aorist)', is:" while the player,
 * which follows the link, already said "to answer".
 *
 * The first test below fails against the pre-fix Course Explorer, which
 * consulted the lego_id map without ever looking at the link.
 */

import { describe, expect, it } from 'vitest'
import { resolveIntroAudioUrl } from './resolveIntroAudioUrl'

const S3 = 'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com'
const CLEAN_ID = 'b42fd600-668f-4de1-9d5d-c33e1f99bcbc'

// What loadIntroAudio would have put in the map from the superseded clip.
const dirtyMap = new Map<string, any>([
  ['intro:S0043L03', { intro: 'mastered/DIRTY.mp3' }],
])

describe('resolveIntroAudioUrl', () => {
  it('prefers the LEGO link over the clip that carries its lego_id', () => {
    const url = resolveIntroAudioUrl(
      { legoId: 'S0043L03', presentationAudioId: CLEAN_ID },
      { audioMap: dirtyMap, s3BaseUrl: S3 },
    )
    expect(url).toBe(`/api/audio/${CLEAN_ID}`)
  })

  it('prefers an already-resolved presentationAudio over everything', () => {
    const url = resolveIntroAudioUrl(
      {
        legoId: 'S0043L03',
        presentationAudioId: CLEAN_ID,
        presentationAudio: { url: '/api/audio/from-cycles' },
      },
      { audioMap: dirtyMap, s3BaseUrl: S3 },
    )
    expect(url).toBe('/api/audio/from-cycles')
  })

  it('falls back to the lego_id match when the LEGO has no link', () => {
    const url = resolveIntroAudioUrl(
      { legoId: 'S0043L03' },
      { audioMap: dirtyMap, s3BaseUrl: S3 },
    )
    expect(url).toBe(`${S3}/mastered/DIRTY.mp3`)
  })

  it('builds the legacy path for a bare uuid in the map', () => {
    const map = new Map<string, any>([['intro:S0001L01', { intro: 'abc-123' }]])
    expect(resolveIntroAudioUrl({ legoId: 'S0001L01' }, { audioMap: map, s3BaseUrl: S3 }))
      .toBe(`${S3}/mastered/ABC-123.mp3`)
  })

  it('returns null when nothing resolves', () => {
    expect(resolveIntroAudioUrl({ legoId: 'S9999L99' }, { audioMap: dirtyMap, s3BaseUrl: S3 }))
      .toBeNull()
    expect(resolveIntroAudioUrl(null, { s3BaseUrl: S3 })).toBeNull()
  })
})
