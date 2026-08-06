/**
 * Tests for personalLinkUses.ts — pins the fix for the 2026-08-06 field
 * report: the "ways in" ledger printed USES 0 next to a personal link whose
 * recipient had signed in twice and practised for four minutes.
 *
 * The live rows this is built from (invite MZU-172, id f07a5e0d-…):
 *   invite_codes.use_count = 0  (and structurally can never move — the
 *     personal flow never calls /api/code/redeem, the only incrementer)
 *   possession_mint_attempts  = 2 rows, outcome 'personal_signin',
 *     2026-08-06T08:35:44Z and 2026-08-06T10:01:57Z
 * So the honest figure is 2, not 0.
 */
import { describe, it, expect } from 'vitest'
import {
  PERSONAL_SIGNIN_OUTCOME,
  tallyPersonalSignins,
  usesForLink,
} from './personalLinkUses'

const PERSONAL = 'f07a5e0d-1a62-43b5-be4b-adf685e37ad7'
const OTHER = '2bec2f2a-cd64-40e0-865d-6ee553781254'

describe('PERSONAL_SIGNIN_OUTCOME', () => {
  it('matches the string api/auth/possession-redeem.ts logs', () => {
    // If this ever drifts the ledger silently reports 0 again, which is the
    // exact failure this module exists to stop.
    expect(PERSONAL_SIGNIN_OUTCOME).toBe('personal_signin')
  })
})

describe('tallyPersonalSignins', () => {
  it('counts sign-ins per code and keeps the most recent timestamp', () => {
    const tally = tallyPersonalSignins([
      { invite_code_id: PERSONAL, created_at: '2026-08-06T10:01:57.616482+00:00' },
      { invite_code_id: PERSONAL, created_at: '2026-08-06T08:35:44.212140+00:00' },
      { invite_code_id: OTHER, created_at: '2026-08-05T15:55:46.187210+00:00' },
    ])
    expect(tally.get(PERSONAL)).toEqual({
      count: 2,
      lastAt: '2026-08-06T10:01:57.616482+00:00',
    })
    expect(tally.get(OTHER)).toEqual({
      count: 1,
      lastAt: '2026-08-05T15:55:46.187210+00:00',
    })
  })

  it('takes the latest timestamp regardless of row order', () => {
    const ascending = tallyPersonalSignins([
      { invite_code_id: PERSONAL, created_at: '2026-08-06T08:35:44Z' },
      { invite_code_id: PERSONAL, created_at: '2026-08-06T10:01:57Z' },
    ])
    expect(ascending.get(PERSONAL)?.lastAt).toBe('2026-08-06T10:01:57Z')
  })

  it('ignores attempt rows that belong to no code', () => {
    // Pre-validation refusals (bad code, per-IP rate limit) log with a null
    // invite_code_id; they must not inflate anyone's figure.
    const tally = tallyPersonalSignins([
      { invite_code_id: null, created_at: '2026-08-06T09:00:00Z' },
      { invite_code_id: PERSONAL, created_at: '2026-08-06T09:01:00Z' },
    ])
    expect(tally.size).toBe(1)
    expect(tally.get(PERSONAL)?.count).toBe(1)
  })

  it('returns an empty map for no attempts', () => {
    expect(tallyPersonalSignins([]).size).toBe(0)
  })
})

describe('usesForLink', () => {
  const signins = tallyPersonalSignins([
    { invite_code_id: PERSONAL, created_at: '2026-08-06T10:01:57Z' },
    { invite_code_id: PERSONAL, created_at: '2026-08-06T08:35:44Z' },
  ])

  it('reports a personal link its real sign-in count, not the frozen use_count', () => {
    // THE REGRESSION GUARD: use_count is 0 and always will be.
    expect(
      usesForLink({ id: PERSONAL, use_count: 0, max_uses: null }, true, signins)
    ).toEqual({ count: 2, max: null, kind: 'signin', lastAt: '2026-08-06T10:01:57Z' })
  })

  it('reports a truthful zero with no timestamp when the link was never opened', () => {
    expect(
      usesForLink({ id: 'never-clicked', use_count: 0, max_uses: null }, true, signins)
    ).toEqual({ count: 0, max: null, kind: 'signin', lastAt: null })
  })

  it('leaves shareable codes on use_count exactly as before', () => {
    // Counting genuinely works for shareable codes (37 live rows with
    // non-zero use_count) — this change must not disturb them.
    expect(
      usesForLink({ id: 'shareable', use_count: 16, max_uses: null }, false, signins)
    ).toEqual({ count: 16, max: null, kind: 'redemption', lastAt: null })
  })

  it('carries max_uses through for a capped shareable code', () => {
    expect(
      usesForLink({ id: 'capped', use_count: 5, max_uses: 10 }, false, signins)
    ).toEqual({ count: 5, max: 10, kind: 'redemption', lastAt: null })
  })

  it('never lets a personal link borrow another code sign-ins', () => {
    expect(
      usesForLink({ id: OTHER, use_count: 0, max_uses: null }, true, signins).count
    ).toBe(0)
  })
})
