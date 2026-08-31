/**
 * REGRESSION — the missing config value that bricked sign-in silently
 * (2026-08-31).
 *
 * If a required build-time variable was absent, App.vue's Supabase-client
 * block was simply skipped: no client, and therefore every sign-in path
 * answered "App not ready. Please try again." forever, with no log of any
 * kind. Two things had to change and are pinned here:
 *   1. the absence is NAMEABLE, so the loud log in App.vue can say which
 *      variable is missing rather than just that something is;
 *   2. the learner-facing copy is honest — it does not imply a retry will
 *      help, and it does not blame the learner or their device.
 */
import { describe, it, expect } from 'vitest'
import { missingRequiredConfig, CONFIG_UNAVAILABLE_MESSAGE, type AppConfig } from './env'

const base = (over: Partial<AppConfig> = {}): AppConfig => ({
  supabase: { url: 'https://x.supabase.co', anonKey: 'anon' },
  s3: { audioBaseUrl: '', bucket: 'b', region: 'r' },
  features: { useDatabase: true, useDemoMode: false },
  ...over,
})

describe('missingRequiredConfig', () => {
  it('reports nothing when the app is fully configured', () => {
    expect(missingRequiredConfig(base())).toEqual([])
  })

  it('NAMES each absent variable rather than failing anonymously', () => {
    expect(missingRequiredConfig(base({ supabase: { url: '', anonKey: 'anon' } })))
      .toEqual(['VITE_SUPABASE_URL'])
    expect(missingRequiredConfig(base({ supabase: { url: 'https://x', anonKey: '' } })))
      .toEqual(['VITE_SUPABASE_ANON_KEY'])
    expect(missingRequiredConfig(base({ supabase: { url: '', anonKey: '' }, features: { useDatabase: false, useDemoMode: false } })))
      .toEqual(['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_USE_DATABASE (must be "true")'])
  })
})

describe('CONFIG_UNAVAILABLE_MESSAGE', () => {
  it('does not tell the learner to just try again', () => {
    expect(CONFIG_UNAVAILABLE_MESSAGE).not.toMatch(/try again/i)
  })

  it('does not blame the learner or their device', () => {
    expect(CONFIG_UNAVAILABLE_MESSAGE).not.toMatch(/your (connection|device|browser|network)/i)
    expect(CONFIG_UNAVAILABLE_MESSAGE).not.toMatch(/check your/i)
  })

  it('owns the fault and gives a way out', () => {
    expect(CONFIG_UNAVAILABLE_MESSAGE).toMatch(/our end/i)
    expect(CONFIG_UNAVAILABLE_MESSAGE).toMatch(/admin@saysomethingin\.com/)
  })
})
