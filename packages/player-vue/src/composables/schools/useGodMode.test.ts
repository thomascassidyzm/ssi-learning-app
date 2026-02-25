import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GodModeUser } from './useGodMode'

// Mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true })

/** Chainable Supabase mock that dispatches different responses per table */
function createMockClient(responses: Record<string, { data: any; error: any }>) {
  const chain: any = {}
  const methods = ['select', 'eq', 'not', 'is', 'in', 'order', 'limit', 'single', 'gte', 'insert', 'update', 'delete']
  let currentTable = ''

  const buildChain = () => {
    methods.forEach(m => {
      chain[m] = vi.fn(() => {
        if (m === 'single' || (m === 'select' && !['from'].includes(m))) {
          // Terminal-ish methods just keep chaining
        }
        // When a terminal call happens, resolve
        return new Proxy(chain, {
          get(target, prop) {
            if (prop === 'then') {
              const resp = responses[currentTable] || { data: [], error: null }
              return (resolve: any) => resolve(resp)
            }
            return target[prop as string]
          }
        })
      })
    })
    return chain
  }

  buildChain()

  return {
    from: vi.fn((table: string) => {
      currentTable = table
      return chain
    })
  } as any
}

describe('useGodMode', () => {
  beforeEach(async () => {
    vi.resetModules()
    localStorageMock.clear()
    Object.keys(store).forEach(k => delete store[k])
  })

  async function setup(clientResponses: Record<string, { data: any; error: any }> = {}) {
    const clientModule = await import('./client')
    clientModule.setSchoolsClient(createMockClient(clientResponses))
    const { useGodMode } = await import('./useGodMode')
    return useGodMode()
  }

  // --- Role computeds ---

  it('currentRole is null when no user selected', async () => {
    const gm = await setup()
    expect(gm.currentRole.value).toBeNull()
  })

  it('sets role computeds for govt_admin', async () => {
    const gm = await setup()
    const user: GodModeUser = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Admin',
      educational_role: 'govt_admin', platform_role: null,
      region_code: 'WALES'
    }
    gm.selectUser(user)
    expect(gm.currentRole.value).toBe('govt_admin')
    expect(gm.isGovtAdmin.value).toBe(true)
    expect(gm.isSchoolAdmin.value).toBe(false)
    expect(gm.isTeacher.value).toBe(false)
    expect(gm.canViewRegion.value).toBe(true)
    expect(gm.canAccessDashboard.value).toBe(true)
  })

  it('sets role computeds for school_admin', async () => {
    const gm = await setup()
    gm.selectUser({
      user_id: 'u2', learner_id: 'l2', display_name: 'SchoolAdmin',
      educational_role: 'school_admin', platform_role: null, school_id: 's1'
    })
    expect(gm.isSchoolAdmin.value).toBe(true)
    expect(gm.canManageTeachers.value).toBe(true)
    expect(gm.canViewSchoolAnalytics.value).toBe(true)
    expect(gm.canViewRegion.value).toBe(false)
  })

  it('sets role computeds for teacher', async () => {
    const gm = await setup()
    gm.selectUser({
      user_id: 'u3', learner_id: 'l3', display_name: 'Teacher',
      educational_role: 'teacher', platform_role: null
    })
    expect(gm.isTeacher.value).toBe(true)
    expect(gm.canAccessDashboard.value).toBe(true)
    expect(gm.canManageTeachers.value).toBe(false)
  })

  it('sets role computeds for student (no dashboard access)', async () => {
    const gm = await setup()
    gm.selectUser({
      user_id: 'u4', learner_id: 'l4', display_name: 'Student',
      educational_role: 'student', platform_role: null
    })
    expect(gm.isStudent.value).toBe(true)
    expect(gm.canAccessDashboard.value).toBe(false)
  })

  it('detects ssi_admin platform role', async () => {
    const gm = await setup()
    gm.selectUser({
      user_id: 'u5', learner_id: 'l5', display_name: 'SuperAdmin',
      educational_role: 'govt_admin', platform_role: 'ssi_admin'
    })
    expect(gm.isSsiAdmin.value).toBe(true)
  })

  // --- searchUsers ---

  it('searchUsers filters by query', async () => {
    const gm = await setup()
    gm.allUsers.value = [
      { user_id: 'u1', learner_id: 'l1', display_name: 'Alice', educational_role: 'teacher', platform_role: null },
      { user_id: 'u2', learner_id: 'l2', display_name: 'Bob', educational_role: 'teacher', platform_role: null },
    ]
    const results = gm.searchUsers('ali')
    expect(results).toHaveLength(1)
    expect(results[0].display_name).toBe('Alice')
  })

  it('searchUsers filters by role', async () => {
    const gm = await setup()
    gm.allUsers.value = [
      { user_id: 'u1', learner_id: 'l1', display_name: 'Alice', educational_role: 'teacher', platform_role: null },
      { user_id: 'u2', learner_id: 'l2', display_name: 'Bob', educational_role: 'school_admin', platform_role: null },
    ]
    const results = gm.searchUsers('', 'school_admin')
    expect(results).toHaveLength(1)
    expect(results[0].display_name).toBe('Bob')
  })

  it('searchUsers filters by school_name', async () => {
    const gm = await setup()
    gm.allUsers.value = [
      { user_id: 'u1', learner_id: 'l1', display_name: 'Alice', educational_role: 'teacher', platform_role: null, school_name: 'Ysgol Gymraeg' },
    ]
    const results = gm.searchUsers('ysgol')
    expect(results).toHaveLength(1)
  })

  it('searchUsers combined query + role filter', async () => {
    const gm = await setup()
    gm.allUsers.value = [
      { user_id: 'u1', learner_id: 'l1', display_name: 'Alice', educational_role: 'teacher', platform_role: null },
      { user_id: 'u2', learner_id: 'l2', display_name: 'Alice Admin', educational_role: 'school_admin', platform_role: null },
    ]
    const results = gm.searchUsers('alice', 'teacher')
    expect(results).toHaveLength(1)
    expect(results[0].educational_role).toBe('teacher')
  })

  // --- usersByRole ---

  it('groups users by role', async () => {
    const gm = await setup()
    gm.allUsers.value = [
      { user_id: 'u1', learner_id: 'l1', display_name: 'A', educational_role: 'teacher', platform_role: null },
      { user_id: 'u2', learner_id: 'l2', display_name: 'B', educational_role: 'teacher', platform_role: null },
      { user_id: 'u3', learner_id: 'l3', display_name: 'C', educational_role: 'student', platform_role: null },
    ]
    expect(gm.usersByRole.value.teacher).toHaveLength(2)
    expect(gm.usersByRole.value.student).toHaveLength(1)
    expect(gm.usersByRole.value.govt_admin).toHaveLength(0)
  })

  // --- localStorage persistence ---

  it('persists selected user to localStorage', async () => {
    const gm = await setup()
    const user: GodModeUser = {
      user_id: 'u1', learner_id: 'l1', display_name: 'Test',
      educational_role: 'teacher', platform_role: null
    }
    gm.selectUser(user)
    // Vue watchers are sync in test env
    await new Promise(r => setTimeout(r, 0))
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ssi-god-mode-user',
      expect.stringContaining('u1')
    )
  })

  it('clearSelection removes user', async () => {
    const gm = await setup()
    gm.selectUser({
      user_id: 'u1', learner_id: 'l1', display_name: 'Test',
      educational_role: 'teacher', platform_role: null
    })
    gm.clearSelection()
    expect(gm.selectedUser.value).toBeNull()
  })

  // --- fetchUsers enrichment ---

  it('enriches govt_admin with region context', async () => {
    const gm = await setup({
      learners: { data: [{ id: 'l1', user_id: 'u1', display_name: 'Gov', educational_role: 'govt_admin', platform_role: null }], error: null },
      schools: { data: [], error: null },
      govt_admins: { data: [{ user_id: 'u1', region_code: 'WALES', organization_name: 'Welsh Gov' }], error: null },
      user_tags: { data: [], error: null },
      classes: { data: [], error: null },
    })
    await gm.fetchUsers()
    expect(gm.allUsers.value[0].region_code).toBe('WALES')
    expect(gm.allUsers.value[0].organization_name).toBe('Welsh Gov')
  })

  it('enriches school_admin with school context', async () => {
    const gm = await setup({
      learners: { data: [{ id: 'l2', user_id: 'u2', display_name: 'Admin', educational_role: 'school_admin', platform_role: null }], error: null },
      schools: { data: [{ id: 's1', admin_user_id: 'u2', school_name: 'Ysgol', region_code: 'WALES' }], error: null },
      govt_admins: { data: [], error: null },
      user_tags: { data: [], error: null },
      classes: { data: [], error: null },
    })
    await gm.fetchUsers()
    expect(gm.allUsers.value[0].school_id).toBe('s1')
    expect(gm.allUsers.value[0].school_name).toBe('Ysgol')
  })
})
