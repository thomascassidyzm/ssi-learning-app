import { describe, it, expect } from 'vitest'
import { friendlySendCodeError, CODE_ON_ITS_WAY } from './sendCodeMessage'

describe('friendlySendCodeError', () => {
  it('replaces Supabase\'s security-flavoured throttle with a warm sentence', () => {
    expect(friendlySendCodeError('For security purposes, you can only request this after 47 seconds.'))
      .toBe(CODE_ON_ITS_WAY)
    expect(friendlySendCodeError('Email rate limit exceeded')).toBe(CODE_ON_ITS_WAY)
  })

  it('leaves every other failure exactly as it was', () => {
    expect(friendlySendCodeError('Could not create a sign-in code')).toBe('Could not create a sign-in code')
    expect(friendlySendCodeError('')).toBe('Could not send your code')
  })
})
