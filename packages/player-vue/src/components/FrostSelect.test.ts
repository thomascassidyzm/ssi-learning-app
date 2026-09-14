/**
 * FrostSelect — THE dropdown, and its filter.
 *
 * Tom's ruling (2026-09-14): one dropdown component everywhere, and every
 * dropdown has a type-to-filter box at the top of its open panel, even a
 * short list. Focus lands in that box on open; typing narrows by substring,
 * case-insensitively; Enter picks the highlighted row; Escape closes.
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
  it('always puts a search box at the top of the open menu, focused, and narrows the list as you type', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: OPTIONS },
      attachTo: document.body,
    })

    await wrapper.get('.fs-trigger').trigger('click')
    expect(labels(wrapper)).toHaveLength(4)

    const search = wrapper.get('input.fs-search')
    expect(document.activeElement).toBe(search.element)
    await search.setValue('WELSH')

    expect(labels(wrapper)).toEqual([
      'North Welsh for English Speakers',
      'South Welsh for English Speakers',
    ])
    wrapper.unmount()
  })

  it('shows the search box even on a three-row list', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: 'b', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }] },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')
    expect(wrapper.find('input.fs-search').exists()).toBe(true)
    expect(wrapper.get('.fs-opt.selected .fs-check').text()).toBe('✓')
    wrapper.unmount()
  })

  it('selects the row the filter left, not the row that used to sit at that index', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: OPTIONS },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')
    await wrapper.get('input.fs-search').setValue('japanese')
    await wrapper.findAll('.fs-opt')[0].trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['jpn_for_eng'])
    wrapper.unmount()
  })

  it('Enter picks the highlighted row after typing, Escape closes without picking', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: OPTIONS },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')
    const search = wrapper.get('input.fs-search')
    await search.setValue('south')
    await search.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['cym_south_for_eng'])
    expect(wrapper.find('.fs-panel').exists()).toBe(false)

    await wrapper.get('.fs-trigger').trigger('click')
    await wrapper.get('input.fs-search').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('.fs-panel').exists()).toBe(false)
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
    wrapper.unmount()
  })

  it('skips disabled rows for both arrow keys and clicks', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: [{ value: 'x', label: 'Pick one…', disabled: true }, { value: 'a', label: 'A' }] },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')
    await wrapper.findAll('.fs-opt')[0].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    await wrapper.get('input.fs-search').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['a'])
    wrapper.unmount()
  })

  it('says so when nothing matches', async () => {
    const wrapper = mount(FrostSelect, {
      props: { modelValue: '', options: OPTIONS },
      attachTo: document.body,
    })
    await wrapper.get('.fs-trigger').trigger('click')
    await wrapper.get('input.fs-search').setValue('klingon')

    expect(wrapper.findAll('.fs-opt')).toHaveLength(0)
    expect(wrapper.get('.fs-empty').text()).toContain('klingon')
    wrapper.unmount()
  })
})
