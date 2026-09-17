/**
 * Report a bug in the schools dashboard account menu (Tom, 2026-09-14): the
 * item is there for a school admin and a teacher, opens the dashboard modal,
 * and — since job #68 (Tom, 2026-09-17) — is there UNDER VIEW-AS TOO. It used
 * to be hidden there, so the walkthrough step described a control that was not
 * on screen; the report is the real admin's own note, filed under their own
 * bearer with the persona named on it, so "view-as writes nothing" is not
 * touched. Inbox stays hidden: that is the persona's data.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import router from '@/router/index'
import { useUserRole } from '@/composables/useUserRole'
import { useSchoolContext } from '@/composables/schools/useSchoolContext'
import SchoolsTopBar from './SchoolsTopBar.vue'

describe('SchoolsTopBar — Report a bug in the account menu', () => {
  const role = useUserRole()
  const ctx = useSchoolContext()

  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    role.clear()
    ctx.clear()
    await router.push('/schools')
    await router.isReady()
  })
  afterEach(() => { document.body.innerHTML = '' })

  const admin = {
    user_id: 'admin-1', learner_id: 'l1', display_name: 'Chennai Lead', educational_role: 'school_admin',
    platform_role: null, school_id: 'sch-seaside', school_name: 'Seaside Model School',
  }
  const mountBar = () => mount(SchoolsTopBar, { global: { plugins: [router], provide: { auth: null, supabase: null } } })

  it('a school admin sees Report a bug in the menu and it opens the dashboard modal', async () => {
    role.initialize(null, 'school_admin')
    ;(ctx.currentUser as any).value = admin
    const wrapper = mountBar()
    await wrapper.find('.user-trigger').trigger('click')
    const item = wrapper.find('[data-walk="schools-report-bug"]')
    expect(item.exists()).toBe(true)
    expect(item.text()).toBe('Report a bug')
    await item.trigger('click')
    expect(document.body.querySelector('[data-walk="schools-report-bug-modal"]')).not.toBeNull()
    // The menu closed behind it.
    expect(wrapper.find('.user-menu-pop').exists()).toBe(false)
  })

  it('a teacher sees it too', async () => {
    role.initialize(null, 'teacher')
    ;(ctx.currentUser as any).value = { ...admin, educational_role: 'teacher' }
    const wrapper = mountBar()
    await wrapper.find('.user-trigger').trigger('click')
    expect(wrapper.find('[data-walk="schools-report-bug"]').exists()).toBe(true)
  })

  it('is there while an ssi_admin is viewing-as a school admin, and the Inbox is not', async () => {
    role.initialize('ssi_admin', null)
    ;(role.viewingAs as any).value = { role: 'school_admin', userId: 'admin-1', name: 'Chennai Lead' }
    ;(ctx.currentUser as any).value = admin
    const wrapper = mountBar()
    await wrapper.find('.user-trigger').trigger('click')
    expect(wrapper.find('.user-menu-pop').exists()).toBe(true)
    expect(wrapper.find('[data-walk="schools-report-bug"]').exists()).toBe(true)
    // The persona's own messages stay out of reach.
    expect(wrapper.find('[data-walk="schools-inbox-menu"]').exists()).toBe(false)
  })
})
