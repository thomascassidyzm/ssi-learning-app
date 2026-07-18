import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuth, deadSessionNav, SIGNIN_AGAIN_NOTICE_KEY } from './useAuth'

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
      refreshSession: vi.fn(async () => ({
        data: { session: null },
        error: { message: 'refresh_token_not_found' },
      })),
      ...overrides,
    },
  } as any
}

const zombieGetUser = () =>
  vi.fn(async () => ({
    data: { user: null },
    error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
  }))

const liveSession = {
  user: { id: 'user-1', email: 'admin@example.com' },
  access_token: 'cached-access-token',
  refresh_token: 'cached-refresh-token',
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
}

let navReload: ReturnType<typeof vi.spyOn>
let navGoto: ReturnType<typeof vi.spyOn>
let navPath: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  navReload = vi.spyOn(deadSessionNav, 'reload').mockImplementation(() => {})
  navGoto = vi.spyOn(deadSessionNav, 'goto').mockImplementation(() => {})
  navPath = vi.spyOn(deadSessionNav, 'currentPath').mockReturnValue('/admin/structure')
})

afterEach(() => {
  vi.restoreAllMocks()
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
  it('tries refreshSession first, then signs out locally when refresh also fails', async () => {
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: zombieGetUser(),
    })

    const auth = useAuth()
    await auth.initialize(client)
    await flush()

    expect(client.auth.getUser).toHaveBeenCalled()
    expect(client.auth.refreshSession).toHaveBeenCalled()
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(auth.isAuthenticated.value).toBe(false)
  })

  it('routes an admin/schools surface to the sign-in wall with the friendly notice', async () => {
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: zombieGetUser(),
    })

    await useAuth().initialize(client)
    await flush()

    expect(sessionStorage.getItem(SIGNIN_AGAIN_NOTICE_KEY)).toBe('1')
    expect(navGoto).toHaveBeenCalledWith('/schools')
    expect(navReload).not.toHaveBeenCalled()
  })

  it('tears down without redirecting when the dead session is found on a player surface', async () => {
    navPath.mockReturnValue('/')
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: zombieGetUser(),
    })

    await useAuth().initialize(client)
    await flush()

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(navGoto).not.toHaveBeenCalled()
    expect(sessionStorage.getItem(SIGNIN_AGAIN_NOTICE_KEY)).toBeNull()
  })

  it('keeps the session and reloads once when refreshSession revives it', async () => {
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: zombieGetUser(),
      refreshSession: vi.fn(async () => ({
        data: { session: { ...liveSession, access_token: 'fresh-token' } },
        error: null,
      })),
    })

    await useAuth().initialize(client)
    await flush()

    expect(client.auth.refreshSession).toHaveBeenCalled()
    expect(client.auth.signOut).not.toHaveBeenCalled()
    expect(navGoto).not.toHaveBeenCalled()
    expect(navReload).toHaveBeenCalledTimes(1)
  })

  it('does not reload again within the loop-guard window after a refresh-reload', async () => {
    sessionStorage.setItem('ssi-dead-session-reload-at', String(Date.now()))
    const client = makeClient({
      getSession: vi.fn(async () => ({ data: { session: liveSession } })),
      getUser: zombieGetUser(),
      refreshSession: vi.fn(async () => ({
        data: { session: { ...liveSession, access_token: 'fresh-token' } },
        error: null,
      })),
    })

    await useAuth().initialize(client)
    await flush()

    expect(navReload).not.toHaveBeenCalled()
    expect(client.auth.signOut).not.toHaveBeenCalled()
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
