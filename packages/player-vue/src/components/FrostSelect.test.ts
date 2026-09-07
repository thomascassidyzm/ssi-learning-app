/**
 * FrostSelect — the filter affordance.
 *
 * Standing estate rule: dropdowns are always filterable. The school first-time
 * setup shipped a ~74-course list with no search box, which is what this
 * covers. `filterable` is opt-in, so the short-list call sites (insight boards)
 * must keep behaving exactly as they did.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FrostSelect from './FrostSelect.vue'

const OPTIONS = [
  { value: 'cym_north_for_eng', label: 'North Welsh for English Speakers' },
  { value: 'cym_south_for_eng', label: 'South Welsh for English Speakers' },
  { value: 'spa_for_eng', label: 'Spanish for English Speakers' },
  { value: 'jpn_for_eng', label: 'Japanese for English Speakers' },
]

function labels(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.fs-opt-label').map((n) => n.text())
}

describe('FrostSelect filtering', () => {
  it('puts a search box at the top of the open menu and narrows the list as you type', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: OPTIONS, filterable: true },
      attachTo: document.body,
    })

    await wrapper.get('.fs-trigger').trigger('click')
    expect(labels(wrapper)).toHaveLength(4)

    const search = wrapper.get('input.fs-search')
    await search.setValue('welsh')

    expect(labels(wrapper)).toEqual([
      'North Welsh for English Speakers',
      'South Welsh for English Speakers',
    ])
    wrapper.unmount()
  })

  it('selects the row the filter left, not the row that used to sit at that index', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: OPTIONS, filterable: true },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')
    await wrapper.get('input.fs-search').setValue('japanese')
    await wrapper.findAll('.fs-opt')[0].trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['jpn_for_eng'])
    wrapper.unmount()
  })

  it('says so when nothing matches', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: OPTIONS, filterable: true },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')
    await wrapper.get('input.fs-search').setValue('klingon')

    expect(wrapper.findAll('.fs-opt')).toHaveLength(0)
    expect(wrapper.get('.fs-empty').text()).toContain('klingon')
    wrapper.unmount()
  })

  it('shows no search box unless asked — short lists stay as they were', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: 'spa_for_eng', options: OPTIONS },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')

    expect(wrapper.find('input.fs-search').exists()).toBe(false)
    expect(labels(wrapper)).toHaveLength(4)
    wrapper.unmount()
  })
})
