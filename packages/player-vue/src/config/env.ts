/**
 * Environment configuration for player-vue
 * Reads VITE_ prefixed environment variables
 */

export interface AppConfig {
  supabase: {
    url: string
    anonKey: string
  }
  s3: {
    audioBaseUrl: string
    bucket: string
    region: string
  }
  features: {
    useDatabase: boolean
    useDemoMode: boolean
  }
}

/**
 * Load configuration from environment variables
 * Falls back to sensible defaults for demo mode
 */
export function loadConfig(): AppConfig {
  return {
    supabase: {
      url: import.meta.env.VITE_SUPABASE_URL || '',
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
    },
    s3: {
      audioBaseUrl: import.meta.env.VITE_S3_AUDIO_BASE_URL || '',
      bucket: import.meta.env.VITE_S3_AUDIO_BUCKET || 'ssi-audio-stage',
      region: import.meta.env.VITE_S3_REGION || 'eu-west-1',
    },
    features: {
      useDatabase: import.meta.env.VITE_USE_DATABASE === 'true',
      useDemoMode: import.meta.env.VITE_USE_DEMO_MODE === 'true',
    },
  }
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(config: AppConfig): boolean {
  return Boolean(config.supabase.url && config.supabase.anonKey)
}

/**
 * Which required build-time config values are ABSENT.
 *
 * A missing one of these is not a degraded mode — it bricks sign-in for
 * everybody, because no Supabase client is ever created and every sign-in
 * path then says "App not ready. Please try again." forever. Until
 * 2026-08-31 that happened with NO log of any kind: the client-creation
 * block was simply skipped. Naming the absent vars is what turns a silent
 * brick into a five-second fix.
 */
export function missingRequiredConfig(config: AppConfig): string[] {
  const missing: string[] = []
  if (!config.supabase.url) missing.push('VITE_SUPABASE_URL')
  if (!config.supabase.anonKey) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!config.features.useDatabase) missing.push('VITE_USE_DATABASE (must be "true")')
  return missing
}

/**
 * The ONE learner-facing string for "the app has no Supabase client".
 *
 * Whatever the cause (absent env var, createClient threw), it is OUR fault
 * and nothing the learner does changes it. The old copy — "App not ready.
 * Please try again." — implied a transient blip and invited an infinite
 * retry loop against a permanently broken build.
 */
export const CONFIG_UNAVAILABLE_MESSAGE =
  "Sign-in isn't working at our end right now. This one's on us, not you — please try later, or email admin@saysomethingin.com."
