/**
 * Audio Configuration - URL building and proxy configuration
 *
 * Centralizes audio URL generation for the entire app.
 * Uses backend proxy by default for:
 * - Entitlement verification
 * - Analytics tracking
 * - CORS bypass
 * - Future CDN flexibility
 */

export interface AudioUrlOptions {
  courseId?: string
  seedId?: string
  role?: 'known' | 'target1' | 'target2'
  offline?: boolean
}

/**
 * Build audio URL through the proxy API.
 * The proxy handles S3 resolution, caching headers, and analytics.
 */
export function buildProxyAudioUrl(audioId: string, options: AudioUrlOptions = {}): string {
  const params = new URLSearchParams()

  if (options.courseId) params.set('courseId', options.courseId)
  if (options.seedId) params.set('seedId', options.seedId)
  if (options.role) params.set('role', options.role)
  if (options.offline) params.set('offline', 'true')

  const queryString = params.toString()
  const baseUrl = `/api/audio/${audioId}`

  return queryString ? `${baseUrl}?${queryString}` : baseUrl
}

/**
 * Build direct S3 URL (fallback when proxy is unavailable).
 * Uses the S3 key directly - bypasses proxy.
 */
export function buildDirectAudioUrl(s3Key: string): string {
  const baseUrl = import.meta.env.VITE_S3_AUDIO_BASE_URL ||
                  'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com'
  return `${baseUrl}/${s3Key}`
}

/**
 * Audio configuration constants
 */
export const AUDIO_CONFIG = {
  // Proxy endpoint
  proxyEndpoint: '/api/audio',

  // S3 fallback base URL
  s3BaseUrl: import.meta.env.VITE_S3_AUDIO_BASE_URL ||
             'https://ssi-audio-stage.s3.eu-west-1.amazonaws.com',

  // Cache durations
  cacheDurationDays: 30,
  serviceWorkerCacheName: 'ssi-audio-cache',

  // Prefetch settings
  prefetchBufferMinutes: 30,
  prefetchBatchSize: 20,  // Cycles to prefetch at once

  // Download settings
  maxDownloadHours: 10,
  downloadOptions: [
    { label: 'Current belt', hours: 0.5 },
    { label: 'Next 2 hours', hours: 2 },
    { label: 'Next 5 hours', hours: 5 },
    { label: 'Entire course', hours: 10 },
  ],
} as const

export type AudioConfig = typeof AUDIO_CONFIG
