/**
 * IndividualAccessForm — the person-first grant. What matters is the shape of
 * the POST it sends to /api/entitlement/create, because that is what scopes
 * the grant: which courses, for how long, and how many sign-ups the link is
 * good for (max_uses, enforced atomically in api/code/redeem.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import IndividualAccessForm from './IndividualAccessForm.vue'

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getClient: () => ({
      from: () => ({
        select: () => ({
          order: async () => ({
            data: [
              { course_code: 'cym_for_eng', display_name: 'Welsh', known_lang: 'en', target_lang: 'cy' },
              { course_code: 'spa_for_eng', display_name: 'Spanish', known_lang: 'en', target_lang: 'es' },
            ],
            error: null,
          }),
        }),
      }),
    }),
    getAuthToken: async () => 'test-token',
  }),
}))

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ code: 'ABC-123', id: 'ent-1' }) }))
  vi.stubGlobal('fetch', fetchMock)
})

function bodyOfLastPost(): any {
  const calls = fetchMock.mock.calls
  return JSON.parse(calls[calls.length - 1][1].body)
}

async function mountForm() {
  const wrapper = mount(IndividualAccessForm)
  await flushPromises()
  return wrapper
}

describe('IndividualAccessForm', () => {
  it('refuses to mint without a name — the grant must be findable afterwards', async () => {
    const wrapper = await mountForm()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defaults to one sign-up, so a link for one person lets in one person', async () => {
    const wrapper = await mountForm()
    await wrapper.findAll('input[type="text"]')[0].setValue('Angharad')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/entitlement/create', expect.objectContaining({ method: 'POST' }))
    expect(bodyOfLastPost()).toMatchObject({
      access_type: 'full',
      duration_type: 'lifetime',
      label: 'Angharad',
      max_uses: 1,
      metadata: { recipient_name: 'Angharad' },
    })
  })

  it('sends the redeem cap the admin typed, and blank means unlimited', async () => {
    const wrapper = await mountForm()
    await wrapper.findAll('input[type="text"]')[0].setValue('Press pass')
    await wrapper.findAll('input[type="number"]')[0].setValue(25)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(bodyOfLastPost().max_uses).toBe(25)

    await wrapper.findAll('input[type="text"]')[0].setValue('Open link')
    await wrapper.findAll('input[type="number"]')[0].setValue('')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(bodyOfLastPost()).not.toHaveProperty('max_uses')
  })

  it('scopes to chosen courses and a day count when asked', async () => {
    const wrapper = await mountForm()
    await wrapper.findAll('input[type="text"]')[0].setValue('Sioned')
    const selects = wrapper.findAll('select')
    await selects[1].setValue('courses')       // Access
    await selects[2].setValue('time_limited')  // For how long
    await flushPromises()

    // Duration days is the first number input once it appears, ahead of sign-ups.
    const numbers = wrapper.findAll('input[type="number"]')
    await numbers[0].setValue(90)

    // CoursePicker only lists courses once its search input has focus.
    await wrapper.find('.course-picker input[type="text"]').trigger('focus')
    const courseOptions = wrapper.findAll('.course-option')
      .filter(o => o.text().includes('cym_for_eng'))
    expect(courseOptions.length).toBe(1)
    await courseOptions[0].trigger('click')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(bodyOfLastPost()).toMatchObject({
      access_type: 'courses',
      granted_courses: ['cym_for_eng'],
      duration_type: 'time_limited',
      duration_days: 90,
    })
  })

  it('will not mint a course-scoped grant with no courses picked', async () => {
    const wrapper = await mountForm()
    await wrapper.findAll('input[type="text"]')[0].setValue('Nobody')
    await wrapper.findAll('select')[1].setValue('courses')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes a platform role through only when one is chosen', async () => {
    const wrapper = await mountForm()
    await wrapper.findAll('input[type="text"]')[0].setValue('Tom')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(bodyOfLastPost()).not.toHaveProperty('grants_platform_role')

    await wrapper.findAll('input[type="text"]')[0].setValue('Tom')
    await wrapper.findAll('select')[0].setValue('ssi_admin')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(bodyOfLastPost().grants_platform_role).toBe('ssi_admin')
  })

  it('shows the redeem link once the code is minted', async () => {
    const wrapper = await mountForm()
    await wrapper.findAll('input[type="text"]')[0].setValue('Angharad')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.html()).toContain('ABC-123')
  })
})
