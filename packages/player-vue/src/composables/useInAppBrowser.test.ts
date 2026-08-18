/**
 * The in-app browser's whole job is deciding, per host, whether a link opens
 * inside the app or hands off to a real browser tab — and never leaving the
 * learner on a silent blank sheet. These tests pin both halves of that, plus
 * the framing-refused fallback path.
 *
 * The host expectations below are anchored to live headers checked 2026-08-18
 * (see the composable's header comment). If SSi's headers change, the fix is to
 * change the allowlist and these tests together.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import InAppBrowser from '../components/InAppBrowser.vue'
import {
  canFrame,
  hostLabel,
  openInApp,
  closeInApp,
  markLoadFailed,
  escapeToBrowser,
  useInAppBrowser,
  FRAME_LOAD_TIMEOUT_MS,
} from './useInAppBrowser'

describe('canFrame — the host allowlist', () => {
  it('frames the marketing site, which sends no X-Frame-Options', () => {
    expect(canFrame('https://www.saysomethingin.com/')).toBe(true)
    expect(canFrame('https://saysomethingin.com/wp/en/community/')).toBe(true)
  })

  it('refuses hosts that send X-Frame-Options: SAMEORIGIN', () => {
    expect(canFrame('https://en.saysomethingin.com/welsh/level1/intro')).toBe(false)
    expect(canFrame('https://en.forum.saysomethingin.com/')).toBe(false)
  })

  it('refuses an unknown host — the safe default is to not frame', () => {
    expect(canFrame('https://example.com/')).toBe(false)
  })

  it('refuses anything that is not https, and anything unparseable', () => {
    expect(canFrame('http://www.saysomethingin.com/')).toBe(false)
    expect(canFrame('mailto:admin@saysomethingin.com')).toBe(false)
    expect(canFrame('')).toBe(false)
  })
})

describe('hostLabel', () => {
  it('drops the www so the header reads as the brand', () => {
    expect(hostLabel('https://www.saysomethingin.com/anything')).toBe('saysomethingin.com')
    expect(hostLabel('https://en.forum.saysomethingin.com/')).toBe('en.forum.saysomethingin.com')
  })
})

describe('openInApp', () => {
  let openSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    closeInApp()
    openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })
  afterEach(() => {
    openSpy.mockRestore()
    closeInApp()
  })

  it('opens a frameable page in the overlay and never touches window.open', () => {
    const { target } = useInAppBrowser()
    expect(openInApp('https://www.saysomethingin.com/', 'SaySomethingin')).toBe('in-app')
    expect(target.value).toEqual({ url: 'https://www.saysomethingin.com/', title: 'SaySomethingin' })
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('falls back to the host when no title is given', () => {
    const { target } = useInAppBrowser()
    openInApp('https://www.saysomethingin.com/')
    expect(target.value?.title).toBe('saysomethingin.com')
  })

  it('hands a frame-refusing host straight to a real browser tab, opening no empty sheet', () => {
    const { target } = useInAppBrowser()
    expect(openInApp('https://en.forum.saysomethingin.com/', 'Forum')).toBe('external')
    expect(target.value).toBeNull()
    expect(openSpy).toHaveBeenCalledWith(
      'https://en.forum.saysomethingin.com/',
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('closeInApp clears the overlay and the failure state', () => {
    const { target, loadFailed } = useInAppBrowser()
    openInApp('https://www.saysomethingin.com/')
    markLoadFailed()
    expect(loadFailed.value).toBe(true)
    closeInApp()
    expect(target.value).toBeNull()
    expect(loadFailed.value).toBe(false)
  })

  it('markLoadFailed does nothing when nothing is open', () => {
    const { loadFailed } = useInAppBrowser()
    markLoadFailed()
    expect(loadFailed.value).toBe(false)
  })

  it('escapeToBrowser closes the sheet and opens the page properly', () => {
    const { target } = useInAppBrowser()
    openInApp('https://www.saysomethingin.com/')
    escapeToBrowser()
    expect(target.value).toBeNull()
    expect(openSpy).toHaveBeenCalledWith(
      'https://www.saysomethingin.com/',
      '_blank',
      'noopener,noreferrer',
    )
  })
})

describe('InAppBrowser overlay', () => {
  beforeEach(() => {
    closeInApp()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    closeInApp()
  })

  it('renders nothing until a page is opened', () => {
    const wrapper = mount(InAppBrowser)
    expect(wrapper.find('.iab-sheet').exists()).toBe(false)
  })

  it('shows the sheet with the page framed, and closes on the close button', async () => {
    const wrapper = mount(InAppBrowser)
    openInApp('https://www.saysomethingin.com/', 'SaySomethingin')
    await nextTick()

    expect(wrapper.find('.iab-sheet').exists()).toBe(true)
    expect(wrapper.find('.iab-title').text()).toBe('SaySomethingin')
    expect(wrapper.find('iframe').attributes('src')).toBe('https://www.saysomethingin.com/')
    expect(wrapper.find('.iab-fallback').exists()).toBe(false)

    await wrapper.find('.iab-close').trigger('click')
    await nextTick()
    expect(wrapper.find('.iab-sheet').exists()).toBe(false)
  })

  it('degrades to an honest way out when the frame never loads', async () => {
    const wrapper = mount(InAppBrowser)
    openInApp('https://www.saysomethingin.com/', 'SaySomethingin')
    await nextTick()
    expect(wrapper.find('.iab-fallback').exists()).toBe(false)

    vi.advanceTimersByTime(FRAME_LOAD_TIMEOUT_MS + 1)
    await nextTick()

    const fallback = wrapper.find('.iab-fallback')
    expect(fallback.exists()).toBe(true)
    expect(fallback.text()).toContain('opens in your browser')
  })

  it('does not degrade when the frame loads in time', async () => {
    const wrapper = mount(InAppBrowser)
    openInApp('https://www.saysomethingin.com/', 'SaySomethingin')
    await nextTick()

    await wrapper.find('iframe').trigger('load')
    vi.advanceTimersByTime(FRAME_LOAD_TIMEOUT_MS + 1)
    await nextTick()

    expect(wrapper.find('.iab-fallback').exists()).toBe(false)
  })

  it('the fallback tap-through opens the real browser and closes the sheet', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = mount(InAppBrowser)
    openInApp('https://www.saysomethingin.com/', 'SaySomethingin')
    await nextTick()
    vi.advanceTimersByTime(FRAME_LOAD_TIMEOUT_MS + 1)
    await nextTick()

    await wrapper.find('.iab-fallback-btn').trigger('click')
    await nextTick()

    expect(openSpy).toHaveBeenCalledWith(
      'https://www.saysomethingin.com/',
      '_blank',
      'noopener,noreferrer',
    )
    expect(wrapper.find('.iab-sheet').exists()).toBe(false)
    openSpy.mockRestore()
  })

  it('Escape closes the sheet — a guaranteed exit that does not depend on the page loading', async () => {
    const wrapper = mount(InAppBrowser)
    openInApp('https://www.saysomethingin.com/', 'SaySomethingin')
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.find('.iab-sheet').exists()).toBe(false)
  })
})
