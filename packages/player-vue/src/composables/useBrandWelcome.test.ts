import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hasSeenBrandWelcome, markBrandWelcomeSeen, playBrandWelcome, BRAND_WELCOME_AUDIO_URL } from './useBrandWelcome'

describe('useBrandWelcome — global first-boot brand moment (local-only, not learner progress)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reports unseen before it has ever been marked', () => {
    expect(hasSeenBrandWelcome()).toBe(false)
  })

  it('reports seen after marking, and persists across calls', () => {
    markBrandWelcomeSeen()
    expect(hasSeenBrandWelcome()).toBe(true)
    expect(hasSeenBrandWelcome()).toBe(true)
  })

  it('stores the seen-flag under a local-only key, distinct from DB welcome_played_at plumbing', () => {
    markBrandWelcomeSeen()
    expect(localStorage.getItem('ssi-brand-welcome-seen')).toBe('true')
  })

  it('never throws even if localStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => hasSeenBrandWelcome()).not.toThrow()
    expect(hasSeenBrandWelcome()).toBe(false)
    spy.mockRestore()
  })

  it('playBrandWelcome never throws even without a real Audio implementation', () => {
    expect(() => playBrandWelcome()).not.toThrow()
  })

  it('points at the placeholder asset — the documented single-file swap point for Aran\'s real recording', () => {
    expect(BRAND_WELCOME_AUDIO_URL).toBe('/audio/welcome-brand-placeholder.wav')
  })
})
