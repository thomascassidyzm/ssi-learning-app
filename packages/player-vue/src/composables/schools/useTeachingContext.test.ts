/**
 * useTeachingContext — capability gating for the three teacher personas
 * (THE-MODEL.md I4/I5): teacher-with-class, teacher-without-class, and a
 * groupless tutor. canPlayAsClass/isTutor must derive from structure
 * (groups/classes), never from `educational_role`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { useTeachingContext } from './useTeachingContext'
import { useSchoolContext } from './useSchoolContext'

vi.mock('./classTeacherScope', () => ({
  myTaughtClassIds: vi.fn(),
}))

import { myTaughtClassIds } from './classTeacherScope'

function mountHarness() {
  let exposed: ReturnType<typeof useTeachingContext>
  const Harness = defineComponent({
    setup() {
      exposed = useTeachingContext()
      return () => h('div')
    },
  })
  mount(Harness)
  return exposed!
}

function setUser(user: Record<string, unknown> | null) {
  const ctx = useSchoolContext()
  ;(ctx.currentUser as any).value = user
}

describe('useTeachingContext — persona gating', () => {
  beforeEach(() => {
    vi.mocked(myTaughtClassIds).mockReset()
  })

  it('teacher-with-class: has a school AND classes — full experience, not a tutor', async () => {
    setUser({ user_id: 'u1', learner_id: 'l1', display_name: 'T', educational_role: 'teacher', school_id: 's1' })
    vi.mocked(myTaughtClassIds).mockResolvedValue(['c1', 'c2'])
    const ctx = mountHarness()
    await ctx.load()

    expect(ctx.groups.value).toEqual([{ id: 's1', label: 'school' }])
    expect(ctx.classes.value).toEqual(['c1', 'c2'])
    expect(ctx.canPlayAsClass.value).toBe(true)
    expect(ctx.isTutor.value).toBe(false)
  })

  it('teacher-without-class: has a school but zero classes — play-as-class gated off', async () => {
    setUser({ user_id: 'u2', learner_id: 'l2', display_name: 'T', educational_role: 'teacher', school_id: 's1' })
    vi.mocked(myTaughtClassIds).mockResolvedValue([])
    const ctx = mountHarness()
    await ctx.load()

    expect(ctx.canPlayAsClass.value).toBe(false)
    expect(ctx.isTutor.value).toBe(false)
  })

  it('groupless tutor: no school/group affiliation but has classes — same shell, derived tutor', async () => {
    setUser({ user_id: 'u3', learner_id: 'l3', display_name: 'T', educational_role: 'tutor' })
    vi.mocked(myTaughtClassIds).mockResolvedValue(['c9'])
    const ctx = mountHarness()
    await ctx.load()

    expect(ctx.groups.value).toEqual([])
    expect(ctx.canPlayAsClass.value).toBe(true)
    expect(ctx.isTutor.value).toBe(true)
  })

  it('groupless with zero classes: neither a tutor nor able to play-as-class', async () => {
    setUser({ user_id: 'u4', learner_id: 'l4', display_name: 'T', educational_role: null })
    vi.mocked(myTaughtClassIds).mockResolvedValue([])
    const ctx = mountHarness()
    await ctx.load()

    expect(ctx.canPlayAsClass.value).toBe(false)
    expect(ctx.isTutor.value).toBe(false)
  })

  it('no current user: no fetch, empty structure', async () => {
    setUser(null)
    const ctx = mountHarness()
    await ctx.load()

    expect(myTaughtClassIds).not.toHaveBeenCalled()
    expect(ctx.classes.value).toEqual([])
    expect(ctx.canPlayAsClass.value).toBe(false)
  })
})
