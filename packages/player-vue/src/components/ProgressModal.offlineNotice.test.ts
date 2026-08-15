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
