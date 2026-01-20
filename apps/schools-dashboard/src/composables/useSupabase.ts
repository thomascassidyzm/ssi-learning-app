/**
 * useSupabase - Supabase client for schools dashboard
 *
 * For God Mode testing, we use the anon key but bypass RLS by:
 * 1. Using views that aggregate data
 * 2. Querying as a "god mode" user context
 *
 * In production, this would use Clerk JWT for proper RLS.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { ref } from 'vue'

// Database types (subset for dashboard)
export interface DbLearner {
  id: string
  user_id: string
  display_name: string
  educational_role: 'student' | 'teacher' | 'school_admin' | 'govt_admin' | null
  platform_role: 'ssi_admin' | null
  created_at: string
}

export interface DbSchool {
  id: string
  admin_user_id: string
  school_name: string
  region_code: string | null
  teacher_join_code: string
  created_at: string
}

export interface DbClass {
  id: string
  school_id: string
  teacher_user_id: string
  class_name: string
  course_code: string
  student_join_code: string
  current_seed: number
  is_active: boolean
  created_at: string
}

export interface DbUserTag {
  id: string
  user_id: string
  tag_type: 'school' | 'class'
  tag_value: string
  role_in_context: 'admin' | 'teacher' | 'student'
  added_by: string
  added_at: string
  removed_at: string | null
}

export interface DbGovtAdmin {
  id: string
  user_id: string
  region_code: string
  organization_name: string
  created_at: string
}

// View types
export interface ClassStudentProgress {
  class_id: string
  class_name: string
  course_code: string
  school_id: string
  teacher_user_id: string
  student_user_id: string
  learner_id: string
  student_name: string
  seeds_completed: number
  legos_mastered: number
  total_practice_seconds: number
  last_active_at: string | null
  joined_class_at: string
}

export interface SchoolSummary {
  school_id: string
  school_name: string
  region_code: string | null
  admin_user_id: string
  created_at: string
  teacher_count: number
  class_count: number
  student_count: number
  total_practice_hours: number
}

export interface RegionSummary {
  region_code: string
  region_name: string
  country_code: string
  primary_language: string
  school_count: number
  teacher_count: number
  student_count: number
  total_practice_hours: number
}

// Supabase config from env
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Singleton client
let supabaseClient: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase environment variables')
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return supabaseClient
}

// Connection state
const isConnected = ref(false)
const connectionError = ref<string | null>(null)

export function useSupabase() {
  const client = getClient()

  // Test connection
  async function testConnection(): Promise<boolean> {
    try {
      const { error } = await client.from('regions').select('code').limit(1)
      if (error) throw error
      isConnected.value = true
      connectionError.value = null
      return true
    } catch (err) {
      isConnected.value = false
      connectionError.value = err instanceof Error ? err.message : 'Unknown error'
      return false
    }
  }

  return {
    client,
    isConnected,
    connectionError,
    testConnection,
  }
}

// Export client getter for direct use
export { getClient }
