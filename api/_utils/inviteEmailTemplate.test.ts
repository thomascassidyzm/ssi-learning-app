/**
 * The invitation's WORDS. Tom's ruling 2026-08-05: the mail comes from NO-ONE.
 * "it shouldn't come from Deborah, it should come from whoever is the person
 * inviting them … OR just no-one … as simple as possible." Naming the inviter
 * was tried and cost two lookups and a leak guard, so the no-one branch won.
 *
 * The point of these tests is that the copy is FIXED — the mail says the same
 * thing to everyone, so there is no name to be blank, stale, wrong, or quietly
 * lifted from somebody's email address.
 */
import { describe, it, expect } from 'vitest'
import { renderInviteEmail } from './inviteEmailTemplate'

const URL_ = 'https://example.supabase.co/auth/v1/verify?token=abc&type=magiclink'

describe('renderInviteEmail', () => {
  it('is Tom sentence, verbatim, in both parts', () => {
    const { subject, html, text } = renderInviteEmail(URL_)
    expect(subject).toBe("You've been invited to try SaySomethingin")
    expect(html).toContain("You've been invited to try SaySomethingin — please click to activate your account.")
    expect(text).toContain("You've been invited to try SaySomethingin — please click to activate your account.")
  })

  it('names nobody — no inviter, no org, nothing personal to get wrong', () => {
    const { subject, html, text } = renderInviteEmail(URL_)
    for (const part of [subject, html, text]) {
      expect(part).not.toMatch(/invited you to join/)
      expect(part).not.toContain('undefined')
    }
  })

  it('says the same thing every time — the copy takes no input but the link', () => {
    const a = renderInviteEmail('https://example.com/a')
    const b = renderInviteEmail('https://example.com/b')
    expect(a.subject).toBe(b.subject)
    expect(a.html.replaceAll('https://example.com/a', 'X')).toBe(b.html.replaceAll('https://example.com/b', 'X'))
    expect(a.text.replaceAll('https://example.com/a', 'X')).toBe(b.text.replaceAll('https://example.com/b', 'X'))
  })

  it('carries the link in both a button and a copyable plain-text line', () => {
    const { html, text } = renderInviteEmail(URL_)
    expect(html).toContain('Activate your account')
    expect(html).toContain(URL_.replace(/&/g, '&amp;'))
    expect(text).toContain(URL_)
  })

  it('escapes the URL rather than letting it write HTML', () => {
    const { html } = renderInviteEmail('https://x/?a="><script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('promises no code entry — the founder ruling, in the copy', () => {
    const { html, text } = renderInviteEmail(URL_)
    expect(html).toContain("there's no code to type")
    expect(text).toContain("there's no code to type")
  })
})
