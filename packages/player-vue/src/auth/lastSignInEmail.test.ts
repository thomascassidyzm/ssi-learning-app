import { describe, it, expect, beforeEach } from 'vitest'
import {
  rememberSignInEmail,
  readLastSignInEmail,
  forgetLastSignInEmail,
} from './lastSignInEmail'

describe('lastSignInEmail', () => {
  beforeEach(() => localStorage.clear())

  it('offers nothing until a sign-in has happened on this device', () => {
    expect(readLastSignInEmail()).toBeNull()
  })

  it('remembers the address a sign-in used, normalised', () => {
    rememberSignInEmail('  Gwen@Example.COM ')
    expect(readLastSignInEmail()).toBe('gwen@example.com')
  })

  it('forgets it on demand, so a second person can type their own', () => {
    rememberSignInEmail('gwen@example.com')
    forgetLastSignInEmail()
    expect(readLastSignInEmail()).toBeNull()
  })

  it('never stores anything that is not an address', () => {
    rememberSignInEmail('link-9f2c@placeholder')
    rememberSignInEmail('')
    rememberSignInEmail(null)
    expect(readLastSignInEmail()).toBeNull()
  })

  it('stores the address and nothing else — no token, no secret', () => {
    rememberSignInEmail('gwen@example.com')
    const stored = Object.entries({ ...localStorage })
      .filter(([k]) => k.startsWith('ssi-last-signin'))
    expect(stored).toEqual([['ssi-last-signin-email', 'gwen@example.com']])
  })
})
