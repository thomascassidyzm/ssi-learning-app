import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import AppEscape from './AppEscape.vue'

// AppEscape defaults to back/home, but an explicit `to` (used by App.vue for
// the schools/tutor staff self-practice escape) must win outright — that
// path can't rely on browser back-history staying intact.

describe('AppEscape', () => {
  async function mountWithRouter(to?: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div/>' } },
        { path: '/schools', component: { template: '<div/>' } },
      ],
    })
    await router.push('/')
    const wrapper = mount(AppEscape, {
      props: to ? { to } : {},
      global: { plugins: [router] },
    })
    return { router, wrapper }
  }

  it('navigates to the explicit `to` target when provided', async () => {
    const { router, wrapper } = await mountWithRouter('/schools')
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/schools')
  })

  it('falls back to router.back()/home when no `to` is given', async () => {
    const { router, wrapper } = await mountWithRouter()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    // No prior history entry beyond the initial push — lands on home.
    expect(router.currentRoute.value.fullPath).toBe('/')
  })
})
