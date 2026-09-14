/** ownPlayBanner (job #662, Tom 13:07Z): the warning shows for a teacher on her own player and nowhere else. */
import { describe, it, expect } from 'vitest'
import { showOwnPlayBanner, OWN_PLAY_BANNER_LINK } from './ownPlayBanner'

describe('showOwnPlayBanner', () => {
  it('a teacher on the standalone player, no class context: shown, and the link is her classes', () => {
    expect(showOwnPlayBanner({ role: 'teacher', hasClassContext: false, embedded: false })).toBe(true)
    expect(OWN_PLAY_BANNER_LINK).toBe('/schools')
  })
  it('play as class, the embedded shell player, and every other role: not shown', () => {
    expect(showOwnPlayBanner({ role: 'teacher', hasClassContext: true, embedded: false })).toBe(false)
    expect(showOwnPlayBanner({ role: 'teacher', hasClassContext: false, embedded: true })).toBe(false)
    for (const role of [null, undefined, 'student', 'school_admin', 'govt_admin', 'tutor']) {
      expect(showOwnPlayBanner({ role, hasClassContext: false, embedded: false })).toBe(false)
    }
  })
})
