/**
 * useSchoolsData - Supabase data layer for the schools dashboard
 *
 * Queries schools, classes, user_tags, and reporting views.
 * God mode RLS policies allow anon to SELECT all school tables.
 * Includes getOrCreateDevSchool() for seeding test data in dev.
 */

import { ref, type Ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================================
// TYPES
// ============================================================================

export interface School {
  id: string
  school_name: string
  admin_user_id: string
  region_code: string | null
  teacher_join_code: string
  created_at: string
}

export interface SchoolSummary {
  school_id: string
  school_name: string
  teacher_count: number
  class_count: number
  student_count: number
  total_practice_hours: number
}

export interface SchoolClass {
  id: string
  school_id: string
  teacher_user_id: string
  class_name: string
  course_code: string
  student_join_code: string
  current_seed: number
  last_lego_id: string | null
  is_active: boolean
  created_at: string
}

export interface ClassSession {
  id: string
  class_id: string
  teacher_user_id: string
  started_at: string
  ended_at: string | null
  start_lego_id: string
  end_lego_id: string | null
  cycles_completed: number
  duration_seconds: number
}

export interface Teacher {
  user_id: string
  name: string
  email: string
  role_in_context: string
  added_at: string
}

export interface Student {
  user_id: string
  name: string
  email: string
  role_in_context: string
  added_at: string
}

export interface StudentProgress {
  student_user_id: string
  student_name: string
  seeds_completed: number
  legos_mastered: number
  total_practice_seconds: number
  last_active_at: string | null
  joined_class_at: string | null
}

export interface JoinResult {
  success: boolean
  message: string
  class_name?: string
}

// ============================================================================
// COMPOSABLE
// ============================================================================

export function useSchoolsData(supabase: Ref<SupabaseClient | null>) {
  const loading = ref(false)
  const error = ref<string | null>(null)

  const getClient = (): SupabaseClient | null => supabase.value

  // --------------------------------------------------------------------------
  // READ: School for current user
  // --------------------------------------------------------------------------

  async function getSchoolForUser(userId: string): Promise<School | null> {
    const client = getClient()
    if (!client) return null

    const { data, error: err } = await client
      .from('schools')
      .select('*')
      .eq('admin_user_id', userId)
      .maybeSingle()

    if (err) {
      console.warn('[SchoolsData] getSchoolForUser error:', err.message)
      return null
    }
    return data
  }

  // --------------------------------------------------------------------------
  // READ: School summary (from reporting view)
  // --------------------------------------------------------------------------

  async function getSchoolSummary(schoolId: string): Promise<SchoolSummary | null> {
    const client = getClient()
    if (!client) return null

    const { data, error: err } = await client
      .from('school_summary')
      .select('*')
      .eq('school_id', schoolId)
      .maybeSingle()

    if (err) {
      console.warn('[SchoolsData] getSchoolSummary error:', err.message)
      return null
    }
    return data
  }

  // --------------------------------------------------------------------------
  // READ: Classes for a school
  // --------------------------------------------------------------------------

  async function getClasses(schoolId: string): Promise<SchoolClass[]> {
    const client = getClient()
    if (!client) return []

    const { data, error: err } = await client
      .from('classes')
      .select('*')
      .eq('school_id', schoolId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (err) {
      console.warn('[SchoolsData] getClasses error:', err.message)
      return []
    }
    return data ?? []
  }

  // --------------------------------------------------------------------------
  // READ: Classes for a specific teacher
  // --------------------------------------------------------------------------

  async function getClassesForTeacher(teacherUserId: string): Promise<SchoolClass[]> {
    const client = getClient()
    if (!client) return []

    const { data, error: err } = await client
      .from('classes')
      .select('*')
      .eq('teacher_user_id', teacherUserId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (err) {
      console.warn('[SchoolsData] getClassesForTeacher error:', err.message)
      return []
    }
    return data ?? []
  }

  // --------------------------------------------------------------------------
  // READ: Class detail (single class)
  // --------------------------------------------------------------------------

  async function getClassDetail(classId: string): Promise<SchoolClass | null> {
    const client = getClient()
    if (!client) return null

    const { data, error: err } = await client
      .from('classes')
      .select('*')
      .eq('id', classId)
      .maybeSingle()

    if (err) {
      console.warn('[SchoolsData] getClassDetail error:', err.message)
      return null
    }
    return data
  }

  // --------------------------------------------------------------------------
  // READ: Student progress for a class (from reporting view)
  // --------------------------------------------------------------------------

  async function getClassStudentProgress(classId: string): Promise<StudentProgress[]> {
    const client = getClient()
    if (!client) return []

    const { data, error: err } = await client
      .from('class_student_progress')
      .select('*')
      .eq('class_id', classId)

    if (err) {
      console.warn('[SchoolsData] getClassStudentProgress error:', err.message)
      return []
    }
    return data ?? []
  }

  // --------------------------------------------------------------------------
  // READ: Teachers for a school (via user_tags)
  // --------------------------------------------------------------------------

  async function getTeachers(schoolId: string): Promise<Teacher[]> {
    const client = getClient()
    if (!client) return []

    const { data, error: err } = await client
      .from('user_tags')
      .select('user_id, role_in_context, added_at')
      .eq('tag_type', 'school')
      .eq('tag_value', `SCHOOL:${schoolId}`)
      .eq('role_in_context', 'teacher')
      .is('removed_at', null)

    if (err) {
      console.warn('[SchoolsData] getTeachers error:', err.message)
      return []
    }

    // user_tags doesn't have name/email directly — learners table has display_name
    // For now return what we have; views can use user_id as fallback
    return (data ?? []).map((row: any) => ({
      user_id: row.user_id,
      name: row.user_id, // Will be enriched by view or future learner join
      email: '',
      role_in_context: row.role_in_context,
      added_at: row.added_at,
    }))
  }

  // --------------------------------------------------------------------------
  // READ: Students for a school (via user_tags on all classes)
  // --------------------------------------------------------------------------

  async function getStudents(schoolId: string): Promise<Student[]> {
    const client = getClient()
    if (!client) return []

    // Get all classes for the school first
    const classes = await getClasses(schoolId)
    if (classes.length === 0) return []

    const classIds = classes.map(c => c.id)
    const tagValues = classIds.map(id => `CLASS:${id}`)

    const { data, error: err } = await client
      .from('user_tags')
      .select('user_id, tag_value, role_in_context, added_at')
      .eq('tag_type', 'class')
      .in('tag_value', tagValues)
      .eq('role_in_context', 'student')
      .is('removed_at', null)

    if (err) {
      console.warn('[SchoolsData] getStudents error:', err.message)
      return []
    }

    return (data ?? []).map((row: any) => ({
      user_id: row.user_id,
      name: row.user_id,
      email: '',
      role_in_context: row.role_in_context,
      added_at: row.added_at,
    }))
  }

  // --------------------------------------------------------------------------
  // WRITE: Create a class
  // --------------------------------------------------------------------------

  async function createClass(
    schoolId: string,
    teacherUserId: string,
    className: string,
    courseCode: string,
  ): Promise<SchoolClass | null> {
    const client = getClient()
    if (!client) return null

    // Generate a student join code: ABC-123
    const code = generateJoinCode()

    const { data, error: err } = await client
      .from('classes')
      .insert({
        school_id: schoolId,
        teacher_user_id: teacherUserId,
        class_name: className,
        course_code: courseCode,
        student_join_code: code,
      })
      .select()
      .single()

    if (err) {
      console.warn('[SchoolsData] createClass error:', err.message)
      error.value = err.message
      return null
    }
    return data
  }

  // --------------------------------------------------------------------------
  // WRITE: Join with invite code
  // --------------------------------------------------------------------------

  async function joinWithCode(code: string, userId: string): Promise<JoinResult> {
    const client = getClient()
    if (!client) return { success: false, message: 'No database connection' }

    // Check if it's a student join code (on classes table)
    const { data: classData } = await client
      .from('classes')
      .select('id, class_name, school_id')
      .eq('student_join_code', code.toUpperCase())
      .maybeSingle()

    if (classData) {
      // Insert user_tag for the student
      const { error: tagErr } = await client
        .from('user_tags')
        .insert({
          user_id: userId,
          tag_type: 'class',
          tag_value: `CLASS:${classData.id}`,
          role_in_context: 'student',
          added_by: userId,
        })

      if (tagErr) {
        return { success: false, message: tagErr.message }
      }
      return { success: true, message: 'Joined class', class_name: classData.class_name }
    }

    // Check if it's a teacher join code (on schools table)
    const { data: schoolData } = await client
      .from('schools')
      .select('id, school_name')
      .eq('teacher_join_code', code.toUpperCase())
      .maybeSingle()

    if (schoolData) {
      const { error: tagErr } = await client
        .from('user_tags')
        .insert({
          user_id: userId,
          tag_type: 'school',
          tag_value: `SCHOOL:${schoolData.id}`,
          role_in_context: 'teacher',
          added_by: userId,
        })

      if (tagErr) {
        return { success: false, message: tagErr.message }
      }
      return { success: true, message: `Joined ${schoolData.school_name} as teacher` }
    }

    return { success: false, message: 'Invalid code' }
  }

  // --------------------------------------------------------------------------
  // DEV: Get or create a dev school for god mode testing
  // --------------------------------------------------------------------------

  async function getOrCreateDevSchool(): Promise<School | null> {
    const client = getClient()
    if (!client) return null

    const DEV_ADMIN_ID = 'admin-001'

    // Check if dev school exists
    let school = await getSchoolForUser(DEV_ADMIN_ID)
    if (school) return school

    // Create dev school
    console.log('[SchoolsData] Creating dev school for god mode...')
    const { data, error: err } = await client
      .from('schools')
      .insert({
        admin_user_id: DEV_ADMIN_ID,
        school_name: 'Ysgol Gymraeg Aberystwyth',
        teacher_join_code: 'DEV-TEACH',
      })
      .select()
      .single()

    if (err) {
      console.warn('[SchoolsData] Failed to create dev school:', err.message)
      return null
    }

    school = data

    // Create teacher tag
    await client.from('user_tags').insert({
      user_id: 'teacher-001',
      tag_type: 'school',
      tag_value: `SCHOOL:${school.id}`,
      role_in_context: 'teacher',
      added_by: DEV_ADMIN_ID,
    })

    // Create classes
    const classInserts = [
      { school_id: school.id, teacher_user_id: 'teacher-001', class_name: 'Year 7 Welsh', course_code: 'cym_for_eng', student_join_code: 'DEV-Y7W' },
      { school_id: school.id, teacher_user_id: 'teacher-001', class_name: 'Year 8 Advanced', course_code: 'cym_for_eng', student_join_code: 'DEV-Y8A' },
      { school_id: school.id, teacher_user_id: 'teacher-001', class_name: 'Year 9 Beginners', course_code: 'spa_for_eng', student_join_code: 'DEV-Y9B' },
    ]

    const { data: classes } = await client
      .from('classes')
      .insert(classInserts)
      .select()

    if (classes && classes.length > 0) {
      // Create test students
      const studentTags = [
        'student-001', 'student-002', 'student-003', 'student-004', 'student-005',
      ].flatMap(studentId =>
        classes.slice(0, 2).map(cls => ({
          user_id: studentId,
          tag_type: 'class' as const,
          tag_value: `CLASS:${cls.id}`,
          role_in_context: 'student' as const,
          added_by: 'teacher-001',
        }))
      )

      await client.from('user_tags').insert(studentTags)
    }

    console.log('[SchoolsData] Dev school created with classes and students')
    return school
  }

  // --------------------------------------------------------------------------
  // WRITE: Update class progress (last LEGO played)
  // --------------------------------------------------------------------------

  async function updateClassProgress(classId: string, lastLegoId: string): Promise<void> {
    const client = getClient()
    if (!client) return

    const { error: err } = await client
      .from('classes')
      .update({ last_lego_id: lastLegoId })
      .eq('id', classId)

    if (err) console.error('[SchoolsData] Failed to update class progress:', err)
  }

  // --------------------------------------------------------------------------
  // WRITE: Start a class session
  // --------------------------------------------------------------------------

  async function startClassSession(
    classId: string,
    teacherUserId: string,
    startLegoId: string
  ): Promise<string | null> {
    const client = getClient()
    if (!client) return null

    const { data, error: err } = await client
      .from('class_sessions')
      .insert({
        class_id: classId,
        teacher_user_id: teacherUserId,
        start_lego_id: startLegoId,
      })
      .select('id')
      .single()

    if (err) {
      console.error('[SchoolsData] Failed to start class session:', err)
      return null
    }
    return data.id
  }

  // --------------------------------------------------------------------------
  // WRITE: End a class session
  // --------------------------------------------------------------------------

  async function endClassSession(
    sessionId: string,
    endLegoId: string,
    cyclesCompleted: number,
    durationSeconds: number
  ): Promise<void> {
    const client = getClient()
    if (!client) return

    const { error: err } = await client
      .from('class_sessions')
      .update({
        ended_at: new Date().toISOString(),
        end_lego_id: endLegoId,
        cycles_completed: cyclesCompleted,
        duration_seconds: durationSeconds,
      })
      .eq('id', sessionId)

    if (err) console.error('[SchoolsData] Failed to end class session:', err)
  }

  // --------------------------------------------------------------------------
  // READ: Session history for a class
  // --------------------------------------------------------------------------

  async function getClassSessions(classId: string, limit = 20): Promise<ClassSession[]> {
    const client = getClient()
    if (!client) return []

    const { data, error: err } = await client
      .from('class_sessions')
      .select('*')
      .eq('class_id', classId)
      .order('started_at', { ascending: false })
      .limit(limit)

    if (err) {
      console.warn('[SchoolsData] getClassSessions error:', err.message)
      return []
    }
    return data ?? []
  }

  return {
    loading,
    error,

    // Read
    getSchoolForUser,
    getSchoolSummary,
    getClasses,
    getClassesForTeacher,
    getClassDetail,
    getClassStudentProgress,
    getTeachers,
    getStudents,

    // Write
    createClass,
    joinWithCode,
    updateClassProgress,
    startClassSession,
    endClassSession,

    // Read (sessions)
    getClassSessions,

    // Dev
    getOrCreateDevSchool,
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function generateJoinCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '0123456789'
  const l = () => letters[Math.floor(Math.random() * letters.length)]
  const d = () => digits[Math.floor(Math.random() * digits.length)]
  return `${l()}${l()}${l()}-${d()}${d()}${d()}`
}
