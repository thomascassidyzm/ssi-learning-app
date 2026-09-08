/**
 * The Google door.
 *
 * FAILURE MODE (2026-09-08): the account screen offered only an email address
 * and a posted code. On the India funnel's first-run ask that is where a lot
 * of people stop, so Google sits above the email field now — as a DOOR that
 * ends in a session attesting an email address, never as an account type
 * (india-identity-model-2026-09-03 §2, D1).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  googleRedirectTo,
  oauthErrorMessage,
  readOAuthReturnError,
  startGoogleSignIn,
  GOOGLE_SCOPES,
} from './googleSignIn'

describe('googleRedirectTo', () => {
  it('brings the learner back to exactly where they were', () => {
    expect(googleRedirectTo({ origin: 'https://x.app', pathname: '/enrol/abc', search: '?course=spa_for_eng' }))
      .toBe('https://x.app/enrol/abc?course=spa_for_eng')
  })

  it('drops the wreckage of a previous failed attempt', () => {
    expect(googleRedirectTo({ origin: 'https://x.app', pathname: '/', search: '?error=access_denied&course=fra_for_eng' }))
      .toBe('https://x.app/?course=fra_for_eng')
  })

  it('handles a bare root with no query', () => {
    expect(googleRedirectTo({ origin: 'https://x.app', pathname: '/' })).toBe('https://x.app/')
  })
})

describe('oauthErrorMessage', () => {
  it("FAILURE MODE: never shows a learner Supabase's 'provider is not enabled'", () => {
    const msg = oauthErrorMessage({ message: 'Unsupported provider: provider is not enabled' })
    expect(msg).toBe('Google sign-in is not switched on yet. Please use your email address below.')
    expect(msg.toLowerCase()).not.toContain('unsupported provider')
  })

  it('says plainly when the learner cancelled', () => {
    expect(oauthErrorMessage({ message: 'access_denied' })).toBe('Google sign-in was cancelled.')
  })

  it('always points back at the email field', () => {
    expect(oauthErrorMessage({ message: 'boom' })).toContain('email address below')
    expect(oauthErrorMessage(null)).toContain('email address below')
  })
})

describe('readOAuthReturnError', () => {
  it('reads a failure out of the return fragment', () => {
    expect(readOAuthReturnError('#error=access_denied&error_description=access_denied'))
      .toBe('Google sign-in was cancelled.')
  })

  it('is silent on a clean return', () => {
    expect(readOAuthReturnError('#access_token=abc&token_type=bearer')).toBeNull()
    expect(readOAuthReturnError('')).toBeNull()
    expect(readOAuthReturnError(null)).toBeNull()
  })
})

describe('startGoogleSignIn', () => {
  const loc = { origin: 'https://x.app', pathname: '/', search: '' }

  it('asks Google for email and profile and nothing else', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({ error: null })
    const msg = await startGoogleSignIn({ auth: { signInWithOAuth } } as any, loc)
    expect(msg).toBeNull()
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: 'https://x.app/', scopes: GOOGLE_SCOPES },
    })
    expect(GOOGLE_SCOPES).toBe('email profile')
  })

  it('FAILURE MODE: the door is dark until the OAuth client exists, and says so', async () => {
    const signInWithOAuth = vi.fn().mockResolvedValue({
      error: { message: 'Unsupported provider: provider is not enabled' },
    })
    expect(await startGoogleSignIn({ auth: { signInWithOAuth } } as any, loc))
      .toBe('Google sign-in is not switched on yet. Please use your email address below.')
  })

  it('survives a client that is not there yet', async () => {
    expect(await startGoogleSignIn(null, loc)).toContain('unavailable')
  })

  it('survives a throwing client', async () => {
    const signInWithOAuth = vi.fn().mockRejectedValue(new Error('network'))
    expect(await startGoogleSignIn({ auth: { signInWithOAuth } } as any, loc)).toContain('email address below')
  })
})
