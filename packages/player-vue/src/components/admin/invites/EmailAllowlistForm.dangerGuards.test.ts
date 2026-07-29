import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

// Guard for the bulk allowlist grant — the highest-blast-radius verb in the
// app (docs/admin-danger-verbs.md #5): submit must open a review step showing
// the exact parsed count and emails; only the review's button commits.

vi.mock('@/composables/useUserRole', () => ({
  useUserRole: () => ({ isSsiAdmin: { value: false } }),
}))

vi.mock('@/composables/useAdminClient', () => ({
  useAdminClient: () => ({
    getAuthToken: async () => 'tok-1',
    getClient: () => ({
      from: () => ({
        select: () => ({ order: async () => ({ data: [], error: null }) }),
      }),
    }),
  }),
}))

async function flushPromises() {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('EmailAllowlistForm — bulk grant review step', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/access/grant-emails')) {
        return { ok: true, json: async () => ({ created: 2, applied_now: 1 }) } as any
      }
      return { ok: true, json: async () => ({ grants: [] }) } as any
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  function grantCalls() {
    return fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/access/grant-emails'))
  }

  async function mountForm() {
    const { default: EmailAllowlistForm } = await import('./EmailAllowlistForm.vue')
    const wrapper = mount(EmailAllowlistForm)
    await flushPromises()
    return wrapper
  }

  it('first submit opens a review with the parsed count and emails — no write', async () => {
    const wrapper = await mountForm()

    await wrapper.find('.allowlist-textarea').setValue('alice@example.com\nnot-an-email\nbob@example.com')
    await wrapper.find('form.allowlist-form').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(grantCalls()).toHaveLength(0)

    const review = wrapper.find('.allowlist-review')
    expect(review.exists()).toBe(true)
    expect(review.find('.allowlist-review-headline').text()).toContain('2')
    expect(review.find('.allowlist-review-headline').text()).toContain('immediately')
    const listed = review.findAll('.allowlist-review-list li').map(li => li.text())
    expect(listed).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('the review button commits the grant', async () => {
    const wrapper = await mountForm()

    await wrapper.find('.allowlist-textarea').setValue('alice@example.com, bob@example.com')
    await wrapper.find('form.allowlist-form').trigger('submit')
    await wrapper.vm.$nextTick()

    const commitBtn = wrapper.find('.allowlist-review').findAll('button')
      .find(b => b.text().includes('Grant to 2 emails'))
    expect(commitBtn).toBeTruthy()
    await commitBtn!.trigger('click')
    await flushPromises()

    expect(grantCalls()).toHaveLength(1)
    expect(JSON.parse(grantCalls()[0][1].body).emails).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('editing the paste box resets the review step', async () => {
    const wrapper = await mountForm()

    await wrapper.find('.allowlist-textarea').setValue('alice@example.com')
    await wrapper.find('form.allowlist-form').trigger('submit')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.allowlist-review').exists()).toBe(true)

    await wrapper.find('.allowlist-textarea').setValue('alice@example.com\ncarol@example.com')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.allowlist-review').exists()).toBe(false)
    expect(grantCalls()).toHaveLength(0)
  })

  it('Back to edit closes the review without writing', async () => {
    const wrapper = await mountForm()

    await wrapper.find('.allowlist-textarea').setValue('alice@example.com')
    await wrapper.find('form.allowlist-form').trigger('submit')
    await wrapper.vm.$nextTick()

    const backBtn = wrapper.find('.allowlist-review').findAll('button')
      .find(b => b.text() === 'Back to edit')
    await backBtn!.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.allowlist-review').exists()).toBe(false)
    expect(grantCalls()).toHaveLength(0)
  })
})
