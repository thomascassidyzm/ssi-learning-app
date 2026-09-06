import { describe, it, expect } from 'vitest'
import { missingWebviewBuildConfig } from '../../scripts/webviewBuildGuard.mjs'

const FULL = {
  VITE_APP_SHELL: 'webview',
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon',
  VITE_USE_DATABASE: 'true',
}

describe('missingWebviewBuildConfig', () => {
  it('ignores web builds entirely — Vercel supplies these and a redeploy fixes it', () => {
    expect(missingWebviewBuildConfig({})).toEqual([])
    expect(missingWebviewBuildConfig({ VITE_APP_SHELL: 'web' })).toEqual([])
  })

  it('names every absent var on a webview build — the 5e99196 APK had all three', () => {
    expect(missingWebviewBuildConfig({ VITE_APP_SHELL: 'webview' })).toEqual([
      'VITE_SUPABASE_URL',
      'VITE_SUPABASE_ANON_KEY',
      'VITE_USE_DATABASE (must be "true")',
    ])
  })

  it('passes a fully configured webview build', () => {
    expect(missingWebviewBuildConfig(FULL)).toEqual([])
  })

  it('treats whitespace-only values as absent', () => {
    expect(missingWebviewBuildConfig({ ...FULL, VITE_SUPABASE_ANON_KEY: '   ' }))
      .toEqual(['VITE_SUPABASE_ANON_KEY'])
  })

  it('requires VITE_USE_DATABASE to be exactly "true"', () => {
    expect(missingWebviewBuildConfig({ ...FULL, VITE_USE_DATABASE: '1' }))
      .toEqual(['VITE_USE_DATABASE (must be "true")'])
  })

  it('lets an inspect-only build opt out', () => {
    expect(missingWebviewBuildConfig({ VITE_APP_SHELL: 'webview', VITE_ALLOW_NO_SUPABASE: '1' })).toEqual([])
  })
})
