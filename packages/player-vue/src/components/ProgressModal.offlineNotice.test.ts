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
import { t } from '@/composables/useI18n'
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
 * NAVIGATION IS NEVER REFUSED. Tom, 2026-09-04: "user nav overrides everything
 * - there's never any restrictions to where a user can go in the course, back
 * and forth - the only issue is if the content has donwloaded."
 *
 * This block used to assert the OPPOSITE — that a belt the device has not got
 * is disabled and swallows the tap ("THE WALK INTO NOTHING", from Tom's
 * 2026-08-31 note). That ruling is superseded, and these assertions are
 * deliberately flipped rather than deleted, because the flip is the change:
 * every chip emits, and a belt still coming down says so instead of refusing.
 */
describe('ProgressModal — a belt still on its way is tappable and says so', () => {
  const stillComing = new Set([BELTS[3].name])
  // The chip names its belt in the INTERFACE language (belt.label +
  // belt.<colour>), not by the raw internal name — so "Green Belt", not
  // "green belt". Built from the same keys the component uses so this reads
  // the same way in any locale the suite might run under.
  const label = (name: string) =>
    t('belt.label', '{color} Belt').replace('{color}', t(`belt.${name}`, name))

  it('leaves the chip enabled and emits the jump', async () => {
    const wrapper = render({
      isOffline: true,
      beltsAwaitingDownload: stillComing,
    })
    const chip = wrapper.findAll('.map-chip')
      .find((c) => c.attributes('aria-label')?.startsWith(label(BELTS[3].name)))!
    expect(chip.attributes('disabled')).toBeUndefined()
    // It explains itself as a WAITING state, never as a refusal — and in the
    // shared self-resolving vocabulary (it "comes through"; nothing claims a
    // transfer the app cannot verify is happening).
    expect(chip.attributes('aria-label')).toMatch(/isn't on this device yet/)
    await chip.trigger('click')
    expect(wrapper.emitted('skipToBelt')).toHaveLength(1)
  })

  it('shows the waiting line the ACTION would give, when one is supplied', async () => {
    const reason = "Green Belt isn't on this device yet — it'll open as soon as it comes through"
    const wrapper = render({
      isOffline: true,
      beltsAwaitingDownload: stillComing,
      beltWaitingReasons: new Map([[BELTS[3].name, reason]]),
    })
    const chip = wrapper.findAll('.map-chip')
      .find((c) => c.attributes('title') === reason)
    // The pill and the action can no longer disagree about what they say.
    expect(chip).toBeDefined()
    expect(chip!.attributes('disabled')).toBeUndefined()
  })

  it('leaves the belts we DO have on the device fully tappable', async () => {
    const wrapper = render({
      isOffline: true,
      beltsAwaitingDownload: stillComing,
    })
    const chip = wrapper.findAll('.map-chip')
      .find((c) => c.attributes('aria-label') === `Jump to ${label(BELTS[2].name)}`)!
    expect(chip.attributes('disabled')).toBeUndefined()
    await chip.trigger('click')
    expect(wrapper.emitted('skipToBelt')).toHaveLength(1)
  })

  it('lets the learner re-tap the belt they are already on — that is a restart', async () => {
    const wrapper = render({ isOffline: false })
    const chip = wrapper.findAll('.map-chip')
      .find((c) => c.attributes('aria-label') === `Jump to ${label(BELTS[0].name)}`)!
    expect(chip.attributes('disabled')).toBeUndefined()
    await chip.trigger('click')
    expect(wrapper.emitted('skipToBelt')).toHaveLength(1)
  })
})

/**
 * THE PADLOCK MEANS ENTITLEMENT, AND NOTHING ELSE. Tom, 2026-09-04: "The only
 * reason these would be locked would be if there was a [plain] entitlement
 * issue. Because not reachable because not downloaded - / These should be just
 * greyed out - never locked". Would money fix it? Padlock. Would time fix it?
 * Not a padlock.
 */
describe('ProgressModal — the belt-strip padlock', () => {
  const chipFor = (wrapper: ReturnType<typeof render>, name: string) =>
    wrapper.findAll('.map-chip').find((c) => c.attributes('aria-label')?.includes(
      t('belt.label', '{color} Belt').replace('{color}', t(`belt.${name}`, name)),
    ))!

  it('draws a padlock on a belt that needs paying for', () => {
    const wrapper = render({ paywalledBeltNames: new Set([BELTS[2].name]) })
    expect(chipFor(wrapper, BELTS[2].name).find('.map-chip-lock').exists()).toBe(true)
    // …and on nothing else.
    expect(chipFor(wrapper, BELTS[1].name).find('.map-chip-lock').exists()).toBe(false)
  })

  it('NEVER draws a padlock on a belt that is merely still downloading', () => {
    const wrapper = render({ isOffline: true, beltsAwaitingDownload: new Set([BELTS[3].name]) })
    const chip = chipFor(wrapper, BELTS[3].name)
    expect(chip.find('.map-chip-lock').exists()).toBe(false)
    // It gets the three-channel affordance instead: dashed/unfilled/dim + arrow.
    expect(chip.classes()).toContain('is-offline')
    expect(chip.find('.map-chip-dl').exists()).toBe(true)
  })

  it('leaves a padlocked chip tappable — the tap is what opens the paywall', async () => {
    const wrapper = render({ paywalledBeltNames: new Set([BELTS[2].name]) })
    const chip = chipFor(wrapper, BELTS[2].name)
    expect(chip.attributes('disabled')).toBeUndefined()
    expect(chip.attributes('aria-label')).toMatch(/tap to see the options/)
    await chip.trigger('click')
    expect(wrapper.emitted('skipToBelt')).toHaveLength(1)
  })

  it('unpaid AND undownloaded wears the padlock: money is the binding answer', () => {
    const wrapper = render({
      isOffline: true,
      paywalledBeltNames: new Set([BELTS[4].name]),
      beltsAwaitingDownload: new Set([BELTS[4].name]),
    })
    const chip = chipFor(wrapper, BELTS[4].name)
    expect(chip.find('.map-chip-lock').exists()).toBe(true)
    expect(chip.find('.map-chip-dl').exists()).toBe(false)
    expect(chip.classes()).not.toContain('is-offline')
  })

  it('a course with nothing behind a paywall wears no padlock at all', () => {
    const wrapper = render({})
    expect(wrapper.findAll('.map-chip-lock')).toHaveLength(0)
  })
})

/**
 * ONE CONDITION, ONE PROMISE — the belt panel's display grammar.
 *
 * "New content is unreachable right now" can be on screen twice at once: the
 * infinite-play note (player.offlinePracticeBody, Tom's sentence) and the
 * belt-strip hint (progress.offlineBeltsReadyUpTo). On 2026-09-04 the two
 * disagreed about the remedy — one said "can't reach new items", the other
 * said "the rest open as they download", a transfer-progress claim the app
 * cannot verify while nothing is reachable. The grammar rule: every sentence
 * about a self-resolving state promises the SAME resolution, in the same
 * vocabulary — "it comes through when we can reach it" — and never claims
 * active progress. These tests pin both halves.
 */
describe('ProgressModal — the offline sentences make one promise', () => {
  const engAny = eng as Record<string, any>
  const PROMISE = 'as soon as we can reach them'

  it('the infinite-play note and the belt-strip hint share the promise clause', () => {
    expect(engAny.player.offlinePracticeBody).toContain(PROMISE)
    expect(engAny.progress.offlineBeltsReadyUpTo).toContain(PROMISE)
  })

  it('renders both lines together without contradiction when infplay is offline with belts still to come', () => {
    const wrapper = render({
      isInfplay: true,
      isOffline: true,
      beltsAwaitingDownload: new Set([BELTS[5].name, BELTS[6].name]),
    })
    const text = wrapper.text()
    // Both renderings of the condition are on screen…
    expect(text).toContain(engAny.player.offlinePracticeBody)
    expect(text).toContain('are on this device')
    // …and each promises the same self-resolution.
    expect(text.split(PROMISE).length - 1).toBeGreaterThanOrEqual(2)
  })

  it('waiting-state copy never claims a transfer the app cannot verify', () => {
    // Scoped to the five waiting-state keys, deliberately: genuine download
    // UI (the offline bulk download, which HAS a progress ring) may say
    // "downloading"; a belt the app merely cannot reach may not.
    const waitingCopy = [
      engAny.progress.offlineBeltsReadyUpTo,
      engAny.progress.beltStillDownloading,
      engAny.progress.beltsStillDownloading,
      engAny.player.beltStillDownloading,
      engAny.player.contentStillDownloading,
    ]
    for (const line of waitingCopy) {
      expect(line).toBeTruthy()
      expect(line.toLowerCase()).not.toContain('download')
    }
  })
})
