import { describe, it, expect } from 'vitest'
import { isAlreadyLinkedEmail } from './emailVerifyGuard'

describe('isAlreadyLinkedEmail', () => {
  // The reported bug (Deborah, 2026-08-06): "There's a button for Verify
  // Email, but that doesn't seem to be doing anything." A possession-onboarded
  // learner's own email is back-filled into verified_emails on load, so the
  // uniform guard blocked the send every single time and no code was ever sent.
  it('lets an unverified primary through even though it is in verified_emails', () => {
    expect(
      isAlreadyLinkedEmail({
        email: 'deborah@school.example',
        primaryEmail: 'deborah@school.example',
        verifiedEmails: ['deborah@school.example'],
        isPrimaryUnverified: true,
      }),
    ).toBe(false)
  })

  it('normalises case and whitespace when matching the primary', () => {
    expect(
      isAlreadyLinkedEmail({
        email: 'Deborah@School.Example',
        primaryEmail: '  deborah@school.example ',
        verifiedEmails: ['deborah@school.example'],
        isPrimaryUnverified: true,
      }),
    ).toBe(false)
  })

  it('still blocks a second email that is already linked', () => {
    expect(
      isAlreadyLinkedEmail({
        email: 'other@school.example',
        primaryEmail: 'deborah@school.example',
        verifiedEmails: ['deborah@school.example', 'other@school.example'],
        isPrimaryUnverified: true,
      }),
    ).toBe(true)
  })

  it('blocks the primary once it has genuinely been verified', () => {
    expect(
      isAlreadyLinkedEmail({
        email: 'deborah@school.example',
        primaryEmail: 'deborah@school.example',
        verifiedEmails: ['deborah@school.example'],
        isPrimaryUnverified: false,
      }),
    ).toBe(true)
  })

  it('allows a brand-new email through', () => {
    expect(
      isAlreadyLinkedEmail({
        email: 'new@school.example',
        primaryEmail: 'deborah@school.example',
        verifiedEmails: ['deborah@school.example'],
        isPrimaryUnverified: false,
      }),
    ).toBe(false)
  })
})
