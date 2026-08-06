import { describe, it, expect, beforeEach, vi } from 'vitest'

// The staging bug this covers (Deborah, 2026-08-06): an organisation leader
// carries educational_role = 'govt_admin', which hasSchoolRole admits — so
// the app offered her a Schools Dashboard and no Organisation Dashboard at
// all. Detection has to come from the group her own govt_admins row points
// at, not from the role string.

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => null,
    getAuthToken: async () => 'test-token',
  }),
}))

import { useOrgLeadership, __orgLeadershipInternals } from './useOrgLeadership'

type Payloads = { org?: unknown; teaching?: unknown }

function mockFetch({ org, teaching }: Payloads): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/org/subscription')) {
        return { json: async () => org ?? { org: null } } as unknown as Response
      }
      if (String(url).includes('/api/me/teaching-context')) {
        return { json: async () => teaching ?? { groups: [], classes: [] } } as unknown as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
  )
}

describe('useOrgLeadership', () => {
  beforeEach(() => {
    __orgLeadershipInternals.reset()
    vi.unstubAllGlobals()
  })

  it('detects an organisation leader with no school side — org door only', async () => {
    mockFetch({
      org: { org: { id: 'org-1', name: 'Deborah Testing', type: 'organisation' } },
      teaching: { groups: [{ id: 'org-1', label: 'group' }], classes: [] },
    })
    const { leadsOrg, orgOnly, orgDashboardPath, ensureLoaded } = useOrgLeadership()
    await ensureLoaded()

    expect(leadsOrg.value).toBe(true)
    expect(orgOnly.value).toBe(true)
    expect(orgDashboardPath.value).toBe('/org/org-1')
  })

  it('keeps BOTH doors for a leader who also has a school affiliation', async () => {
    mockFetch({
      org: { org: { id: 'org-2', name: 'Both', type: 'organisation' } },
      teaching: { groups: [{ id: 's-1', label: 'school' }], classes: [] },
    })
    const { leadsOrg, orgOnly, ensureLoaded } = useOrgLeadership()
    await ensureLoaded()

    expect(leadsOrg.value).toBe(true)
    expect(orgOnly.value).toBe(false)
  })

  it('a teacher who taught classes but leads an org keeps both doors', async () => {
    mockFetch({
      org: { org: { id: 'org-3', name: 'Teacher-led', type: 'organisation' } },
      teaching: { groups: [], classes: ['c-1'] },
    })
    const { orgOnly, ensureLoaded } = useOrgLeadership()
    await ensureLoaded()
    expect(orgOnly.value).toBe(false)
  })

  it('a government/schools admin (region node) is NOT an org leader', async () => {
    mockFetch({ org: { org: { id: 'reg-1', name: 'Pilot Districts Region', type: 'region' } } })
    const { leadsOrg, orgOnly, ensureLoaded } = useOrgLeadership()
    await ensureLoaded()

    expect(leadsOrg.value).toBe(false)
    expect(orgOnly.value).toBe(false) // Schools Dashboard stays exactly as it was
  })

  it('leads nothing → no org door, and the school lane is untouched', async () => {
    mockFetch({ org: { org: null, reason: 'no-org' } })
    const { leadsOrg, orgOnly, orgDashboardPath, isLoaded, ensureLoaded } = useOrgLeadership()
    await ensureLoaded()

    expect(leadsOrg.value).toBe(false)
    expect(orgOnly.value).toBe(false)
    expect(orgDashboardPath.value).toBe(null)
    expect(isLoaded.value).toBe(true)
  })

  it('fails open: a broken subscription read leaves the pre-fix behaviour', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    const { leadsOrg, orgOnly, isLoaded, ensureLoaded } = useOrgLeadership()
    await ensureLoaded()

    expect(leadsOrg.value).toBe(false)
    expect(orgOnly.value).toBe(false)
    expect(isLoaded.value).toBe(true)
  })

  it('fetches once and shares the answer across callers', async () => {
    mockFetch({ org: { org: { id: 'org-1', name: 'Once', type: 'organisation' } } })
    const a = useOrgLeadership()
    const b = useOrgLeadership()
    await Promise.all([a.ensureLoaded(), b.ensureLoaded()])
    await a.ensureLoaded()

    // one /api/org/subscription + one /api/me/teaching-context, no repeats
    expect((globalThis.fetch as any).mock.calls.length).toBe(2)
    expect(b.leadsOrg.value).toBe(true)
  })
})
