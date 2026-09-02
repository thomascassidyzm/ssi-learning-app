/**
 * The sign-in code mail is a DELIVERABILITY artifact, so these tests assert
 * the scoring-relevant properties, not the prose: both parts present and
 * genuinely equivalent, the code readable in each, exactly one link, and none
 * of the things that cost score (trackers, shorteners, redirect wrappers).
 */
import { describe, it, expect } from 'vitest'
import { renderSignInCodeEmail, SIGN_IN_SUBJECT, SITE_URL } from './signInCodeEmail'

const CODE = '483921'
const WHO = 'rob@hwbcymru.net'

describe('renderSignInCodeEmail', () => {
  const { subject, html, text } = renderSignInCodeEmail(CODE, WHO)

  it('subjects the mail without putting bare digits in it', () => {
    expect(subject).toBe(SIGN_IN_SUBJECT)
    expect(subject).not.toMatch(/\d{4,}/)
    expect(subject.toLowerCase()).toContain('saysomethingin')
  })

  it('ships a real plain-text part, not a stub', () => {
    expect(text.length).toBeGreaterThan(400)
    expect(text.split('\n').filter((l) => l.trim()).length).toBeGreaterThan(6)
    expect(text).not.toContain('<')
  })

  it('carries the code, unmistakably, in both parts', () => {
    expect(text).toContain(`\n${CODE}\n`)
    expect(html).toContain(CODE)
    // Six contiguous digits — spacing or hyphens would break phone autofill
    // and make it harder to copy.
    expect(html).toMatch(new RegExp(`>${CODE}<`))
  })

  it('names the address it was sent to, in both parts', () => {
    expect(text).toContain(WHO)
    expect(html).toContain(WHO)
  })

  it('says what it is for, how long it lasts and what to do if you did not ask', () => {
    for (const body of [text, html]) {
      expect(body).toMatch(/sign in to SaySomethingin/i)
      expect(body).toMatch(/expires/i)
      expect(body).toMatch(/didn't ask/i)
      expect(body).toMatch(/reply to this email/i)
    }
  })

  it('links to the site exactly once, unwrapped', () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])
    expect(hrefs).toEqual([SITE_URL])
    expect(text).toContain(SITE_URL)
  })

  it('carries nothing that costs deliverability', () => {
    expect(html).not.toMatch(/<img/i)              // no tracking pixel
    expect(html).not.toMatch(/bit\.ly|tinyurl|lnk\./i)  // no shorteners
    expect(html).not.toMatch(/\/auth\/v1\/verify/)  // no magic link a scanner can burn
    expect(html).not.toMatch(/<script/i)
    expect(text).not.toMatch(/\/auth\/v1\/verify/)
  })

  it('escapes anything interpolated', () => {
    const { html: h } = renderSignInCodeEmail('123456', 'a"><script>x</script>@b.com')
    expect(h).not.toContain('<script>')
  })
})
