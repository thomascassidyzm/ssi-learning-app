import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAuth } from './useAuth'
import { useResolvedSession } from './useResolvedSession'
import { useUserRole } from './useUserRole'
import { readLastKnownIdentity } from './lastKnownIdentity'

// Tom, on his phone, 2026-08-15:
//
//   "I'm signed in. I go into airplane mode. Course loads fine and it shows as
//    my account but it shows the Save Progress button. Which will confuse
//    learners."
//
// useAuth raced getSession() against a timeout and, when the race produced no
// session, resolved a DEFINITIVE guest — so learnerId fell back to a
// 'guest-<uuid>' string and LearningPlayer's isGuestLearner rendered the
// guest-only nudge at a signed-in learner. A failed handshake is evidence of no
// network, not of a signed-out person.
//
// These tests pin both directions: an unverifiable session keeps the last known
// identity, and a definitive sign-out destroys it.

const AUTH_TOKEN_KEY = 'sb-swfvymspfxmnfhevgdkg-auth-token'

const learnerRow = {
  id: '11111111-2222-3333-4444-555555555555',
  user_id: 'auth-uid-1',
  display_name: 'Tom',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  preferences: { session_duration_minutes: 30, encouragements_enabled: true, learning_mode: 'fast', volume: 1 },
  platform_role: 'ssi_admin',
  educational_role: 'teacher',
}

const liveSession = {
  user: { id: 'auth-uid-1', email: 'tom@example.com' },
  access_token: 'access',
  refresh_token: 'refresh',
}

function queryBuilder(result: any) {
  const b: any = {}
  for (const m of ['select', 'eq', 'update', 'insert', 'upsert', 'delete', 'single', 'maybeSingle', 'order', 'limit', 'in', 'is']) {
    b[m] = () => b
  }
  b.then = (resolve: (v: any) => void) => Promise.resolve(result).then(resolve)
  return b
}

function makeClient(overrides: Record<string, any> = {}, row: any = learnerRow) {
  return {
    from: () => queryBuilder({ data: row, error: null }),
    rpc: async () => ({ data: [], error: null }),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn(async () => ({ data: { session: null } })),
      getUser: vi.fn(async () => ({ data: { user: liveSession.user }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      refreshSession: vi.fn(async () => ({ data: { session: null }, error: { message: 'no' } })),
      ...overrides,
    },
  } as any
}

async function flush(times = 8) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0))
}

/** Boot once against a healthy network so an identity is remembered. */
async function bootSignedIn() {
  const client = makeClient({ getSession: vi.fn(async () => ({ data: { session: liveSession } })) })
  const auth = useAuth()
  await auth.initialize(client)
  await flush()
  return auth
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  useResolvedSession().reset()
  useUserRole().clear()
  vi.useRealTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('a confirmed session is remembered', () => {
  it('writes the learner row, auth uid, email and roles after a live boot', async () => {
    await bootSignedIn()

    const remembered = readLastKnownIdentity()
    expect(remembered).not.toBeNull()
    expect(remembered!.learner.id).toBe(learnerRow.id)
    expect(remembered!.learner.display_name).toBe('Tom')
    expect(remembered!.authUserId).toBe('auth-uid-1')
    expect(remembered!.email).toBe('tom@example.com')
    expect(remembered!.platformRole).toBe('ssi_admin')
    expect(remembered!.educationalRole).toBe('teacher')
  })
})

describe('offline: the session check cannot complete', () => {
  it('keeps the learner signed in when getSession never resolves (the airplane-mode path)', async () => {
    await bootSignedIn()
    // supabase-js still holds the stored session it cannot refresh.
    localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(liveSession))
    useResolvedSession().reset()

    // A getSession() that never settles is exactly what the 5s race was for.
    const client = makeClient({ getSession: vi.fn(() => new Promise(() => {})) })
    const auth = useAuth()

    vi.useFakeTimers()
    const booting = auth.initialize(client)
    await vi.advanceTimersByTimeAsync(6000)
    await booting
    vi.useRealTimers()

    expect(auth.isAuthenticated.value).toBe(true)
    expect(auth.isGuest.value).toBe(false)
    expect(auth.identityUnverified.value).toBe(true)
    // The condition LearningPlayer's isGuestLearner and every progress write
    // are keyed on: a real learners.id, never a 'guest-' string.
    expect(auth.learnerId.value).toBe(learnerRow.id)
    expect(auth.learnerId.value?.startsWith('guest-')).toBe(false)
    expect(auth.userId.value).toBe('auth-uid-1')
    expect(useResolvedSession().status.value).toBe('authenticated')
  })

  it('keeps the learner signed in when the session check throws', async () => {
    await bootSignedIn()
    localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(liveSession))
    useResolvedSession().reset()

    const client = makeClient({
      getSession: vi.fn(async () => { throw new Error('Failed to fetch') },
      ),
    })
    const auth = useAuth()
    await auth.initialize(client)
    await flush()

    expect(auth.isAuthenticated.value).toBe(true)
    expect(auth.learnerId.value).toBe(learnerRow.id)
    expect(auth.identityUnverified.value).toBe(true)
    expect(useResolvedSession().status.value).toBe('authenticated')
  })

  it('keeps the learner signed in when a stored token is present but no session comes back', async () => {
    // supabase-js answers "no session" when an offline refresh fails, while
    // leaving the stored token in place — indistinguishable from a real
    // sign-out unless you look at storage.
    await bootSignedIn()
    localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(liveSession))
    useResolvedSession().reset()

    const auth = useAuth()
    await auth.initialize(makeClient())
    await flush()

    expect(auth.isAuthenticated.value).toBe(true)
    expect(auth.learnerId.value).toBe(learnerRow.id)
    expect(auth.identityUnverified.value).toBe(true)
  })

  it('restores the roles with the identity, so whenResolved() does not hang', async () => {
    await bootSignedIn()
    localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(liveSession))
    useResolvedSession().reset()
    useUserRole().clear()

    const auth = useAuth()
    await auth.initialize(makeClient({ getSession: vi.fn(async () => { throw new Error('offline') }) }))
    await flush()

    expect(useUserRole().platformRole.value).toBe('ssi_admin')
    expect(useResolvedSession().isResolved.value).toBe(true)
    await expect(useResolvedSession().whenResolved()).resolves.toBeUndefined()
  })

  it('marks the identity verified again once a live session confirms it', async () => {
    await bootSignedIn()
    useResolvedSession().reset()

    const auth = useAuth()
    await auth.initialize(makeClient({ getSession: vi.fn(async () => ({ data: { session: liveSession } })) }))
    await flush()

    expect(auth.identityUnverified.value).toBe(false)
    expect(auth.learnerId.value).toBe(learnerRow.id)
  })
})

describe('a genuinely signed-out learner still sees the guest prompt', () => {
  it('resolves guest when there is no session and nothing remembered', async () => {
    const auth = useAuth()
    await auth.initialize(makeClient())
    await flush()

    expect(auth.isAuthenticated.value).toBe(false)
    expect(auth.isGuest.value).toBe(true)
    expect(auth.learnerId.value?.startsWith('guest-')).toBe(true)
    expect(useResolvedSession().status.value).toBe('guest')
  })

  it('drops a remembered identity when the answer is a definitive no-session', async () => {
    await bootSignedIn()
    useResolvedSession().reset()
    // No stored supabase token: nothing to refresh, so "no session" is an
    // answer rather than a failure to ask.
    const auth = useAuth()
    await auth.initialize(makeClient())
    await flush()

    expect(auth.isAuthenticated.value).toBe(false)
    expect(auth.learnerId.value?.startsWith('guest-')).toBe(true)
    expect(readLastKnownIdentity()).toBeNull()
    expect(useResolvedSession().status.value).toBe('guest')
  })
})

describe('sign-out destroys the remembered identity', () => {
  it('clears it on signOut(), so the next offline boot is a guest', async () => {
    const auth = await bootSignedIn()
    localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify(liveSession))

    await auth.signOut()

    expect(readLastKnownIdentity()).toBeNull()
    expect(auth.isAuthenticated.value).toBe(false)
    expect(auth.identityUnverified.value).toBe(false)

    // And a fresh boot with no network does NOT resurrect them.
    useResolvedSession().reset()
    const next = useAuth()
    await next.initialize(makeClient({ getSession: vi.fn(async () => { throw new Error('offline') }) }))
    await flush()

    expect(next.isAuthenticated.value).toBe(false)
    expect(next.learnerId.value?.startsWith('guest-')).toBe(true)
  })

  it('clears it when a revoked session is torn down (a revoked session IS a sign-out)', async () => {
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

    expect(readLastKnownIdentity()).toBeNull()
    expect(auth.isAuthenticated.value).toBe(false)
  })
})
