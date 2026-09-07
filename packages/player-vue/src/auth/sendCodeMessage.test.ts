import { describe, it, expect } from 'vitest'
import { friendlySendCodeError, CODE_ON_ITS_WAY } from './sendCodeMessage'

describe('friendlySendCodeError', () => {
  it('quotes the wait Supabase itself named, rather than inventing one', () => {
    // The old copy answered this with "give it a couple of minutes" — five
    // times longer than the truth, and false in the other direction on a
    // fifteen-minute window. Say what the refusal actually said.
    expect(friendlySendCodeError('For security purposes, you can only request this after 47 seconds.'))
      .toContain('in about 45 seconds')
    expect(friendlySendCodeError('For security purposes, you can only request this after 120 seconds.'))
      .toContain('in about 2 minutes')
  })

  it('claims no number when the refusal carries none', () => {
    expect(friendlySendCodeError('Email rate limit exceeded')).toBe(CODE_ON_ITS_WAY)
    expect(CODE_ON_ITS_WAY).not.toMatch(/minute|second/)
  })

  it('leaves every other failure exactly as it was', () => {
    expect(friendlySendCodeError('Could not create a sign-in code')).toBe('Could not create a sign-in code')
    expect(friendlySendCodeError('')).toBe('Could not send your code')
  })
})
