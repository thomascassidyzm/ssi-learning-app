/**
 * The progress modal is the SECOND home of the offline infinite-play message —
 * the place a learner who dismissed the one-shot dialog can still find out why
 * the material is coming round again.
 *
 * Rendered rather than string-matched, because the condition (isInfplay AND
 * isOffline) is the part that can silently rot: showing this to someone online,
 * or hiding it from someone offline, are both wrong and neither shows up in a
 * locale-file test.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProgressModal from './ProgressModal.vue'
import { BELTS } from '@/composables/useBeltProgress'
import eng from '../locales/eng.json'

const MESSAGE = (eng as Record<string, any>).player.offlinePracticeBody

const emptyWindow = { minutes: 0, learners: 0 }
const data = {
  targetLanguage: 'cym',
  languageName: 'Welsh',
  global: { today: emptyWindow, days7: emptyWindow, days30: emptyWindow, allTime: emptyWindow },
  user: { today: emptyWindow, days7: emptyWindow, days30: emptyWindow, allTime: emptyWindow },
} as any

const render = (props: Record<string, unknown>) =>
  mount(ProgressModal, {
    props: { isOpen: true, data, currentBelt: BELTS[0], ...props },
    global: { stubs: { Teleport: true, LanguageFlag: true } },
  })

describe('ProgressModal — offline infinite-play message', () => {
  it('shows the message when infinite play is running offline', () => {
    const wrapper = render({ isInfplay: true, isOffline: true })
    expect(wrapper.text()).toContain(MESSAGE)
  })

  it('stays quiet during ONLINE infinite play', () => {
    const wrapper = render({ isInfplay: true, isOffline: false })
    expect(wrapper.text()).not.toContain(MESSAGE)
  })

  it('stays quiet offline in the ordinary main loop', () => {
    const wrapper = render({ isInfplay: false, isOffline: true })
    expect(wrapper.text()).not.toContain(MESSAGE)
  })
})

/**
 * THE WALK INTO NOTHING. Tom, 2026-08-31: "Belt skip must be unavailable
 * whenever the app cannot serve the target belt."
 *
 * The modal's half of that is this pair of assertions — a belt the device has
 * not got must be BOTH visually disabled and inert to a tap, because either
 * one alone still lets a determined finger leap out of the downloaded plan.
 * Which states count as "cannot serve" is the caller's half: LearningPlayer
 * feeds `is-offline` from `cannotFetchNewContent()`, which is offline OR
 * practising, and the practising case is the one that was missing.
 */
describe('ProgressModal — a belt we cannot serve is not tappable', () => {
  const unreachable = new Set([BELTS[3].name])

  it('disables the chip and swallows the tap', async () => {
    const wrapper = render({
      isOffline: true,
      offlineUnavailableBeltNames: unreachable,
    })
    const chip = wrapper.findAll('.map-chip')
      .find((c) => c.attributes('aria-label')?.startsWith(`${BELTS[3].name} belt`))!
    expect(chip.attributes('disabled')).toBeDefined()
    // and it SAYS why, rather than looking broken. This used to assert the
    // literal word "unavailable"; since 2026-09-01 the chip carries the SAME
    // sentence the belt-skip action would show if you got past it, so the
    // assertion is now about it explaining itself rather than about one word.
    expect(chip.attributes('aria-label')).toMatch(/isn't downloaded|isn't on this device|can't reach/)
    await chip.trigger('click')
    expect(wrapper.emitted('skipToBelt')).toBeUndefined()
  })

  it('shows the reason the ACTION would give, when one is supplied', async () => {
    const reason = "You're practising what you've already covered — green belt needs new material we can't reach right now."
    const wrapper = render({
      isOffline: true,
      offlineUnavailableBeltNames: unreachable,
      beltUnavailableReasons: new Map([[BELTS[3].name, reason]]),
    })
    const chip = wrapper.findAll('.map-chip')
      .find((c) => c.attributes('aria-label')?.includes('practising'))
    // The pill and the action can no longer disagree about why.
    expect(chip).toBeDefined()
    expect(chip!.attributes('disabled')).toBeDefined()
    expect(chip!.attributes('title')).toBe(reason)
  })

  it('leaves the belts we DO have on the device fully tappable', async () => {
    const wrapper = render({
      isOffline: true,
      offlineUnavailableBeltNames: unreachable,
    })
    const chip = wrapper.findAll('.map-chip')
      .find((c) => c.attributes('aria-label') === `Jump to ${BELTS[2].name} belt`)!
    expect(chip.attributes('disabled')).toBeUndefined()
    await chip.trigger('click')
    expect(wrapper.emitted('skipToBelt')).toHaveLength(1)
  })
})
