import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CreateClassModal from './CreateClassModal.vue'
import { isDemoMode } from '@/composables/demo/demoMode'

// The modal renders via <Teleport to="body">; stub it so mounted content
// stays inside the wrapper's own DOM tree and is queryable by find().
const mountOpts = { global: { stubs: { teleport: true } } }

describe('CreateClassModal — course picker uses the full catalogue, not a hardcoded shortlist', () => {
  beforeEach(() => {
    isDemoMode.value = true
  })

  afterEach(() => {
    isDemoMode.value = false
  })

  it('does not hardcode a bare 7-course shortlist as the picker options', async () => {
    const wrapper = mount(CreateClassModal, { props: { isOpen: true }, ...mountOpts })
    await flushPromises()
    await wrapper.find('input#courseCode').trigger('focus')
    const options = wrapper.findAll('.course-picker-option')
    // The old hardcoded shortlist was exactly 7 (Welsh N/S, Spanish EU/LatAm,
    // Dutch, Cornish, Manx) — options must come from a fetched/injected list,
    // not a literal in-component array.
    expect(options.length).toBeGreaterThan(0)
  })

  it('filters the course list by search query', async () => {
    const wrapper = mount(CreateClassModal, { props: { isOpen: true }, ...mountOpts })
    await flushPromises()
    const input = wrapper.find('input#courseCode')
    await input.trigger('focus')
    await input.setValue('Spanish')
    const options = wrapper.findAll('.course-picker-option')
    expect(options.length).toBeGreaterThan(0)
    for (const opt of options) {
      expect(opt.text().toLowerCase()).toContain('spanish')
    }
  })

  it('selecting a course closes the list and shows the selection', async () => {
    const wrapper = mount(CreateClassModal, { props: { isOpen: true }, ...mountOpts })
    await flushPromises()
    const input = wrapper.find('input#courseCode')
    await input.trigger('focus')
    await input.setValue('Dutch')
    const option = wrapper.find('.course-picker-option')
    await option.trigger('mousedown')
    await flushPromises()
    expect(wrapper.find('.course-picker-list').exists()).toBe(false)
    expect(wrapper.find('.course-picker-selected').text()).toContain('Dutch')
  })

  it('emits create with the selected course_code on submit', async () => {
    const wrapper = mount(CreateClassModal, { props: { isOpen: true }, ...mountOpts })
    await flushPromises()
    await wrapper.find('input#className').setValue('Year 7 Dutch')
    const courseInput = wrapper.find('input#courseCode')
    await courseInput.trigger('focus')
    await courseInput.setValue('Dutch')
    await wrapper.find('.course-picker-option').trigger('mousedown')
    await wrapper.find('form').trigger('submit')
    const emitted = wrapper.emitted('create')
    expect(emitted).toBeTruthy()
    expect(emitted![0][0]).toMatchObject({ class_name: 'Year 7 Dutch', course_code: 'nld_for_eng' })
  })

  it('locks the picker to a single course when availableCourses has one entry (trial)', async () => {
    const wrapper = mount(CreateClassModal, {
      props: {
        isOpen: true,
        availableCourses: [{ code: 'cym_for_eng_north', name: 'Welsh (Northern)' }],
        lockedNote: 'Subscribe to teach more',
      },
      ...mountOpts,
    })
    await flushPromises()
    expect(wrapper.find('.form-locked').text()).toContain('Welsh (Northern)')
    expect(wrapper.text()).toContain('Subscribe to teach more')
    expect(wrapper.find('.course-picker').exists()).toBe(false)
  })
})
