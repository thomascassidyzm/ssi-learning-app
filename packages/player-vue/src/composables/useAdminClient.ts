/**
 * useAdminClient - Provides Supabase client + auth token for admin views.
 *
 * Replaces the getSchoolsClient() bridge pattern.
 * Injects the Supabase client directly from App.vue's provide('supabase').
 * Uses Supabase Auth session for tokens (not Clerk).
 */

import { inject, ref } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'

export function useAdminClient() {
  const supabaseRef = inject('supabase', ref(null)) as any

  function getClient(): SupabaseClient {
    const client = supabaseRef.value
    if (!client) {
      throw new Error('[useAdminClient] Supabase client not available. Ensure App.vue has mounted.')
    }
    return client
  }

  async function getAuthToken(): Promise<string | null> {
    const client = supabaseRef.value
    if (!client) return null
    try {
      const { data } = await client.auth.getSession()
      return data?.session?.access_token ?? null
    } catch {
      return null
    }
  }

  return { getClient, getAuthToken }
}
