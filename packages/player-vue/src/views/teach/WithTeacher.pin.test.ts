/**
 * REGRESSION PIN — WithTeacher.vue (/with/:code, the student_join_code join
 * gateway). Pins CURRENT behaviour: the learner is enrolled in the class's
 * course and tagged onto the class roster (CLASS:{id}, role student) via
 * linkLearnerToClass, mirroring the Paddle webhook's own writes. No refactor,
 * no behaviour change — baseline for THE-MODEL.md's group unpick
 * (docs/THE-MODEL.md, I7/I8 — affiliation + invite semantics).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { code: 'abc-123' } }),
}))

import WithTeacher from './WithTeacher.vue'

const SCHOOL_CLASS_RESPONSE = {
  class: {
    id: 'class-1', class_name: 'Beginners Welsh', course_code: 'cym_for_eng',
    student_join_code: 'ABC-123', school_id: 'school-1', course_is_free: true,
  },
  teacher: { id: 'teacher-1', display_name: 'Ms Jones', photo_url: null, bio: null, country: null, teaching_languages: [] },
  seats_remaining: null,
  is_full: false,
}

function mockFetch(response: any) {
  return vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/teacher/by-code')) {
      return { status: 200, ok: true, json: async () => response } as any
    }
    if (String(url).startsWith('/api/subscription')) {
      return { ok: true, json: async () => ({ isSubscribed: false }) } as any
    }
    throw new Error(`Unhandled fetch: ${url}`)
  })
}

function makeSupabase(overrides: { existingEnrollment?: boolean } = {}) {
  const inserted: Record<string, any[]> = { course_enrollments: [], user_tags: [] }
  const upserted: any[] = []
  const supabase = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'auth-user-1', email: 'learner@example.com' } } },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'learners') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'learner-1' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'course_enrollments') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: overrides.existingEnrollment ? { id: 'enrol-1' } : null,
                  error: null,
                }),
              }),
            }),
          }),
          insert: (payload: any) => {
            inserted.course_enrollments.push(payload)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      if (table === 'user_tags') {
        return {
          upsert: (payload: any) => {
            upserted.push(payload)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`Unhandled table: ${table}`)
    }),
  }
  return { supabase, inserted, upserted }
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('WithTeacher.vue — student_join_code join writes', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // goToPlayer() writes window.location.href — happy-dom allows a plain
    // reassignment, unlike jsdom's "not implemented" navigation error.
    delete (window as any).location
    // @ts-expect-error test override
    window.location = { ...originalLocation, href: '' }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // @ts-expect-error test restore
    window.location = originalLocation
  })

  it('free course, brand-new learner: enrols in course_enrollments and tags CLASS:{id} role student on the roster', async () => {
    vi.stubGlobal('fetch', mockFetch(SCHOOL_CLASS_RESPONSE))
    const { supabase, inserted, upserted } = makeSupabase()

    const wrapper = mount(WithTeacher, {
      global: { provide: { supabase: { value: supabase } }, stubs: { 'router-link': true } },
    })
    await flushAsync()

    await wrapper.find('button').trigger('click') // "Join free"
    await flushAsync()

    expect(inserted.course_enrollments).toEqual([
      { learner_id: 'learner-1', course_id: 'cym_for_eng' },
    ])
    expect(upserted).toEqual([
      {
        user_id: 'auth-user-1',
        tag_type: 'class',
        tag_value: 'CLASS:class-1',
        role_in_context: 'student',
        added_by: 'auth-user-1',
      },
    ])
    expect(window.location.href).toBe('/')
  })

  it('already-enrolled learner: skips the course_enrollments insert but still (idempotently) re-tags the roster', async () => {
    vi.stubGlobal('fetch', mockFetch(SCHOOL_CLASS_RESPONSE))
    const { supabase, inserted, upserted } = makeSupabase({ existingEnrollment: true })

    const wrapper = mount(WithTeacher, {
      global: { provide: { supabase: { value: supabase } }, stubs: { 'router-link': true } },
    })
    await flushAsync()

    await wrapper.find('button').trigger('click')
    await flushAsync()

    expect(inserted.course_enrollments).toEqual([])
    expect(upserted).toHaveLength(1)
    expect(upserted[0].tag_value).toBe('CLASS:class-1')
  })

  it('sets ssi-last-course in localStorage to the class course_code before navigating to the player', async () => {
    vi.stubGlobal('fetch', mockFetch(SCHOOL_CLASS_RESPONSE))
    const { supabase } = makeSupabase()
    localStorage.removeItem('ssi-last-course')

    const wrapper = mount(WithTeacher, {
      global: { provide: { supabase: { value: supabase } }, stubs: { 'router-link': true } },
    })
    await flushAsync()
    await wrapper.find('button').trigger('click')
    await flushAsync()

    expect(localStorage.getItem('ssi-last-course')).toBe('cym_for_eng')
  })

  it('unauthenticated learner: clicking join shows the inline OTP login instead of writing anything', async () => {
    vi.stubGlobal('fetch', mockFetch(SCHOOL_CLASS_RESPONSE))
    const supabase = {
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
      from: vi.fn(() => { throw new Error('must not touch the DB while unauthenticated') }),
    }

    const wrapper = mount(WithTeacher, {
      global: { provide: { supabase: { value: supabase } }, stubs: { 'router-link': true } },
    })
    await flushAsync()

    await wrapper.find('button').trigger('click')
    await flushAsync()

    expect(wrapper.find('.login-block').exists()).toBe(true)
  })
})
