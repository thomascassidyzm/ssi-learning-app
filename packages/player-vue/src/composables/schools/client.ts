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

/**
 * Resolve a Supabase client, preferring a component-injected ref and falling
 * back to this module-level client (set by App.vue at boot). Returns null
 * rather than throwing.
 *
 * Why: shared singletons like useSharedSubscription / useSharedUserEntitlements
 * capture inject('supabase') at first-call. When that first call comes from a
 * non-descendant context — App.vue itself provides 'supabase', so it cannot
 * inject its own — the ref is undefined and the singleton stays tokenless for
 * the whole session, reporting paid users as not subscribed. This fallback
 * makes those singletons robust to where they are first instantiated.
 */
export function resolveSupabase(injected?: { value: SupabaseClient | null } | null): SupabaseClient | null {
  return injected?.value ?? _client
}
