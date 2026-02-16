/**
 * Tests for WI-4: Schools Data Integration
 *
 * Verifies useSchoolsData Supabase queries, join code logic,
 * and dev school creation with mock Supabase client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useSchoolsData } from './useSchoolsData'

// ============================================================================
// Mock Supabase builder
// ============================================================================

function createMockSupabase() {
  // Chainable query builder
  const builder: any = {
    _resolveValue: { data: null, error: null } as any,
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn(function (this: any) { return Promise.resolve(this._resolveValue) }),
    maybeSingle: vi.fn(function (this: any) { return Promise.resolve(this._resolveValue) }),
  }

  // By default, select/insert/etc resolve automatically for array queries
  // Override per-test with mockResolveValue
  const mockResolve = (value: { data: any; error: any }) => {
    builder._resolveValue = value
    // Make order/is/in/eq return the value directly for terminal calls
    builder.order.mockImplementation(() => Promise.resolve(value))
    builder.is.mockImplementation(() => Promise.resolve(value))
  }

  return { builder, mockResolve }
}

describe('useSchoolsData', () => {
  let mock: ReturnType<typeof createMockSupabase>
  let supabaseRef: ReturnType<typeof ref>

  beforeEach(() => {
    vi.clearAllMocks()
    mock = createMockSupabase()
    supabaseRef = ref(mock.builder)
  })

  describe('getSchoolForUser', () => {
    it('returns school when found', async () => {
      const school = {
        id: 'school-1',
        school_name: 'Test School',
        admin_user_id: 'user-1',
        region_code: null,
        teacher_join_code: 'ABC-123',
        created_at: '2026-01-01',
      }
      mock.builder.maybeSingle.mockResolvedValue({ data: school, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getSchoolForUser('user-1')

      expect(result).toEqual(school)
      expect(mock.builder.from).toHaveBeenCalledWith('schools')
      expect(mock.builder.eq).toHaveBeenCalledWith('admin_user_id', 'user-1')
    })

    it('returns null when not found', async () => {
      mock.builder.maybeSingle.mockResolvedValue({ data: null, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getSchoolForUser('user-99')

      expect(result).toBeNull()
    })

    it('returns null when no supabase client', async () => {
      const sd = useSchoolsData(ref(null) as any)
      const result = await sd.getSchoolForUser('user-1')

      expect(result).toBeNull()
    })
  })

  describe('getSchoolSummary', () => {
    it('returns summary from reporting view', async () => {
      const summary = {
        school_id: 'school-1',
        school_name: 'Test School',
        teacher_count: 3,
        class_count: 5,
        student_count: 42,
        total_practice_hours: 120,
      }
      mock.builder.maybeSingle.mockResolvedValue({ data: summary, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getSchoolSummary('school-1')

      expect(result).toEqual(summary)
      expect(mock.builder.from).toHaveBeenCalledWith('school_summary')
    })
  })

  describe('getClasses', () => {
    it('queries classes for school with active filter', async () => {
      const classes = [
        { id: 'c1', class_name: 'Year 7', school_id: 'school-1', is_active: true },
        { id: 'c2', class_name: 'Year 8', school_id: 'school-1', is_active: true },
      ]
      // order() is the terminal call for getClasses
      mock.builder.order.mockResolvedValue({ data: classes, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getClasses('school-1')

      expect(result).toEqual(classes)
      expect(mock.builder.from).toHaveBeenCalledWith('classes')
      expect(mock.builder.eq).toHaveBeenCalledWith('school_id', 'school-1')
      expect(mock.builder.eq).toHaveBeenCalledWith('is_active', true)
    })

    it('returns empty array on error', async () => {
      mock.builder.order.mockResolvedValue({ data: null, error: { message: 'fail' } })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getClasses('school-1')

      expect(result).toEqual([])
    })
  })

  describe('getClassDetail', () => {
    it('returns single class', async () => {
      const cls = { id: 'c1', class_name: 'Year 7', school_id: 'school-1' }
      mock.builder.maybeSingle.mockResolvedValue({ data: cls, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getClassDetail('c1')

      expect(result).toEqual(cls)
      expect(mock.builder.eq).toHaveBeenCalledWith('id', 'c1')
    })
  })

  describe('getClassStudentProgress', () => {
    it('queries the reporting view', async () => {
      const progress = [
        { student_user_id: 's1', student_name: 'Aled', seeds_completed: 45 },
      ]
      mock.builder.eq.mockResolvedValue({ data: progress, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getClassStudentProgress('c1')

      expect(result).toEqual(progress)
      expect(mock.builder.from).toHaveBeenCalledWith('class_student_progress')
    })
  })

  describe('createClass', () => {
    it('inserts class with generated join code', async () => {
      const newClass = { id: 'c-new', class_name: 'Year 9', student_join_code: 'XYZ-123' }
      mock.builder.single.mockResolvedValue({ data: newClass, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.createClass('school-1', 'teacher-1', 'Year 9', 'cym_for_eng')

      expect(result).toEqual(newClass)
      expect(mock.builder.from).toHaveBeenCalledWith('classes')
      expect(mock.builder.insert).toHaveBeenCalled()

      // Verify insert payload has the right fields
      const insertArg = mock.builder.insert.mock.calls[0][0]
      expect(insertArg.school_id).toBe('school-1')
      expect(insertArg.teacher_user_id).toBe('teacher-1')
      expect(insertArg.class_name).toBe('Year 9')
      expect(insertArg.course_code).toBe('cym_for_eng')
      expect(insertArg.student_join_code).toMatch(/^[A-Z]{3}-\d{3}$/)
    })

    it('returns null on error', async () => {
      mock.builder.single.mockResolvedValue({ data: null, error: { message: 'conflict' } })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.createClass('school-1', 'teacher-1', 'Year 9', 'cym_for_eng')

      expect(result).toBeNull()
    })
  })

  describe('joinWithCode', () => {
    it('joins a class with student code', async () => {
      // First maybeSingle: class lookup
      mock.builder.maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'c1', class_name: 'Year 7', school_id: 'school-1' },
          error: null,
        })

      // Insert user_tag succeeds
      mock.builder.insert.mockResolvedValueOnce({ error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.joinWithCode('ABC-123', 'student-001')

      expect(result.success).toBe(true)
      expect(result.message).toBe('Joined class')
      expect(result.class_name).toBe('Year 7')
    })

    it('joins as teacher with school code', async () => {
      // First maybeSingle: class lookup — not found
      mock.builder.maybeSingle
        .mockResolvedValueOnce({ data: null, error: null })

      // Second maybeSingle: school lookup — found
      mock.builder.maybeSingle
        .mockResolvedValueOnce({
          data: { id: 'school-1', school_name: 'Ysgol Test' },
          error: null,
        })

      // Insert user_tag succeeds
      mock.builder.insert.mockResolvedValueOnce({ error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.joinWithCode('TEACH-CODE', 'teacher-002')

      expect(result.success).toBe(true)
      expect(result.message).toContain('Ysgol Test')
    })

    it('returns invalid code message when neither match', async () => {
      mock.builder.maybeSingle
        .mockResolvedValueOnce({ data: null, error: null }) // No class
        .mockResolvedValueOnce({ data: null, error: null }) // No school

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.joinWithCode('BAD-CODE', 'user-1')

      expect(result.success).toBe(false)
      expect(result.message).toBe('Invalid code')
    })

    it('returns error when no supabase client', async () => {
      const sd = useSchoolsData(ref(null) as any)
      const result = await sd.joinWithCode('ABC-123', 'user-1')

      expect(result.success).toBe(false)
      expect(result.message).toBe('No database connection')
    })
  })

  describe('getTeachers', () => {
    it('queries user_tags with school tag', async () => {
      const tags = [
        { user_id: 'teacher-001', role_in_context: 'teacher', added_at: '2026-01-01' },
      ]
      // is() is the terminal call (after .is('removed_at', null))
      mock.builder.is.mockResolvedValue({ data: tags, error: null })

      const sd = useSchoolsData(supabaseRef as any)
      const result = await sd.getTeachers('school-1')

      expect(result).toHaveLength(1)
      expect(result[0].user_id).toBe('teacher-001')
      expect(mock.builder.eq).toHaveBeenCalledWith('tag_type', 'school')
      expect(mock.builder.eq).toHaveBeenCalledWith('tag_value', 'SCHOOL:school-1')
    })
  })
})
