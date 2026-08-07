// A tap ANYWHERE outside the mode tray closes it.
//
// Tom reported this ~10 times: with the tray open, the only way to close it was
// the trigger button again. The backdrop element looked like it handled this
// (`position: fixed; inset: 0`) but .bottom-nav's `transform: translateX(-50%)`
// makes it the containing block for fixed descendants, so the "full-screen"
// backdrop only ever covered the nav pill. The dismiss now lives on a
// document-level pointerdown listener, which no containing block can shrink —
// these tests pin that behaviour, including the close-then-reopen race and the
// swallowed follow-up click.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ModeTray from './ModeTray.vue'

// Transitions stay stubbed (test-utils' default): jsdom never fires
// transitionend, so a real <Transition> would leave the tray in the DOM after
// close and every assertion below would read the wrong thing.
const pointerDownOn = (el: Element) =>
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }))

describe('ModeTray outside-tap dismiss', () => {
  let outside: HTMLElement
  let mounted: ReturnType<typeof mount> | null = null

  beforeEach(() => {
    outside = document.createElement('button')
    outside.id = 'somewhere-else'
    document.body.appendChild(outside)
  })

  // Unmount between tests: a live tray keeps document listeners, and a pending
  // click-swallow would eat the next test's first tap.
  afterEach(() => {
    mounted?.unmount()
    mounted = null
    outside.remove()
    document.body.innerHTML = ''
  })

  const openTray = async () => {
    const wrapper = mount(ModeTray, { attachTo: document.body })
    mounted = wrapper
    await wrapper.get('.mode-trigger').trigger('click')
    expect(wrapper.find('.mode-tray').exists()).toBe(true)
    return wrapper
  }

  it('closes on a pointerdown far outside the tray and its trigger', async () => {
    const wrapper = await openTray()
    pointerDownOn(outside)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mode-tray').exists()).toBe(false)
  })

  it('closes on a pointerdown on the document body itself', async () => {
    const wrapper = await openTray()
    pointerDownOn(document.body)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mode-tray').exists()).toBe(false)
  })

  it('does not close on a pointerdown inside the tray', async () => {
    const wrapper = await openTray()
    pointerDownOn(wrapper.get('.mode-tray').element)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mode-tray').exists()).toBe(true)
  })

  // The classic backdrop-dismiss race: outside-close fires, then the trigger's
  // own click re-opens what was just closed. The trigger is INSIDE the watched
  // root, so its pointerdown is ignored and only its click toggles.
  it('the trigger still closes the tray — it never closes-then-reopens', async () => {
    const wrapper = await openTray()
    const trigger = wrapper.get('.mode-trigger')
    pointerDownOn(trigger.element)
    await trigger.trigger('click')
    expect(wrapper.find('.mode-tray').exists()).toBe(false)
  })

  it('reopens normally after an outside tap closed it', async () => {
    const wrapper = await openTray()
    pointerDownOn(outside)
    await wrapper.vm.$nextTick()
    await wrapper.get('.mode-trigger').trigger('click')
    expect(wrapper.find('.mode-tray').exists()).toBe(true)
  })

  // Dismissing must not double as a tap on whatever was underneath — mid-session
  // that is the transport, and an accidental pause is exactly the kind of thing
  // that reads as a new bug.
  it('swallows the click the dismissing press produces', async () => {
    const wrapper = await openTray()
    let clicked = 0
    outside.addEventListener('click', () => { clicked++ })
    pointerDownOn(outside)
    await wrapper.vm.$nextTick()
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicked).toBe(0)

    // …and only that one click: the next tap on the same control works.
    outside.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(clicked).toBe(1)
  })

  it('closes on Escape', async () => {
    const wrapper = await openTray()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.mode-tray').exists()).toBe(false)
  })

  it('unhooks its document listeners on unmount', async () => {
    const wrapper = await openTray()
    wrapper.unmount()
    mounted = null
    // No listener left behind to throw on a null root.
    expect(() => pointerDownOn(document.body)).not.toThrow()
  })
})
