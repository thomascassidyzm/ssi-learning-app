/**
 * sendInviteEmail — what is worth pinning is WHO WRITES THE MAIL.
 *
 * The bug history is a chain of wrong senders: `signInWithOtp` mailed a
 * 6-digit code card with no link (Deborah, staging 2026-08-05), then
 * `inviteUserByEmail` mailed a link wearing Supabase's stock "you have been
 * invited to create a user on…" copy. Tom's ruling: Resend is the sender. So
 * the assertions below pin that the primary path asks Supabase only for a LINK
 * (`generateLink`, which sends nothing) and posts our own branded invitation to
 * Resend — naming the inviter and the org, with NO code fallback — while a
 * missing RESEND_API_KEY degrades to the old Supabase path rather than silence.
 * And the emailed link always points at the allow-listed production origin.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'

const ACTION_LINK = 'https://example.supabase.co/auth/v1/verify?token=tok&type=magiclink&redirect_to=https://saysomethingin.app/redeem/ABC123'

let otpCalls: any[] = []
let inviteCalls: any[] = []
let generateCalls: any[] = []
let otpError: { message: string } | null = null
let inviteError: { message: string } | null = null
let generateError: { message: string } | null = null
let generateActionLink: string | null = ACTION_LINK
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
        generateLink: vi.fn(async (args: any) => {
          generateCalls.push({ key, ...args })
          return {
            data: generateActionLink ? { properties: { action_link: generateActionLink } } : null,
            error: generateError,
          }
        }),
      },
    },
  }),
}))

let fetchCalls: any[] = []
let fetchStatus = 200

let sendInviteEmail: typeof import('./sendInviteEmail').sendInviteEmail
let isMailable: typeof import('./sendInviteEmail').isMailable
let toInviteEmailUrl: typeof import('./sendInviteEmail').toInviteEmailUrl

beforeEach(async () => {
  otpCalls = []
  inviteCalls = []
  generateCalls = []
  fetchCalls = []
  otpError = null
  inviteError = null
  generateError = null
  generateActionLink = ACTION_LINK
  fetchStatus = 200
  process.env.RESEND_API_KEY = 'resend-key'
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    fetchCalls.push({ url, headers: init.headers, body: JSON.parse(init.body) })
    return { ok: fetchStatus < 400, status: fetchStatus, text: async () => 'provider said no' } as any
  }))
  const mod = await import('./sendInviteEmail')
  sendInviteEmail = mod.sendInviteEmail
  isMailable = mod.isMailable
  toInviteEmailUrl = mod.toInviteEmailUrl
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.RESEND_API_KEY
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

describe('sendInviteEmail — the branded Resend path', () => {
  it('mints a link with Supabase and posts our own invitation to Resend', async () => {
    const result = await sendInviteEmail('Aran@Example.com', 'https://staging.saysomethingin.app/redeem/ABC123', {
      inviterName: 'Deborah',
      orgName: 'Seaside Model School',
    })
    expect(result).toEqual({ sent: true, via: 'link', url: 'https://saysomethingin.app/redeem/ABC123' })

    // Supabase is asked for the LINK only — magiclink, the one type that works
    // whether or not the persona has clicked before. It sends no mail.
    expect(generateCalls).toEqual([
      {
        key: 'service-key',
        type: 'magiclink',
        email: 'aran@example.com',
        options: { redirectTo: 'https://saysomethingin.app/redeem/ABC123' },
      },
    ])
    // No Supabase template is ever triggered on this path.
    expect(inviteCalls.length).toBe(0)
    expect(otpCalls.length).toBe(0)

    expect(fetchCalls.length).toBe(1)
    const [call] = fetchCalls
    expect(call.url).toBe('https://api.resend.com/emails')
    expect(call.headers.Authorization).toBe('Bearer resend-key')
    expect(call.body.from).toContain('noreply@contact.saysomethingin.app')
    expect(call.body.to).toEqual(['aran@example.com'])
    expect(call.body.subject).toBe('Deborah invited you to join Seaside Model School')
    // The clickable thing is the minted sign-in link, in both parts.
    expect(call.body.html).toContain(ACTION_LINK.replace(/&/g, '&amp;'))
    expect(call.body.text).toContain(ACTION_LINK)
  })

  it('reports a refused send instead of quietly mailing a 6-digit code', async () => {
    fetchStatus = 429
    const result = await sendInviteEmail('aran@example.com', 'https://saysomethingin.app/redeem/A')
    expect(result.sent).toBe(false)
    expect(result.error).toContain('429')
    expect(otpCalls.length).toBe(0)
  })

  it('reports a link-minting failure rather than sending a mail with nothing in it', async () => {
    generateError = { message: 'over_email_send_rate_limit' }
    const result = await sendInviteEmail('aran@example.com', 'https://saysomethingin.app/redeem/A')
    expect(result).toEqual({ sent: false, error: 'over_email_send_rate_limit', url: 'https://saysomethingin.app/redeem/A' })
    expect(fetchCalls.length).toBe(0)
  })

  it('treats a link-less response as a failure', async () => {
    generateActionLink = null
    const result = await sendInviteEmail('aran@example.com', 'https://saysomethingin.app/redeem/A')
    expect(result.sent).toBe(false)
    expect(result.error).toBe('could not mint a sign-in link')
    expect(fetchCalls.length).toBe(0)
  })

  it('never calls a sender for a placeholder address', async () => {
    const result = await sendInviteEmail('persona-1@invite.saysomethingin.app', 'https://x/redeem/A')
    expect(result.sent).toBe(false)
    expect(generateCalls.length).toBe(0)
    expect(fetchCalls.length).toBe(0)
  })
})

describe('sendInviteEmail — the Supabase fallback when RESEND_API_KEY is absent', () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY
  })

  it('sends the Supabase invite template — stock copy, but still a real link', async () => {
    const result = await sendInviteEmail('aran@example.com', 'https://staging.saysomethingin.app/redeem/ABC123')
    expect(result).toEqual({ sent: true, via: 'link', url: 'https://saysomethingin.app/redeem/ABC123' })
    expect(inviteCalls).toEqual([
      {
        key: 'service-key',
        email: 'aran@example.com',
        options: { redirectTo: 'https://saysomethingin.app/redeem/ABC123' },
      },
    ])
    expect(fetchCalls.length).toBe(0)
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
})
