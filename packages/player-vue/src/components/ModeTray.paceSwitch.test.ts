import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ModeTray from './ModeTray.vue'

// The pace control is an ON/OFF STYLE SWITCH (Aran, 2026-08-06): two states,
// one tap to flip, and it must be obvious which state is live. Explicitly NOT
// a picker, a segmented radiogroup, a dropdown, or a settings-page item.

const openTray = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(ModeTray, { props: { learningMode: 'fast', ...props } })
  await wrapper.get('.mode-trigger').trigger('click')
  return wrapper
}

const paceSwitch = (wrapper: any) => wrapper.get('[role="switch"]')

describe('ModeTray — the Easy/Fast pace switch', () => {
  it('is a switch, not a radiogroup or a picker', async () => {
    const wrapper = await openTray()
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(false)
    expect(wrapper.find('[role="radio"]').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.findAll('[role="switch"]')).toHaveLength(1)
  })

  it('one tap flips Fast -> Easy', async () => {
    const wrapper = await openTray({ learningMode: 'fast' })
    await paceSwitch(wrapper).trigger('click')
    expect(wrapper.emitted('setLearningMode')?.[0]).toEqual(['easy'])
  })

  it('one tap flips Easy -> Fast', async () => {
    const wrapper = await openTray({ learningMode: 'easy' })
    await paceSwitch(wrapper).trigger('click')
    expect(wrapper.emitted('setLearningMode')?.[0]).toEqual(['fast'])
  })

  it('shows which state is live — both words, the active one marked', async () => {
    const fast = await openTray({ learningMode: 'fast' })
    expect(paceSwitch(fast).attributes('aria-checked')).toBe('true')
    expect(fast.get('.pace-switch').text()).toContain('Easy')
    expect(fast.get('.pace-switch').text()).toContain('Fast')
    expect(fast.get('.pace-word.on').text()).toBe('Fast')

    const easy = await openTray({ learningMode: 'easy' })
    expect(paceSwitch(easy).attributes('aria-checked')).toBe('false')
    expect(easy.get('.pace-word.on').text()).toBe('Easy')
  })

  it('is unavailable while listening or pronunciation play is running', async () => {
    const wrapper = await openTray({ isListeningMode: true })
    expect(paceSwitch(wrapper).attributes('disabled')).toBeDefined()
  })
})
