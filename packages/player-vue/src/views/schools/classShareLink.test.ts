/**
 * ONE DOOR into a class (2026-09-10).
 *
 * Two surfaces hand a teacher a class link: the class page's Invite students
 * card (classDetailPanels.joinPanelState) and the classes list's Copy link
 * button (TeacherDashboard.shareUrlFor). Until this test, the first built
 * /redeem/<code> and the second built /with/<code> — the paid checkout
 * gateway — while the Handbook told teachers they were the same link. This
 * pins both to the one helper, so they cannot drift apart again without a
 * red test naming the file.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { joinPanelState } from './classDetailPanels'
import { redeemLink } from '@/composables/schools/inviteLink'

const here = dirname(fileURLToPath(import.meta.url))
const teacherDashboardSource = readFileSync(join(here, 'TeacherDashboard.vue'), 'utf8')

describe('the classes list and the class page hand out the same class link', () => {
  it('TeacherDashboard builds its share link with inviteLink.redeemLink, never a hand-rolled URL', () => {
    expect(teacherDashboardSource).toMatch(/import \{ redeemLink \} from '@\/composables\/schools\/inviteLink'/)
    expect(teacherDashboardSource).toMatch(/redeemLink\(cls\.join_code, origin\)/)
  })

  it('TeacherDashboard never hands out the /with/ checkout gateway as a class link', () => {
    expect(teacherDashboardSource).not.toMatch(/\/with\/\$\{/)
  })

  it('the class page link is the /redeem/ door the classes list now shares', () => {
    const origin = 'https://saysomethingin.app'
    const panel = joinPanelState({ joinCode: 'ABC-123', loading: false, error: null, origin })
    expect(panel.url).toBe('https://saysomethingin.app/redeem/ABC-123')
    expect(redeemLink('ABC-123', origin)).toBe(panel.url)
  })
})
