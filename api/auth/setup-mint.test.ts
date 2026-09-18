/**
 * POST /api/auth/setup-mint — the school door's no-code way in (job #188).
 *
 * Three rails proved here, because each one is the whole security argument
 * for opening the door:
 *   1. a fresh address is minted a session, stamped UNCLAIMED with
 *      minted_by 'setup_door' (so the real owner can evict it) and
 *      onboarded_via 'possession' (so every reader treats it as unproven);
 *   2. an untouched SHELL — a code requested, never typed, the Hwb pattern —
 *      is adopted, not refused, and stamped the same way;
 *   3. a CONFIRMED account is never minted a session: `existing: true`, no
 *      session, and the door falls back to the sign-in code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
process.env.SUPABASE_ANON_KEY = 'anon-key'

/** A token whose payload carries session_id, the way GoTrue's do. */
const ACCESS = 'h.' + Buffer.from(JSON.stringify({ session_id: 'sess-minted' })).toString('base64') + '.s'

let existingUser: any = null
let createUserError: any = null
let metadataWrites: any[] = []
let inserted: any[] = []
let learnerUpdates: any[] = []
let deletedUsers: string[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const b: any = {}
      for (const op of ['select', 'eq', 'in', 'gte', 'order', 'limit', 'delete']) b[op] = () => b
      b.update = (row: any) => { if (table === 'learners') learnerUpdates.push(row); return b }
      b.insert = (row: any) => { inserted.push(row); return Promise.resolve({ error: null }) }
      b.then = (onF: any) => Promise.resolve({ data: null, count: 0, error: null }).then(onF)
      return b
    },
    auth: {
      admin: {
        createUser: async (args: any) => {
          if (createUserError) return { data: null, error: createUserError }
          return { data: { user: { id: 'user-new', app_metadata: {}, user_metadata: args.user_metadata } }, error: null }
        },
        generateLink: async () => ({
          data: { properties: { hashed_token: 'hash-1' }, user: existingUser || { id: 'user-new' } },
          error: null,
        }),
        updateUserById: async (id: string, patch: any) => { metadataWrites.push({ id, ...patch }); return { data: {}, error: null } },
        getUserById: async (id: string) => ({ data: { user: { id, app_metadata: {} } } }),
        deleteUser: async (id: string) => { deletedUsers.push(id); return { error: null } },
      },
      verifyOtp: async () => ({ data: { session: { access_token: ACCESS, refresh_token: 'r' } }, error: null }),
    },
  }),
}))

function makeRes() {
  const res: any = { statusCode: 0, body: null }
  res.status = (c: number) => { res.statusCode = c; return res }
  res.json = (b: any) => { res.body = b; return res }
  res.setHeader = () => res
  res.end = () => res
  return res as VercelResponse & { statusCode: number; body: any }
}
const req = (email: string, track = 'school') => ({
  method: 'POST', body: { email, track }, headers: {}, socket: { remoteAddress: '203.0.113.9' },
}) as unknown as VercelRequest

describe('setup-mint', () => {
  let handler: typeof import('./setup-mint').default
  beforeEach(async () => {
    vi.resetModules()
    existingUser = null; createUserError = null
    metadataWrites = []; inserted = []; learnerUpdates = []; deletedUsers = []
    handler = (await import('./setup-mint')).default
  })

  it('mints a session for a fresh address, unproven and unclaimed', async () => {
    const res = makeRes()
    await handler(req('Head@Ysgol.Cymru'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.session).toEqual({ access_token: ACCESS, refresh_token: 'r' })
    expect(res.body.adopted).toBe(false)
    const stamp = metadataWrites.find((w) => w.app_metadata?.unclaimed_mint)
    expect(stamp?.app_metadata.unclaimed_mint).toMatchObject({ session_id: 'sess-minted', minted_by: 'setup_door' })
    expect(inserted.at(-1)).toMatchObject({ email: 'head@ysgol.cymru', outcome: 'setup_mint_minted', auth_user_id: 'user-new' })
  })

  it('adopts an untouched shell — code requested, never typed — and marks it unproven', async () => {
    createUserError = { code: 'email_exists', message: 'A user with this email address has already been registered' }
    existingUser = { id: 'user-shell', email_confirmed_at: null, last_sign_in_at: null, user_metadata: {} }
    const res = makeRes()
    await handler(req('hughesr310@hwbcymru.net'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.adopted).toBe(true)
    expect(res.body.session.access_token).toBe(ACCESS)
    expect(metadataWrites.find((w) => w.user_metadata)?.user_metadata).toMatchObject({ onboarded_via: 'possession', setup_door: 'school' })
    expect(metadataWrites.find((w) => w.app_metadata?.unclaimed_mint)?.id).toBe('user-shell')
    expect(learnerUpdates).toContainEqual({ needs_verification: true })
    expect(inserted.at(-1)).toMatchObject({ outcome: 'setup_mint_adopted_shell', auth_user_id: 'user-shell' })
  })

  it('NEVER mints a session for a confirmed account — existing:true and no session', async () => {
    createUserError = { code: 'email_exists', message: 'already registered' }
    existingUser = { id: 'user-real', email_confirmed_at: '2026-09-10T08:00:40Z', last_sign_in_at: '2026-09-10T08:00:40Z' }
    const res = makeRes()
    await handler(req('mcauleys51@hwbcymru.net'), res)
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ existing: true })
    expect(metadataWrites).toHaveLength(0)
    expect(inserted.at(-1)).toMatchObject({ outcome: 'setup_mint_existing' })
  })

  it('a signed-in-once but unconfirmed account is somebody\'s — not a shell', async () => {
    createUserError = { code: 'email_exists', message: 'already registered' }
    existingUser = { id: 'user-x', email_confirmed_at: null, last_sign_in_at: '2026-09-01T00:00:00Z' }
    const res = makeRes()
    await handler(req('x@example.com'), res)
    expect(res.body).toEqual({ existing: true })
  })

  it('is the school door only', async () => {
    const res = makeRes()
    await handler(req('t@example.com', 'tutor'), res)
    expect(res.statusCode).toBe(400)
  })
})
