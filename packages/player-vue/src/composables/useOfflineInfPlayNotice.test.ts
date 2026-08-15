import { describe, it, expect, beforeEach } from 'vitest'
import {
  markOfflineInfPlayEngaged,
  dismissOfflineInfPlayNotice,
  offlineInfPlayNoticeVisible,
  __resetOfflineInfPlayNoticeForTests,
} from './useOfflineInfPlayNotice'
import engLocale from '../locales/eng.json'

describe('offline infinite-play notice', () => {
  beforeEach(() => __resetOfflineInfPlayNoticeForTests())

  it('shows when offline infinite play engages', () => {
    expect(offlineInfPlayNoticeVisible.value).toBe(false)
    expect(markOfflineInfPlayEngaged(true)).toBe(true)
    expect(offlineInfPlayNoticeVisible.value).toBe(true)
  })

  it('stays silent on a normal ONLINE session', () => {
    // The online path recycles cached rounds too (deterministic revival build);
    // it must never tell the learner they are offline.
    expect(markOfflineInfPlayEngaged(false)).toBe(false)
    expect(offlineInfPlayNoticeVisible.value).toBe(false)
  })

  it('shows at most once per session, even if offline play re-engages', () => {
    markOfflineInfPlayEngaged(true)
    dismissOfflineInfPlayNotice()
    expect(offlineInfPlayNoticeVisible.value).toBe(false)

    // Every subsequent cached loop — and a recover-then-drop-again cycle —
    // must not nag.
    expect(markOfflineInfPlayEngaged(true)).toBe(false)
    expect(markOfflineInfPlayEngaged(false)).toBe(false)
    expect(markOfflineInfPlayEngaged(true)).toBe(false)
    expect(offlineInfPlayNoticeVisible.value).toBe(false)
  })

  it('an online engage does not burn the one-shot', () => {
    expect(markOfflineInfPlayEngaged(false)).toBe(false)
    expect(markOfflineInfPlayEngaged(true)).toBe(true)
    expect(offlineInfPlayNoticeVisible.value).toBe(true)
  })

  it('carries Tom’s copy, in British English, with no parentheses', () => {
    const player = (engLocale as Record<string, any>).player
    expect(player.offlinePracticeBody).toBe(
      "We can't reach new items right now, so here's a chance to practise what you've already covered — new items will come through as soon as we can reach them.",
    )
    // Cause-NEUTRAL by ruling: this fires on airplane mode AND on a connection
    // too weak to complete, and the learner can't tell those apart — so the
    // copy must not assert "you're offline" at someone showing full bars.
    expect(player.offlinePracticeBody).not.toMatch(/you're offline/i)
    // British spelling of the verb.
    expect(player.offlinePracticeBody).toContain('practise')
    for (const key of ['offlinePracticeBody', 'offlinePracticeAck']) {
      expect(player[key]).not.toMatch(/[()]/)
    }
  })

  it('is translated into every UI language the app localises', () => {
    // Tom approved machine translation of this message across the shipped
    // locales, so a locale file WITHOUT it is now a regression, not a
    // deliberate English fallback. Eagerly globbed so a new locale file added
    // later fails here until it carries the message too.
    const locales = import.meta.glob('../locales/*.json', { eager: true }) as Record<string, any>
    const files = Object.keys(locales)
    expect(files.length).toBeGreaterThan(20)
    for (const file of files) {
      const player = (locales[file].default ?? locales[file]).player
      expect(player?.offlinePracticeBody, `${file} offlinePracticeBody`).toBeTruthy()
      expect(player?.offlinePracticeAck, `${file} offlinePracticeAck`).toBeTruthy()
      // House rule, every language: no parentheses in learner-facing text.
      expect(player.offlinePracticeBody, `${file} parentheses`).not.toMatch(/[()]/)
      expect(player.offlinePracticeAck, `${file} parentheses`).not.toMatch(/[()]/)
      // Never ship the English string as a "translation" by copy-paste.
      if (!file.endsWith('eng.json')) {
        expect(player.offlinePracticeBody, `${file} untranslated`).not.toBe(
          (engLocale as Record<string, any>).player.offlinePracticeBody,
        )
      }
    }
  })
})
