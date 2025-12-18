/**
 * Supabase client factory for SSi Learning App
 *
 * Creates a configured Supabase client for querying course data.
 * Config must be provided by the application layer.
 */

import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseConfig, SupabaseClientOptions } from '../persistence/types';

// Re-export types for convenience
export type { SupabaseConfig, SupabaseClientOptions } from '../persistence/types';

export interface ExtendedSupabaseClientOptions extends SupabaseClientOptions {
  /** Enable realtime subscriptions (default: false) */
  realtime?: boolean;
}

/**
 * Creates a Supabase client instance
 *
 * @param config - Supabase configuration (REQUIRED)
 * @param options - Client options
 * @returns Configured Supabase client
 *
 * @example
 * ```typescript
 * const supabase = createClient(
 *   { url: 'https://...', anonKey: '...' }
 * );
 * const { data, error } = await supabase
 *   .from('course_seeds')
 *   .select('*')
 *   .eq('course_code', 'spa_for_eng_v2');
 * ```
 */
export function createClient(
  config: SupabaseConfig,
  options?: ExtendedSupabaseClientOptions
): SupabaseClient {
  const dbSchema = config.schema || 'public';

  const client = createSupabaseClient(config.url, config.anonKey, {
    auth: {
      persistSession: options?.persistSession ?? true,
      autoRefreshToken: options?.autoRefreshToken ?? true,
    },
    realtime: options?.realtime ? undefined : {
      params: {
        eventsPerSecond: 0, // Disable realtime by default
      },
    },
    db: {
      schema: dbSchema,
    },
  });

  return client as SupabaseClient;
}
