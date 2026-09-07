/**
 * The family-plan invite mail. Two states, two sets of words — the defect this
 * closes was that the invited person got NO words at all, and the near-miss
 * fix would have been sending the same message to both.
 */
import { describe, it, expect } from 'vitest'
import { renderFamilyInviteEmail, safeInviterName } from './familyInviteEmail'

const address = 'grandpa@example.com'

describe('renderFamilyInviteEmail', () => {
  it('tells an existing account holder to sign in as usual, and never that they must sign up', () => {
    const { subject, text, html } = renderFamilyInviteEmail({ address, inviterName: 'Bethan', hasAccount: true })
    expect(subject).toBe('Bethan has added you to their SaySomethingin family plan')
    expect(text).toContain('Bethan has added you to their family plan on SaySomethingin')
    expect(text).toContain('Sign in the way you normally do')
    expect(text).toContain(address)
    expect(text).not.toMatch(/do not have an account/i)
    expect(html).toContain(address)
  })

  it('tells someone with no account to sign in with that exact address, and that the place attaches then', () => {
    const { text } = renderFamilyInviteEmail({ address, inviterName: 'Bethan', hasAccount: false })
    expect(text).toContain('You do not have an account yet')
    expect(text).toContain(address)
    expect(text).toContain('added the moment you do')
    expect(text).not.toMatch(/normally do/)
  })

  it('the two states do not send the same message', () => {
    const a = renderFamilyInviteEmail({ address, inviterName: 'Bethan', hasAccount: true })
    const b = renderFamilyInviteEmail({ address, inviterName: 'Bethan', hasAccount: false })
    expect(a.text).not.toBe(b.text)
  })

  it('names nobody, gracefully, when there is no trustworthy display name', () => {
    const { subject, text } = renderFamilyInviteEmail({ address, inviterName: null, hasAccount: false })
    expect(subject).toBe('You have been added to a SaySomethingin family plan')
    expect(text.startsWith('You have been added to a family plan on SaySomethingin')).toBe(true)
  })

  it('keeps house voice: the brand is SaySomethingin, and there are no exclamation marks', () => {
    for (const hasAccount of [true, false]) {
      const { subject, text, html } = renderFamilyInviteEmail({ address, inviterName: 'Bethan', hasAccount })
      // The HTML doctype owns the only `!` allowed anywhere near this mail.
      for (const s of [subject, text]) {
        expect(s).not.toContain('!')
        expect(s).not.toMatch(/SaySomethingIn|Say Something In/)
      }
      expect(html).not.toMatch(/SaySomethingIn|Say Something In/)
      expect(text).toContain('SaySomethingin')
    }
  })

  it('escapes an interpolated address rather than letting it into the HTML raw', () => {
    const { html } = renderFamilyInviteEmail({
      address: 'a"<script>@example.com',
      inviterName: null,
      hasAccount: true,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('safeInviterName', () => {
  it('drops an address-shaped display name (the auth trigger seeds display_name from an email local part)', () => {
    expect(safeInviterName('bethan@example.com')).toBeNull()
    expect(safeInviterName('j.smith92')).toBeNull()
    expect(safeInviterName('tom_c')).toBeNull()
    expect(safeInviterName('  ')).toBeNull()
    expect(safeInviterName(null)).toBeNull()
  })

  it('keeps a real name, even one that matches the local part of its owner email', () => {
    expect(safeInviterName('Bethan')).toBe('Bethan')
    expect(safeInviterName('Aran Jones')).toBe('Aran Jones')
  })
})
