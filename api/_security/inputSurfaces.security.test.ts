/**
 * SECURITY AUDIT 2026-08-11 — area 3 (input handling & injection).
 *
 * Cross-cutting input surfaces that don't belong to one endpoint: origin
 * derivation from the Host header, email rendering/sending, subtree path
 * matching, type coercion on unauthenticated bodies, and the SSRF/mass-
 * assignment sweeps that came back clean.
 *
 * Findings: INPUT-05 (unanchored path LIKE), INPUT-07 (type coercion 500),
 * INPUT-10 (Host header reflected into an origin), INPUT-11 (attacker-driven
 * outbound DNS).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

// ─────────────────────────────────────────────────────────────────────────
// INPUT-10 — Host header reflected into the app origin
// ─────────────────────────────────────────────────────────────────────────

describe('getAppOrigin — Host header handling (INPUT-10)', () => {
  it('CONTROL: the two known production hosts map to fixed canonical origins', async () => {
    const { getAppOrigin } = await import('../_utils/appOrigin')
    const at = (host: string) => getAppOrigin({ headers: { host } } as unknown as VercelRequest)

    expect(at('saysomethingin.app')).toBe('https://saysomethingin.app')
    expect(at('www.saysomethingin.app')).toBe('https://saysomethingin.app')
    expect(at('staging.saysomethingin.app')).toBe('https://staging.saysomethingin.app')
    expect(at('SAYSOMETHINGIN.APP:443')).toBe('https://saysomethingin.app')
  })

  it('CONTROL: a missing Host header falls back to production, never to an empty origin', async () => {
    const { getAppOrigin } = await import('../_utils/appOrigin')
    expect(getAppOrigin({ headers: {} } as unknown as VercelRequest)).toBe('https://saysomethingin.app')
  })

  // SECURITY FINDING INPUT-10: any unrecognised Host is echoed straight back
  // as `https://${host}` (api/_utils/appOrigin.ts:13, duplicated verbatim at
  // api/admin/create-signin-link.ts:32 and api/groups/[id]/demo-mint.ts:61).
  // The value is not even constrained to a hostname — a Host carrying a path
  // or a credential prefix survives intact, and the result is used to build
  // join/redeem links (api/groups/[id]/invites.ts:205,257,335,417,590) and as
  // Supabase's `redirectTo` (create-signin-link.ts:113).
  //
  // Two things keep this from being critical, and both are worth keeping:
  // Vercel only routes a request to this deployment when the Host is one of
  // its own domains, and Supabase drops any redirectTo outside the project
  // allow-list. Neither is a guarantee this code makes for itself. It should
  // allow-list the host (or reject anything not ending in
  // `.saysomethingin.app` / `.vercel.app`) rather than reflecting it.
  it('INPUT-10: an arbitrary Host is reflected verbatim into the origin (vulnerable, characterized)', async () => {
    const { getAppOrigin } = await import('../_utils/appOrigin')
    const at = (host: string) => getAppOrigin({ headers: { host } } as unknown as VercelRequest)

    expect(at('attacker.example')).toBe('https://attacker.example')
    expect(at('attacker.example/phish')).toBe('https://attacker.example/phish')
    expect(at('saysomethingin.app.attacker.example')).toBe('https://saysomethingin.app.attacker.example')
  })

  it.todo('INPUT-10: getAppOrigin should allow-list the Host and fall back to production for anything else')

  // CONTROL THAT HOLDS — and the reason INPUT-10 does not reach a real inbox:
  // every EMAILED link is rewritten onto a fixed origin, keeping only the path
  // and query from the mint-origin URL (api/_utils/sendInviteEmail.ts:79-86).
  it('CONTROL: toInviteEmailUrl strips a poisoned origin off an emailed join link', async () => {
    const { toInviteEmailUrl } = await import('../_utils/sendInviteEmail')
    expect(toInviteEmailUrl('https://attacker.example/redeem/ABC-123')).toBe(
      'https://saysomethingin.app/redeem/ABC-123',
    )
    expect(toInviteEmailUrl('https://attacker.example/redeem/ABC-123?x=1#y')).toBe(
      'https://saysomethingin.app/redeem/ABC-123?x=1#y',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Email rendering / sending — header & template injection
// ─────────────────────────────────────────────────────────────────────────

describe('invite email — template and header injection (controls)', () => {
  it('CONTROL: a URL carrying HTML breaks out of neither the href nor the body', async () => {
    const { renderInviteEmail } = await import('../_utils/inviteEmailTemplate')
    const hostile = 'https://saysomethingin.app/redeem/A"><script>alert(1)</script><a href="'
    const { html } = renderInviteEmail(hostile)

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    // The quote that would have closed the href attribute is entity-escaped,
    // so the injected markup stays inside the attribute value.
    expect(html).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('CONTROL: the subject and lead copy are fixed constants, not caller-supplied', async () => {
    const { renderInviteEmail } = await import('../_utils/inviteEmailTemplate')
    const a = renderInviteEmail('https://saysomethingin.app/redeem/A')
    const b = renderInviteEmail("https://saysomethingin.app/redeem/B\r\nBcc: victim@example.com")

    expect(a.subject).toBe(b.subject)
    expect(a.subject).toBe("You've been invited to try SaySomethingin")
  })

  // CRLF in an address cannot become a real SMTP header here: the send is a
  // JSON POST to Resend's HTTPS API (api/_utils/sendInviteEmail.ts:198-201),
  // so a newline is JSON-escaped inside a string value, never a header
  // boundary. This locks the property that matters — the only caller-supplied
  // values are `to` and the link, and both travel as JSON body values.
  it('CONTROL: a CRLF-bearing address is JSON-encoded, not emitted as a header line', () => {
    const address = "victim@example.com\r\nBcc: attacker@example.com"
    const body = JSON.stringify({ from: 'x', to: [address], subject: 's', html: 'h', text: 't' })

    expect(body).toContain('\\r\\n')
    expect(body.split('\n')).toHaveLength(1)
  })

  it('CONTROL: placeholder-persona addresses are never mailed', async () => {
    const { isMailable } = await import('../_utils/sendInviteEmail')
    const { PERSONA_EMAIL_DOMAIN } = await import('../_utils/provisionPersona')

    expect(isMailable(`someone@${PERSONA_EMAIL_DOMAIN}`)).toBe(false)
    expect(isMailable('')).toBe(false)
    expect(isMailable(null)).toBe(false)
    expect(isMailable('real@example.com')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// INPUT-05 — unanchored subtree path matching
// ─────────────────────────────────────────────────────────────────────────

describe('group subtree path matching (INPUT-05)', () => {
  /** Postgres LIKE with only `%` as a wildcard, which is all these call sites use. */
  function likeMatch(value: string, pattern: string): boolean {
    const rx = new RegExp(`^${pattern.split('%').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
    return rx.test(value)
  }

  // SECURITY FINDING INPUT-05: `.like('path', `${path}%`)` has no segment
  // boundary, so a group's subtree query also matches every SIBLING whose slug
  // merely starts with the same characters. Two root orgs named "Acme" and
  // "Acme Group" slug to `acme` and `acme-group`, and `acme%` matches both —
  // so Acme's leader pulls Acme Group's classes into cohort and entitlement
  // resolution. Call sites: api/school/rate-compare.ts:119 and :230, and
  // api/_utils/orgPlatform.ts:142.
  //
  // The fix already exists in this repo: api/groups/[id]/invites.ts:132 uses
  // `path.eq.${path},path.like.${path}/%` — exact node OR strict descendant —
  // and its own comment calls out the 'a/b' vs 'a/b-c' case. The three sites
  // above should adopt it.
  it('INPUT-05: the unanchored `${path}%` pattern matches a sibling org (vulnerable, characterized)', () => {
    const mine = 'acme'
    const otherTenant = 'acme-group'
    const myChild = 'acme/year-7'

    expect(likeMatch(myChild, `${mine}%`)).toBe(true) // wanted
    expect(likeMatch(otherTenant, `${mine}%`)).toBe(true) // NOT wanted — another tenant
  })

  it('CONTROL: the segment-safe idiom used by invites.ts excludes the sibling', () => {
    const mine = 'acme'
    const matchesSegmentSafe = (candidate: string) =>
      candidate === mine || likeMatch(candidate, `${mine}/%`)

    expect(matchesSegmentSafe('acme')).toBe(true)
    expect(matchesSegmentSafe('acme/year-7')).toBe(true)
    expect(matchesSegmentSafe('acme-group')).toBe(false)
    expect(matchesSegmentSafe('acme-group/year-7')).toBe(false)
  })

  it.todo(
    'INPUT-05: rate-compare.ts:119/230 and orgPlatform.ts:142 should use the segment-safe path.eq/path.like idiom',
  )

  // A second, separate hazard on the same column: `_` is a single-character
  // LIKE wildcard and slugs never contain it, but names CAN produce a `%`-free
  // slug only because compute_group_path() strips non-alphanumerics. This
  // pins that dependency.
  it('CONTROL: slugged paths contain no LIKE wildcards, so the pattern cannot be widened by a group name', async () => {
    const { groupSlug } = await import('../_utils/groupSlug')
    expect(groupSlug('100%_Acme_%')).not.toMatch(/[%_]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// INPUT-07 — missing type validation on an authenticated body
// ─────────────────────────────────────────────────────────────────────────

vi.mock('../_utils/auth', () => ({
  getAuthUserId: () => Promise.resolve('auth-uid-1'),
  verifyAuthToken: () => Promise.resolve({ valid: true, userId: 'auth-uid-1' }),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { verifyOtp: () => Promise.resolve({ error: { message: 'Invalid code' } }) },
    from: () => {
      const c: any = {
        select: () => c,
        eq: () => c,
        contains: () => c,
        update: () => c,
        single: () => Promise.resolve({ data: null, error: null }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }
      return c
    },
  }),
}))

function makeRes() {
  const res: any = {}
  res.setHeader = vi.fn(() => res)
  res.status = vi.fn((code: number) => {
    res._status = code
    return res
  })
  res.json = vi.fn((body: unknown) => {
    res._json = body
    return res
  })
  res.end = vi.fn(() => res)
  return res as VercelResponse & { _status?: number; _json?: any }
}

describe('POST /api/email/verify — body type validation (INPUT-07)', () => {
  let handler: typeof import('../email/verify').default

  beforeEach(async () => {
    vi.resetModules()
    handler = (await import('../email/verify')).default
  })

  it('CONTROL: a missing email/token is rejected with 400', async () => {
    const res = makeRes()
    await handler({ method: 'POST', headers: {}, query: {}, body: {} } as VercelRequest, res)
    expect(res._status).toBe(400)
  })

  // SECURITY FINDING INPUT-07: `email` is never type-checked before
  // `email.toLowerCase().trim()` at api/email/verify.ts:36 — and that line sits
  // OUTSIDE the try block that starts at line 44, so a non-string body value
  // throws an unhandled TypeError out of the handler. The caller gets an
  // opaque platform 500 and the stack lands in the logs. Every neighbouring
  // endpoint does `typeof x === 'string' ? … : ''`; this one should too.
  it('INPUT-07: a non-string email throws out of the handler instead of returning 400 (vulnerable, characterized)', async () => {
    const res = makeRes()
    await expect(
      handler(
        { method: 'POST', headers: {}, query: {}, body: { email: { evil: 1 }, token: '123456' } } as VercelRequest,
        res,
      ),
    ).rejects.toThrow(TypeError)
    expect(res._status).toBeUndefined()
  })

  it('INPUT-07b: an array email throws the same way', async () => {
    const res = makeRes()
    await expect(
      handler(
        { method: 'POST', headers: {}, query: {}, body: { email: ['a@b.c'], token: '1' } } as VercelRequest,
        res,
      ),
    ).rejects.toThrow(TypeError)
  })

  it.todo('INPUT-07: api/email/verify.ts should type-check `email` and `token` as strings and 400 otherwise')
})

// ─────────────────────────────────────────────────────────────────────────
// Sweeps that came back clean — locked so a future change has to break a test
// ─────────────────────────────────────────────────────────────────────────

describe('email-format validator is not ReDoS-prone (INPUT-11 context)', () => {
  it('CONTROL: a 100k-character non-matching address is rejected in linear time', async () => {
    const { isValidEmailFormat } = await import('../_utils/emailValidation')

    const started = Date.now()
    expect(isValidEmailFormat(`a@${'b'.repeat(100_000)}`)).toBe(false)
    expect(isValidEmailFormat(`${'a'.repeat(100_000)}@`)).toBe(false)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('CONTROL: a non-string never reaches the regex', async () => {
    const { isValidEmailFormat } = await import('../_utils/emailValidation')
    expect(isValidEmailFormat({ toString: () => 'a@b.c' })).toBe(false)
    expect(isValidEmailFormat(['a@b.c'])).toBe(false)
    expect(isValidEmailFormat(null)).toBe(false)
  })

  // SECURITY FINDING INPUT-11: `hasMxRecord` (api/_utils/emailValidation.ts:71)
  // performs a live DNS MX lookup on a domain taken from an UNAUTHENTICATED
  // body (api/auth/possession-redeem.ts). That is an attacker-steerable
  // outbound request from the serverless egress IP — a low-bandwidth
  // exfiltration/beacon channel and a way to make this app query arbitrary
  // nameservers. It is DNS only (no HTTP fetch), fails open, and is bounded by
  // a 2s timeout, which is why it is low. A domain-syntax gate plus a
  // per-IP rate limit ahead of the lookup would close it.
  it('INPUT-11: emailDomain extracts whatever the caller put after the @ (characterized)', async () => {
    const { emailDomain } = await import('../_utils/emailValidation')
    expect(emailDomain('a@attacker-controlled.example')).toBe('attacker-controlled.example')
    expect(emailDomain('a@x.canary.attacker.example')).toBe('x.canary.attacker.example')
  })

  it.todo('INPUT-11: rate-limit / syntax-gate the MX lookup driven by unauthenticated possession-redeem input')
})

describe('SSRF and mass-assignment sweeps', () => {
  // Swept 2026-08-11 across all of api/**: the only two fetch() calls are
  // api/_utils/sendInviteEmail.ts:198 (hardcoded https://api.resend.com) and
  // api/_utils/wise.ts:67, whose URL is built from WISE_API_BASE + a
  // code-literal path. No endpoint fetches a caller-supplied URL. This test
  // locks the Wise base-URL construction, the only one with any env input.
  it('CONTROL: the Wise client builds its URL from an env base, not from request data', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.promises.readFile(new URL('../_utils/wise.ts', import.meta.url), 'utf8'),
    )
    // The fetch target must be the module-local `url`, assembled from the
    // configured base — never a value threaded in from a handler's req.
    expect(source).toContain('await fetch(url,')
    expect(source).not.toMatch(/fetch\(\s*(req|request)\./)
  })

  it('CONTROL: no api/** handler spreads req.body straight into an insert', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    // .../api/_security/<this file> → .../api → repo root
    const apiDir = path.dirname(path.dirname(new URL(import.meta.url).pathname))
    const root = path.dirname(apiDir)

    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
          const src = fs.readFileSync(full, 'utf8')
          if (/\.(insert|upsert)\(\s*\{\s*\.\.\.\s*(req\.body|body)\b/.test(src)) {
            offenders.push(path.relative(root, full))
          }
        }
      }
    }
    walk(apiDir)

    expect(offenders).toEqual([])
  })
})
