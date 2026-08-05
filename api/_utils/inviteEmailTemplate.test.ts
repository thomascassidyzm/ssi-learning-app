/**
 * The invitation's WORDS. Founder ruling 2026-08-05: the mail should read
 * "Deborah invited you to join <org>", not Supabase's "you have been invited
 * to create a user on https://saysomethingin.app". The degradations matter as
 * much as the happy path — a missing name must never surface as an empty
 * string, a raw email address, or the word "undefined" in a learner's inbox.
 */
import { describe, it, expect } from 'vitest'
import { renderInviteEmail } from './inviteEmailTemplate'

const URL_ = 'https://example.supabase.co/auth/v1/verify?token=abc&type=magiclink'

describe('renderInviteEmail', () => {
  it('names the inviter and the org', () => {
    const { subject, html, text } = renderInviteEmail({
      inviterName: 'Deborah',
      orgName: 'Seaside Model School',
      url: URL_,
    })
    expect(subject).toBe('Deborah invited you to join Seaside Model School')
    expect(html).toContain('Deborah has invited you to join')
    expect(html).toContain('Seaside Model School')
    expect(text).toContain('Deborah has invited you to join Seaside Model School')
  })

  it('falls back to the org alone when we do not know who invited them', () => {
    const { subject, text } = renderInviteEmail({ orgName: 'Coastal Districts Region', url: URL_ })
    expect(subject).toBe("You've been invited to join Coastal Districts Region")
    expect(text).toContain("You've been invited to join Coastal Districts Region")
  })

  it('still reads as a sentence when neither name is known', () => {
    const { subject, html } = renderInviteEmail({ url: URL_ })
    expect(subject).toBe("You've been invited to SaySomethingin")
    expect(html).not.toContain('undefined')
  })

  it('treats blank and literal "undefined" names as unknown', () => {
    const { subject } = renderInviteEmail({ inviterName: '   ', orgName: 'undefined', url: URL_ })
    expect(subject).toBe("You've been invited to SaySomethingin")
  })

  it('carries the link in both a button and a copyable plain-text line', () => {
    const { html, text } = renderInviteEmail({ orgName: 'A School', url: URL_ })
    expect(html).toContain('Accept the invitation')
    expect(html).toContain(URL_.replace(/&/g, '&amp;'))
    expect(text).toContain(URL_)
  })

  it('escapes a name rather than letting it write HTML', () => {
    const { html } = renderInviteEmail({
      inviterName: '<script>alert(1)</script>',
      orgName: 'A & B School',
      url: URL_,
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('A &amp; B School')
  })

  it('promises no code entry — the ruling, in the copy', () => {
    const { html, text } = renderInviteEmail({ orgName: 'A School', url: URL_ })
    expect(html).toContain("there's no code to type")
    expect(text).toContain("there's no code to type")
  })
})
