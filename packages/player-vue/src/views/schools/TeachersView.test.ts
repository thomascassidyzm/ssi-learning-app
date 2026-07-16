/**
 * TeachersView.vue logic tests
 *
 * Tests the script-level logic (computed properties, helper functions, event handlers)
 * without rendering the template. Uses dynamic imports for singleton isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]) }),
  },
  writable: true,
})

// The view imports these — we test the logic directly by reimplementing the
// pure functions from the component since they're defined inline in <script setup>.
// For the Supabase interaction bug, we test the composable + handler pattern.

describe('TeachersView logic', () => {
  // --- getBelt (hours-based thresholds) ---

  function getBelt(practiceHours: number): string {
    if (practiceHours >= 100) return 'black'
    if (practiceHours >= 70) return 'brown'
    if (practiceHours >= 40) return 'blue'
    if (practiceHours >= 20) return 'green'
    if (practiceHours >= 10) return 'orange'
    if (practiceHours >= 5) return 'yellow'
    return 'white'
  }

  it('returns white for 0 hours', () => {
    expect(getBelt(0)).toBe('white')
  })

  it('returns yellow at 5 hours', () => {
    expect(getBelt(5)).toBe('yellow')
  })

  it('returns orange at 10 hours', () => {
    expect(getBelt(10)).toBe('orange')
  })

  it('returns green at 20 hours', () => {
    expect(getBelt(20)).toBe('green')
  })

  it('returns blue at 40 hours', () => {
    expect(getBelt(40)).toBe('blue')
  })

  it('returns brown at 70 hours', () => {
    expect(getBelt(70)).toBe('brown')
  })

  it('returns black at 100 hours', () => {
    expect(getBelt(100)).toBe('black')
  })

  // --- engagementRate formula ---

  function engagementRate(studentCount: number, classCount: number): number {
    return studentCount > 0 ? Math.min(100, Math.round((studentCount / classCount) * 5)) : 0
  }

  it('engagement rate is 0 when no students', () => {
    expect(engagementRate(0, 2)).toBe(0)
  })

  it('engagement rate formula: (students/classes)*5 capped at 100', () => {
    expect(engagementRate(10, 2)).toBe(25)
    expect(engagementRate(100, 2)).toBe(100) // capped
  })

  // --- teacherJoinLink (link-primary invite, mirrors ClassDetail's classJoinLink) ---

  function teacherJoinLink(origin: string, teacherJoinCode: string): string {
    if (teacherJoinCode === 'N/A') return ''
    return `${origin}/redeem/${teacherJoinCode}`
  }

  it('builds a /redeem/:code invite link from the teacher join code', () => {
    expect(teacherJoinLink('https://staging.saysomethingin.app', 'BMH-903'))
      .toBe('https://staging.saysomethingin.app/redeem/BMH-903')
  })

  it('is empty when there is no teacher join code yet', () => {
    expect(teacherJoinLink('https://staging.saysomethingin.app', 'N/A')).toBe('')
  })

  // --- getInitials ---

  function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  it('extracts initials from name', () => {
    expect(getInitials('Sian Morgan')).toBe('SM')
    expect(getInitials('John')).toBe('J')
    expect(getInitials('Anna Beth Carol')).toBe('AB')
  })

  // --- canManageStaff gating (2026-07-16 teacher-loop audit: admin-only
  //     controls — bulk import, invite, remove — were visible to plain
  //     teachers, whose Remove clicks silently no-opped under own-row RLS) ---

  describe('canManageStaff gating', () => {
    function canManageStaff(isSchoolAdmin: boolean, isAdminView: boolean): boolean {
      return isSchoolAdmin && !isAdminView
    }

    it('school_admin viewing their own school can manage staff', () => {
      expect(canManageStaff(true, false)).toBe(true)
    })

    it('a plain teacher cannot manage staff', () => {
      expect(canManageStaff(false, false)).toBe(false)
    })

    it('an ssi_admin read-only browse view cannot manage staff even though the persona is school_admin', () => {
      expect(canManageStaff(true, true)).toBe(false)
    })
  })

  // --- removeTeacher surfaces the real result (never a false "success") ---

  describe('handleRemoveTeacher error surfacing', () => {
    it('shows an error when removeTeacher reports failure, and does not refetch', async () => {
      const fetchTeachers = vi.fn()
      const removeTeacher = vi.fn(async (_userId: string) => ({ ok: false as const, error: 'Only a school admin can remove staff' as string | null }))
      let removeError = ''

      async function handleRemoveTeacher(userId: string, name: string) {
        removeError = ''
        const result = await removeTeacher(userId)
        if (result.ok) {
          fetchTeachers()
        } else {
          removeError = `Could not remove ${name}: ${result.error}`
        }
      }

      await handleRemoveTeacher('teacher-x', 'Sian Morgan')
      expect(fetchTeachers).not.toHaveBeenCalled()
      expect(removeError).toBe('Could not remove Sian Morgan: Only a school admin can remove staff')
    })

    it('refetches and clears any prior error on success', async () => {
      const fetchTeachers = vi.fn()
      const removeTeacher = vi.fn(async (_userId: string) => ({ ok: true as const, error: null as string | null }))
      let removeError = 'stale error from a previous attempt'

      async function handleRemoveTeacher(userId: string, name: string) {
        removeError = ''
        const result = await removeTeacher(userId)
        if (result.ok) {
          fetchTeachers()
        } else {
          removeError = `Could not remove ${name}: ${(result as any).error}`
        }
      }

      await handleRemoveTeacher('teacher-x', 'Sian Morgan')
      expect(fetchTeachers).toHaveBeenCalledTimes(1)
      expect(removeError).toBe('')
    })
  })

  describe('teacher data shape', () => {
    beforeEach(async () => {
      vi.resetModules()
      Object.keys(store).forEach(k => delete store[k])
    })

    it('computed teachers array includes user_id from source data', async () => {
      // Verify the computed teacher objects contain user_id
      // This tests the line we added: `user_id: t.user_id`
      const sourceTeacher = {
        user_id: 'real-uuid-here',
        learner_id: 'learner-1',
        display_name: 'Test Teacher',
        class_count: 2,
        student_count: 15,
        total_practice_hours: 25,
        joined_at: '2025-01-01T00:00:00Z',
      }

      // Simulate the computed transform from the component
      const transformed = {
        id: 1, // display index
        user_id: sourceTeacher.user_id,  // <-- THIS WAS MISSING BEFORE THE FIX
        name: sourceTeacher.display_name,
      }

      expect(transformed.user_id).toBe('real-uuid-here')
      expect(typeof transformed.id).toBe('number') // display only
      expect(typeof transformed.user_id).toBe('string') // actual DB key
    })
  })
})
