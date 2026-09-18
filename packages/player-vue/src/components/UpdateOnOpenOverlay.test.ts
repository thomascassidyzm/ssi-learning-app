/**
 * The screen Tom asked for: "is there a way we could let the user know what's
 * happening?" (2026-09-18). These cases are that sentence, asserted — the app
 * says what it is doing, holds while it does it, and says nothing at all when
 * there is nothing to say.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import UpdateOnOpenOverlay from './UpdateOnOpenOverlay.vue'
import { updateHolding, updateSlow, __resetGateForTest } from '@/composables/useOpenUpdateGate'
import eng from '@/locales/eng.json'

// Teleport targets need a real body node to land in; happy-dom gives us one.
function mountOverlay() {
  return mount(UpdateOnOpenOverlay, { attachTo: document.body })
}

describe('UpdateOnOpenOverlay', () => {
  let wrapper: ReturnType<typeof mount> | null = null

  beforeEach(() => { __resetGateForTest() })
  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    __resetGateForTest()
    document.body.innerHTML = ''
  })

  it('renders NOTHING when no update is being taken — no update, no UI', () => {
    wrapper = mountOverlay()
    expect(document.body.textContent).not.toContain(eng.update.updatingTitle)
  })

  it('says what it is doing, in the interface language, while the update is taken', async () => {
    wrapper = mountOverlay()
    updateHolding.value = true
    await wrapper.vm.$nextTick()
    expect(document.body.textContent).toContain(eng.update.updatingTitle)
    expect(document.body.textContent).toContain(eng.update.updatingBody)
    // Nothing to tap yet: the update is expected to take seconds, and a button
    // offered immediately reads as a failure that has not happened.
    expect(document.body.textContent).not.toContain(eng.update.reloadNow)
  })

  it('admits it is slow and offers a way out once the hold has run long', async () => {
    wrapper = mountOverlay()
    updateHolding.value = true
    updateSlow.value = true
    await wrapper.vm.$nextTick()
    expect(document.body.textContent).toContain(eng.update.updatingSlow)
    expect(document.body.textContent).toContain(eng.update.keepWaiting)
    expect(document.body.textContent).toContain(eng.update.reloadNow)
  })

  it('"Keep waiting" takes the buttons away again rather than ending the hold', async () => {
    wrapper = mountOverlay()
    updateHolding.value = true
    updateSlow.value = true
    await wrapper.vm.$nextTick()
    const keep = document.querySelector<HTMLButtonElement>('.ssi-open-update-secondary')
    expect(keep).not.toBeNull()
    keep!.click()
    await wrapper.vm.$nextTick()
    expect(updateSlow.value).toBe(false)
    expect(updateHolding.value).toBe(true)
    expect(document.body.textContent).toContain(eng.update.updatingBody)
  })

  it('covers the screen, so no tap lands on a document that is about to be replaced', async () => {
    wrapper = mountOverlay()
    updateHolding.value = true
    await wrapper.vm.$nextTick()
    const overlay = document.querySelector('.ssi-open-update')
    expect(overlay).not.toBeNull()
  })
})
