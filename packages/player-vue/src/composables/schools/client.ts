/**
 * Supabase client bridge for schools composables.
 * SchoolsContainer calls setSchoolsClient() on mount.
 * All ported composables import getSchoolsClient() instead of standalone's getClient().
 */

import type { SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function setSchoolsClient(client: SupabaseClient) {
  _client = client
}

export function getSchoolsClient(): SupabaseClient {
  if (!_client) {
    throw new Error('[schools] Supabase client not set. Call setSchoolsClient() first.')
  }
  return _client
}
