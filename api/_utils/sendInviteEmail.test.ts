/**
 * sendInviteEmail — what is worth pinning is WHICH SUPABASE TEMPLATE gets
 * sent, because that is the whole bug (Deborah, staging 2026-08-05: "only a
 * 6-digit code, no link"). The magic-link template this project ships is a
 * code card with no link in it; the invite template carries a real `<a href>`.
 * So: `admin.inviteUserByEmail` is the primary path, `signInWithOtp` survives
 * ONLY as the already-registered fallback — and the emailed link points at the
 * allow-listed production origin, never the mint origin.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

let otpCalls: any[] = []
let inviteCalls: any[] = []
let otpError: { message: string } | null = null
let inviteError: { message: string } | null = null
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => ({
    auth: {
      signInWithOtp: vi.fn(async (args: any) => {
        otpCalls.push({ key, ...args })
        return { data: null, error: otpError }
      }),
      admin: {
        inviteUserByEmail: vi.fn(async (email: string, options: any) => {
          inviteCalls.push({ key, email, options })
          return { data: null, error: inviteError }
        }),
      },
    },
  }),
}))

let sendInviteEmail: typeof import('./sendInviteEmail').sendInviteEmail
let isMailable: typeof import('./sendInviteEmail').isMailable
let toInviteEmailUrl: typeof import('./sendInviteEmail').toInviteEmailUrl

beforeEach(async () => {
  otpCalls = []
  inviteCalls = []
  otpError = null
  inviteError = null
  const mod = await import('./sendInviteEmail')
  sendInviteEmail = mod.sendInviteEmail
  isMailable = mod.isMailable
  toInviteEmailUrl = mod.toInviteEmailUrl
})

describe('isMailable', () => {
  it('accepts a real address', () => {
    expect(isMailable('aran@example.com')).toBe(true)
  })
  it('rejects the placeholder domain a no-email persona is minted against', () => {
    expect(isMailable('persona-abc@invite.saysomethingin.app')).toBe(false)
  })
  it('rejects empty and malformed', () => {
    expect(isMailable('')).toBe(false)
    expect(isMailable(null)).toBe(false)
    expect(isMailable('not-an-address')).toBe(false)
  })
})

describe('toInviteEmailUrl', () => {
  it('moves a staging join link onto the allow-listed production origin', () => {
    expect(toInviteEmailUrl('https://staging.saysomethingin.app/redeem/ABC123')).toBe(
      'https://saysomethingin.app/redeem/ABC123'
    )
  })
  it('leaves a production link alone', () => {
    expect(toInviteEmailUrl('https://saysomethingin.app/group/XY9')).toBe('https://saysomethingin.app/group/XY9')
  })
  it('passes a non-URL through rather than throwing', () => {
    expect(toInviteEmailUrl('/redeem/ABC')).toBe('/redeem/ABC')
  })
})

describe('sendInviteEmail', () => {
  it('sends the INVITE template — the one with a clickable link — redirecting to the join link', async () => {
    const result = await sendInviteEmail('Aran@Example.com', 'https://staging.saysomethingin.app/redeem/ABC123')
    expect(result).toEqual({
      sent: true,
      via: 'link',
      url: 'https://saysomethingin.app/redeem/ABC123',
    })
    expect(inviteCalls).toEqual([
      {
        key: 'service-key',
        email: 'aran@example.com',
        options: { redirectTo: 'https://saysomethingin.app/redeem/ABC123' },
      },
    ])
    expect(otpCalls.length).toBe(0)
  })

  it('falls back to the sign-in code ONLY when the person already accepted an invite', async () => {
    inviteError = { message: 'A user with this email address has already been registered' }
    const result = await sendInviteEmail('aran@example.com', 'https://saysomethingin.app/redeem/ABC123')
    expect(result).toEqual({ sent: true, via: 'code', url: 'https://saysomethingin.app/redeem/ABC123' })
    expect(otpCalls).toEqual([
      {
        key: 'anon-key',
        email: 'aran@example.com',
        options: { shouldCreateUser: false, emailRedirectTo: 'https://saysomethingin.app/redeem/ABC123' },
      },
    ])
  })

  it('reports any other send failure instead of quietly mailing a code', async () => {
    inviteError = { message: 'over_email_send_rate_limit' }
    const result = await sendInviteEmail('aran@example.com', 'https://saysomethingin.app/redeem/A')
    expect(result.sent).toBe(false)
    expect(result.error).toBe('over_email_send_rate_limit')
    expect(otpCalls.length).toBe(0)
  })

  it('reports the fallback failure rather than throwing, so a mint is never lost to a mail problem', async () => {
    inviteError = { message: 'already been registered' }
    otpError = { message: 'over_email_send_rate_limit' }
    const result = await sendInviteEmail('aran@example.com', 'https://saysomethingin.app/redeem/A')
    expect(result.sent).toBe(false)
    expect(result.error).toBe('over_email_send_rate_limit')
  })

  it('never calls a sender for a placeholder address', async () => {
    const result = await sendInviteEmail('persona-1@invite.saysomethingin.app', 'https://x/redeem/A')
    expect(result.sent).toBe(false)
    expect(inviteCalls.length).toBe(0)
    expect(otpCalls.length).toBe(0)
  })
})
