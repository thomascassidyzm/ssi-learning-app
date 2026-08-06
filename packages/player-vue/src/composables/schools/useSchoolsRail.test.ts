import { describe, it, expect, beforeEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import router from '@/router/index'
import { useSchoolContext } from './useSchoolContext'
import { setSchoolsClient } from './client'
import { useSchoolsRail, resetSchoolsRail, type SchoolsRailData } from './useSchoolsRail'
import { clearNodeHomeCache, cacheNodeHome } from '@/composables/admin/nodeHomeCache'

// WHERE-YOU-ARE everywhere (founder ruling 2026-07-31: "everyone should know
// where they are in the breadcrumb, even if they can't go UP a level because
// of permissions … I don't like the LHS anchor just disappearing"). This
// composable feeds the rail on the FLAT /schools views: server rail for
// school admins, own-classes rail for teachers (school shown as
// non-interactive context — teachers are 403 on the node endpoints).

const ctx = useSchoolContext()

function harness() {
  let out: { rail: any; eligible: any } | null = null
  const Comp = defineComponent({
    setup() {
      const { rail, eligible } = useSchoolsRail()
      out = { rail, eligible }
      return () => h('div')
    },
  })
  const wrapper = mount(Comp, { global: { plugins: [router] } })
  return { wrapper, get rail(): SchoolsRailData | null { return out!.rail.value }, get eligible(): boolean { return out!.eligible.value } }
}

const fakeAuthedClient = {
  auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
} as any

describe('useSchoolsRail — the rail source for flat /schools views', () => {
  beforeEach(async () => {
    sessionStorage.clear()
    resetSchoolsRail()
    clearNodeHomeCache()
    ctx.clear()
    setSchoolsClient(fakeAuthedClient)
    await router.push('/schools')
    await router.isReady()
  })

  it('teacher: school is the here-node, own classes below opening the flat class pages', async () => {
    ;(ctx.currentUser as any).value = {
      user_id: 't-1', learner_id: 'l1', display_name: 'Asha', educational_role: 'teacher',
      platform_role: null, school_id: 'sch-1', school_name: "St. Mary's Academy Kochi",
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(String(url)).toContain('/api/me/teaching-context')
      return new Response(JSON.stringify({
        groups: [], classes: ['c-1', 'c-2'], can_play_as_class: true,
        groups_detail: [{ id: 'sch-1', label: 'school', name: "St. Mary's Academy Kochi" }],
        classes_detail: [
          { id: 'c-1', name: 'Year 6 French', course_code: 'fra_for_eng' },
          { id: 'c-2', name: 'Year 5 Spanish', course_code: 'spa_for_eng' },
        ],
      }), { status: 200 })
    }))
    const t = harness()
    await flushPromises()
    expect(t.eligible).toBe(true)
    expect(t.rail?.node).toEqual({ id: 'sch-1', name: "St. Mary's Academy Kochi", label: 'school' })
    expect(t.rail?.children).toEqual([
      { id: 'c-1', name: 'Year 6 French', label: 'class', path: '/schools/classes/c-1' },
      { id: 'c-2', name: 'Year 5 Spanish', label: 'class', path: '/schools/classes/c-2' },
    ])
    expect(t.rail?.ancestors).toEqual([])
  })

  it('teacher on a class page: the class is here, the school is NON-INTERACTIVE ancestor context, other classes are siblings', async () => {
    ;(ctx.currentUser as any).value = {
      user_id: 't-1', learner_id: 'l1', display_name: 'Asha', educational_role: 'teacher',
      platform_role: null, school_id: 'sch-1', school_name: "St. Mary's Academy Kochi",
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      groups: [], classes: ['c-1', 'c-2'], can_play_as_class: true,
      groups_detail: [{ id: 'sch-1', label: 'school', name: "St. Mary's Academy Kochi" }],
      classes_detail: [
        { id: 'c-1', name: 'Year 6 French', course_code: 'fra_for_eng' },
        { id: 'c-2', name: 'Year 5 Spanish', course_code: 'spa_for_eng' },
      ],
    }), { status: 200 })))
    await router.push('/schools/classes/c-2')
    const t = harness()
    await flushPromises()
    expect(t.rail?.kind).toBe('class')
    expect(t.rail?.node.name).toBe('Year 5 Spanish')
    expect(t.rail?.ancestors).toEqual([{ id: 'sch-1', name: "St. Mary's Academy Kochi", label: 'school', inert: true }])
    expect(t.rail?.siblings.map((s) => s.id)).toEqual(['c-1'])
  })

  it('groupless teacher (derived tutor): rooted at their own classes — the top visible level', async () => {
    ;(ctx.currentUser as any).value = {
      user_id: 't-2', learner_id: 'l2', display_name: 'Solo', educational_role: 'tutor', platform_role: null,
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      groups: [], classes: ['c-9'], can_play_as_class: true,
      groups_detail: [],
      classes_detail: [{ id: 'c-9', name: 'Evening Welsh', course_code: 'cym_for_eng' }],
    }), { status: 200 })))
    const t = harness()
    await flushPromises()
    expect(t.eligible).toBe(true)
    expect(t.rail?.node.name).toBe('Your classes')
    expect(t.rail?.children.map((c) => c.id)).toEqual(['c-9'])
  })

  it('school_admin: fetches the school node rail from /api/groups/:id/home and shares it through nodeHomeCache', async () => {
    ;(ctx.currentUser as any).value = {
      user_id: 'a-1', learner_id: 'l3', display_name: 'Lead', educational_role: 'school_admin',
      platform_role: null, school_id: 'sch-1', school_name: "St. Mary's Academy Kochi",
    }
    const payload = {
      kind: 'node',
      node: { id: 'sch-1', name: "St. Mary's Academy Kochi", label: 'school' },
      ancestors: [{ id: 'g-1', name: 'Pilot Districts Region', label: 'group' }],
      siblings: [{ id: 'sch-2', name: 'Sunrise Public School', label: 'school' }],
      children: [{ id: 'c-1', name: 'Year 6 French', label: 'class' }],
    }
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toBe('/api/groups/sch-1/home')
      return new Response(JSON.stringify(payload), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const t = harness()
    await flushPromises()
    expect(t.eligible).toBe(true)
    expect(t.rail?.node.id).toBe('sch-1')
    expect(t.rail?.ancestors.map((a) => a.id)).toEqual(['g-1'])
    expect(t.rail?.children.map((c) => c.id)).toEqual(['c-1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('school_admin with the node already cached (visited the node home): no fetch at all', async () => {
    ;(ctx.currentUser as any).value = {
      user_id: 'a-1', learner_id: 'l3', display_name: 'Lead', educational_role: 'school_admin',
      platform_role: null, school_id: 'sch-1',
    }
    cacheNodeHome('sch-1', {
      kind: 'node',
      node: { id: 'sch-1', name: "St. Mary's Academy Kochi", label: 'school' },
      ancestors: [], siblings: [], children: [],
    }, '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const t = harness()
    await flushPromises()
    expect(t.rail?.node.id).toBe('sch-1')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('govt_admin and role-less users are ineligible — flat views stay full-width', async () => {
    ;(ctx.currentUser as any).value = {
      user_id: 'g-1', learner_id: 'l4', display_name: 'Leader', educational_role: 'govt_admin',
      platform_role: null, group_id: 'grp-1',
    }
    vi.stubGlobal('fetch', vi.fn())
    const t = harness()
    await flushPromises()
    expect(t.eligible).toBe(false)
    expect(t.rail).toBeNull()
  })
})
