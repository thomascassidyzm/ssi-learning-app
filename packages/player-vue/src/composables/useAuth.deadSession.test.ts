import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuth } from './useAuth'

// FABLE incident 2 (2026-07-18): admin pages failed with "Auth session
// missing!" while the learner side worked. Cause: supabase-js signOut()
// defaults to scope:'global' — a sign-out on ANY device revoked the admin's
// sessions everywhere, and the desktop tab kept serving its cached (revoked,
// unexpired) token. Stateless client-direct reads accepted it; GoTrue-verified
// server endpoints answered session_not_found. These tests pin the two
// defences: sign-out is device-local, and a cached-but-revoked session is
// torn down on boot instead of half-working.

function queryBuilder(result: any = { data: null, error: { code: 'PGRST116' } }) {
  const b: any = {}
  for (const m of ['select', 'eq', 'update', 'insert', 'upsert', 'delete', 'single', 'maybeSingle', 'order', 'limit', 'in', 'is']) {
    b[m] = () => b
  }
  b.then = (resolve: (v: any) => void) => Promise.resolve(result).then(resolve)
  return b
}

function makeClient(overrides: Record<string, any> = {}) {
  return {
    from: () => queryBuilder(),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
  } as any
}

const liveSession = {
  user: { id: 'user-1', email: 'admin@example.com' },
  access_token: 'cached-access-token',
  refresh_token: 'cached-refresh-token',
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('signOut scope — sign-out is this device only, never global', () => {
  it('calls supabase signOut with scope local (global would revoke every device)', async () => {
    const client = makeClient()
    const auth = useAuth()
    await auth.initialize(client)
    await auth.signOut()

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(client.auth.signOut).not.toHaveBeenCalledWith()
  })
})

describe('boot validation — a cached session revoked server-side is torn down', () => {
  it('signs out locally when getUser answers AuthSessionMissingError (session_not_found)', async () => {
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: vi.fn(async () => ({
        data: { user: null },
        error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
      })),
    })

    const auth = useAuth()
    await auth.initialize(client)
    await flush()

    expect(client.auth.getUser).toHaveBeenCalled()
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(auth.isAuthenticated.value).toBe(false)
  })

  it('does NOT sign out on any other getUser failure (network flake, transient error)', async () => {
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: vi.fn(async () => ({
        data: { user: null },
        error: { name: 'AuthRetryableFetchError', message: 'fetch failed' },
      })),
    })

    await useAuth().initialize(client)
    await flush()

    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('does NOT sign out when the session is alive', async () => {
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: vi.fn(async () => ({ data: { user: liveSession.user }, error: null })),
    })

    await useAuth().initialize(client)
    await flush()

    expect(client.auth.signOut).not.toHaveBeenCalled()
  })
})
