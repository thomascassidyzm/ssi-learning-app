/**
 * sendInviteEmail — the one thing worth pinning is the CALL SHAPE, because it
 * is what makes reusing the signup sender safe: `shouldCreateUser: false` (this
 * must never mint an account — the persona already exists) and an
 * `emailRedirectTo` of the person's own join link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'

let otpCalls: any[] = []
let otpError: { message: string } | null = null
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: vi.fn(async (args: any) => {
        otpCalls.push(args)
        return { data: null, error: otpError }
      }),
    },
  }),
}))

let sendInviteEmail: typeof import('./sendInviteEmail').sendInviteEmail
let isMailable: typeof import('./sendInviteEmail').isMailable

beforeEach(async () => {
  otpCalls = []
  otpError = null
  const mod = await import('./sendInviteEmail')
  sendInviteEmail = mod.sendInviteEmail
  isMailable = mod.isMailable
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

describe('sendInviteEmail', () => {
  it('sends via the existing signup sender, never creating a user, redirecting to the join link', async () => {
    const result = await sendInviteEmail('Aran@Example.com', 'https://staging.saysomethingin.app/redeem/ABC123')
    expect(result).toEqual({ sent: true })
    expect(otpCalls).toEqual([
      {
        email: 'aran@example.com',
        options: {
          shouldCreateUser: false,
          emailRedirectTo: 'https://staging.saysomethingin.app/redeem/ABC123',
        },
      },
    ])
  })

  it('reports the failure instead of throwing, so a mint is never lost to a mail problem', async () => {
    otpError = { message: 'over_email_send_rate_limit' }
    const result = await sendInviteEmail('aran@example.com', 'https://x/redeem/A')
    expect(result).toEqual({ sent: false, error: 'over_email_send_rate_limit' })
  })

  it('never calls the sender for a placeholder address', async () => {
    const result = await sendInviteEmail('persona-1@invite.saysomethingin.app', 'https://x/redeem/A')
    expect(result.sent).toBe(false)
    expect(otpCalls.length).toBe(0)
  })
})
