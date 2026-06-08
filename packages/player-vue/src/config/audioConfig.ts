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
