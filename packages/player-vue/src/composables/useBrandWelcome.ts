/**
 * useBrandWelcome - the global, language-independent first-boot brand moment.
 *
 * Per docs/first-boot-experience.md (2026-07-03 rethink): the old per-course
 * "welcome" lecture is being retired in favour of a few seconds of brand
 * sound + one localized text line, then straight into round 1. The coaching
 * story (meta-commentary instructions) owns the method explanation from
 * here on — this composable only owns the brand moment itself.
 *
 * Seen-state is LOCAL ONLY (localStorage, not learners.welcome_played_at) —
 * per the doc, this is not learner progress, so it doesn't sync cross-device
 * and doesn't need a DB round-trip to gate on.
 *
 * ASSET SWAP: `BRAND_WELCOME_AUDIO_URL` points at a placeholder tone. When
 * Aran's real recording lands, replace the file at that path (same name) or
 * update the constant below — no other code changes needed.
 */

const SEEN_KEY = 'ssi-brand-welcome-seen'

// --- ASSET SWAP POINT -------------------------------------------------
// Placeholder: a short, gentle placeholder tone (public/audio/welcome-brand-placeholder.wav).
// Swap in Aran's real one-line recording by replacing this file (keep the
// name) or repointing this constant at the new asset.
export const BRAND_WELCOME_AUDIO_URL = '/audio/welcome-brand-placeholder.wav'
// -----------------------------------------------------------------------

/** Has this device already seen the brand welcome moment? */
export function hasSeenBrandWelcome(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === 'true'
  } catch {
    return false
  }
}

/** Mark the brand welcome as seen on this device. Never throws. */
export function markBrandWelcomeSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, 'true')
  } catch {
    // best-effort — a failed write just means the moment plays again next boot
  }
}

/**
 * Play the brand welcome clip. Fire-and-forget: audio playback failures
 * (autoplay policy, missing file, etc.) must never block or break the
 * loading sequence — the staged text still shows regardless.
 */
export function playBrandWelcome(): void {
  try {
    const audio = new Audio(BRAND_WELCOME_AUDIO_URL)
    audio.volume = 0.6
    void audio.play().catch(() => {
      // Autoplay may be blocked before a user gesture — silently skip.
      // The visual brand moment (staged text) still plays either way.
    })
  } catch {
    // never let the brand moment break boot
  }
}
