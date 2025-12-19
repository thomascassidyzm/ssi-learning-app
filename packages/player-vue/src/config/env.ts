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
  clerk: {
    publishableKey: string
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
    clerk: {
      publishableKey: import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '',
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
 * Check if S3 is configured
 */
export function isS3Configured(config: AppConfig): boolean {
  return Boolean(config.s3.audioBaseUrl)
}

/**
 * Check if Clerk is configured
 */
export function isClerkConfigured(config: AppConfig): boolean {
  return Boolean(config.clerk.publishableKey)
}
