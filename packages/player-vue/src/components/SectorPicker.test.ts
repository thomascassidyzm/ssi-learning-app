// The sector-walk picker: walk, then the part you play.
//
// Three things are pinned here because they are rulings, not preferences:
// an empty list is a first-class screen and not an error, general is chosen for
// you even when it is the only role, and a walk that has not opened yet says
// what it opens after using the anchor's OWN CONTENT in both languages — never
// a number, never the words "seed" or "lego".
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SectorPicker from './SectorPicker.vue'

const health = {
  slug: 'health',
  sectorCourseCode: 'spa_health_gen_for_eng',
  roles: ['general'],
  status: 'live' as const,
  anchor: { legoId: 'S0084L01', known: 'I want to speak', target: 'quiero hablar' },
}

describe('SectorPicker', () => {
  let mounted: ReturnType<typeof mount> | null = null

  afterEach(() => {
    mounted?.unmount()
    mounted = null
    document.body.innerHTML = ''
  })

  const open = (props: Record<string, unknown> = {}) => {
    const wrapper = mount(SectorPicker, {
      props: { open: true, sectors: [], ...props },
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    })
    mounted = wrapper
    return wrapper
  }

  it('shows the honest empty state when there are no walks', () => {
    const wrapper = open({ sectors: [] })
    expect(wrapper.find('.sector-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('Nothing here yet for this language')
    expect(wrapper.text()).toContain('Your course carries on as normal')
    // Not an error: no retry, no alarm.
    expect(wrapper.find('.sector-retry').exists()).toBe(false)
  })

  it('hides walks that are still being written', () => {
    const wrapper = open({ sectors: [{ ...health, status: 'draft' }] })
    expect(wrapper.find('.sector-empty').exists()).toBe(true)
  })

  it('preselects general on the role step, even as the only role', async () => {
    const wrapper = open({ sectors: [health], coreHighestLegoId: 'S0090L01' })
    await wrapper.get('.sector-walk').trigger('click')
    const roles = wrapper.findAll('.sector-role')
    expect(roles).toHaveLength(1)
    expect(roles[0].text()).toContain('General')
    expect(roles[0].classes()).toContain('chosen')

    await wrapper.get('.sector-start').trigger('click')
    expect(wrapper.emitted('choose')?.[0]).toEqual([
      { slug: 'health', sectorCourseCode: 'spa_health_gen_for_eng', role: 'general' },
    ])
  })

  it('renders the anchor content, and no digits, for a walk not yet reached', () => {
    const wrapper = open({ sectors: [health], coreHighestLegoId: 'S0012L02' })
    const gate = wrapper.get('.sector-walk-gate')
    expect(gate.text()).toContain('Opens after')
    expect(gate.text()).toContain('I want to speak')
    expect(gate.text()).toContain('quiero hablar')
    expect(gate.text()).not.toMatch(/\d/)
    expect(gate.text().toLowerCase()).not.toContain('seed')
    expect(gate.text().toLowerCase()).not.toContain('lego')
  })

  it('says nothing about opening once the core position has reached the anchor', () => {
    const wrapper = open({ sectors: [health], coreHighestLegoId: 'S0084L01' })
    expect(wrapper.find('.sector-walk-gate').exists()).toBe(false)
  })

  it('a walk is still selectable before it opens', async () => {
    const wrapper = open({ sectors: [health], coreHighestLegoId: null })
    await wrapper.get('.sector-walk').trigger('click')
    expect(wrapper.find('.sector-role').exists()).toBe(true)
  })

  it('offers a retry when the load failed', async () => {
    const wrapper = open({ sectors: [], error: 'boom' })
    expect(wrapper.text()).toContain('That did not load')
    await wrapper.get('.sector-retry').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('the back arrow returns to the walk list', async () => {
    const wrapper = open({ sectors: [health] })
    await wrapper.get('.sector-walk').trigger('click')
    await wrapper.get('.sector-picker-back').trigger('click')
    expect(wrapper.find('.sector-walk').exists()).toBe(true)
  })

  it('closes on the close button', async () => {
    const wrapper = open({ sectors: [health] })
    await wrapper.get('.sector-picker-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
