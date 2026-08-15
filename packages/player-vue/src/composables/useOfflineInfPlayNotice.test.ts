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
      "You're offline, so we're just going to give you a chance to practise what you've already covered.",
    )
    expect(player.offlinePracticeBodyNew).toBe("You'll get new items when you next go online.")
    for (const key of ['offlinePracticeTitle', 'offlinePracticeBody', 'offlinePracticeBodyNew', 'offlinePracticeAck']) {
      expect(player[key]).not.toMatch(/[()]/)
    }
  })
})
