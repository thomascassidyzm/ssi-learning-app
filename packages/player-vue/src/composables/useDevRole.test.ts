/**
 * Tests for WI-2: God Mode Upgrade
 *
 * Verifies useDevRole tier management, seed override, and persona application.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

// Mock localStorage before importing the module
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value }),
  removeItem: vi.fn((key: string) => { delete store[key] }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
}
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

// Import after localStorage mock is in place
import { useDevRole, PERSONAS, type DevTier } from './useDevRole'

describe('useDevRole', () => {
  beforeEach(async () => {
    // Reset module-level singleton state before clearing localStorage
    const { setRole, setTier, clearSeedOverride } = useDevRole()
    setRole('school_admin')
    setTier('free')
    clearSeedOverride()
    await nextTick() // Let watchers flush before clearing store
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  describe('role management (existing)', () => {
    it('defaults to school_admin', () => {
      const { currentRole } = useDevRole()
      expect(currentRole.value).toBe('school_admin')
    })

    it('setRole updates role', () => {
      const { currentRole, setRole } = useDevRole()
      setRole('teacher')
      expect(currentRole.value).toBe('teacher')
    })

    it('currentUser reflects current role', () => {
      const { currentUser, setRole } = useDevRole()
      setRole('student')
      expect(currentUser.value.role).toBe('student')
      expect(currentUser.value.name).toBe('Gareth Llywelyn')
    })
  })

  describe('tier management (WI-2)', () => {
    it('defaults to free tier', () => {
      const { currentTier } = useDevRole()
      expect(currentTier.value).toBe('free')
    })

    it('setTier updates tier', () => {
      const { currentTier, setTier } = useDevRole()
      setTier('paid')
      expect(currentTier.value).toBe('paid')
    })

    it('setTier syncs ssi-dev-paid-user flag', async () => {
      const { setTier } = useDevRole()

      setTier('paid')
      await nextTick()
      expect(store['ssi-dev-paid-user']).toBe('true')

      setTier('free')
      await nextTick()
      expect(store['ssi-dev-paid-user']).toBe('false')

      setTier('community')
      await nextTick()
      expect(store['ssi-dev-paid-user']).toBe('false')
    })
  })

  describe('seed override (WI-2)', () => {
    it('defaults to null', () => {
      const { devSeedOverride } = useDevRole()
      expect(devSeedOverride.value).toBeNull()
    })

    it('setSeedOverride stores value', async () => {
      const { devSeedOverride, setSeedOverride } = useDevRole()
      setSeedOverride(60)
      await nextTick()
      expect(devSeedOverride.value).toBe(60)
      expect(store['ssi-dev-seed-override']).toBe('60')
    })

    it('clearSeedOverride removes value', () => {
      const { devSeedOverride, setSeedOverride, clearSeedOverride } = useDevRole()
      setSeedOverride(60)
      clearSeedOverride()
      expect(devSeedOverride.value).toBeNull()
    })
  })

  describe('personas (WI-2)', () => {
    it('has 6 personas defined', () => {
      expect(PERSONAS).toHaveLength(6)
    })

    it('applyPersona sets role, tier, and seed override', () => {
      const { currentRole, currentTier, devSeedOverride, applyPersona } = useDevRole()

      const greenBeltPaid = PERSONAS.find(p => p.name === 'Green Belt Paid')!
      applyPersona(greenBeltPaid)

      expect(currentRole.value).toBe('student')
      expect(currentTier.value).toBe('paid')
      expect(devSeedOverride.value).toBe(60)
    })

    it('applyPersona with null seed clears override', () => {
      const { devSeedOverride, applyPersona, setSeedOverride } = useDevRole()

      // First set a seed
      setSeedOverride(200)
      expect(devSeedOverride.value).toBe(200)

      // Apply persona with no seed
      const teacher = PERSONAS.find(p => p.name === 'Teacher')!
      applyPersona(teacher)

      expect(devSeedOverride.value).toBeNull()
    })

    it('all personas have valid role and tier values', () => {
      const validRoles = ['school_admin', 'teacher', 'student']
      const validTiers: DevTier[] = ['free', 'paid', 'community']

      for (const persona of PERSONAS) {
        expect(validRoles).toContain(persona.role)
        expect(validTiers).toContain(persona.tier)
        if (persona.seedOverride !== null) {
          expect(persona.seedOverride).toBeGreaterThan(0)
          expect(persona.seedOverride).toBeLessThanOrEqual(668)
        }
      }
    })
  })

  describe('permission checks', () => {
    it('canAccessDashboard for admin and teacher only', () => {
      const { canAccessDashboard, setRole } = useDevRole()

      setRole('school_admin')
      expect(canAccessDashboard.value).toBe(true)

      setRole('teacher')
      expect(canAccessDashboard.value).toBe(true)

      setRole('student')
      expect(canAccessDashboard.value).toBe(false)
    })
  })
})
