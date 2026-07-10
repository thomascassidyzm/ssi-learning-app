/**
 * Regression coverage: the plan-precedence guard (wouldDowngradePlan) must
 * only suppress the redundant `subscriptions` row write, never the
 * orthogonal side effects. Before this fix, a tutor/premium holder buying a
 * student class seat paid Paddle and was silently never enrolled/tagged
 * (webhook 200s, payment taken, no enrolment) — the guard's early `return`
 * short-circuited handleStudentSubscription before it reached the referral,
 * tag, and course_enrollments writes. Same mirror fault in
 * handlePremiumSubscription, which could skip the teachers.own_subscription_id
 * link (resurrecting the "Manage subscription" portal-404).
 */

import { describe, it, expect } from 'vitest'

process.env.SUPABASE_URL = 'http://localhost:54321'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key'

const { handleStudentSubscription, handlePremiumSubscription } = await import(
  '../../../../../api/teacher/paddle-webhook'
)

type Call = { table: string; method: string; args: any[] }

function makeSupabaseMock(responses: Record<string, any>) {
  const calls: Call[] = []
  function chainFor(table: string) {
    const response = responses[table] ?? { data: null, error: null }
    const chain: any = {
      select: (...a: any[]) => { calls.push({ table, method: 'select', args: a }); return chain },
      eq: (...a: any[]) => { calls.push({ table, method: 'eq', args: a }); return chain },
      is: (...a: any[]) => { calls.push({ table, method: 'is', args: a }); return chain },
      upsert: (...a: any[]) => { calls.push({ table, method: 'upsert', args: a }); return chain },
      insert: (...a: any[]) => { calls.push({ table, method: 'insert', args: a }); return chain },
      update: (...a: any[]) => { calls.push({ table, method: 'update', args: a }); return chain },
      maybeSingle: () => Promise.resolve(response),
      single: () => Promise.resolve(response),
      then: (resolve: any) => resolve(response),
    }
    return chain
  }
  return {
    from: (table: string) => chainFor(table),
    calls,
  }
}

const baseData = {
  id: 'sub_incoming',
  status: 'active',
  currentBillingPeriod: { endsAt: '2027-01-01T00:00:00Z' },
  items: [{ price: { id: 'pri_student' } }],
  scheduledChange: null,
  customerId: undefined, // skip logEmailMismatch's network call
}

describe('paddle-webhook: precedence guard must not suppress side effects', () => {
  it('handleStudentSubscription: still enrols + tags the student when the guard skips the row write', async () => {
    const supabase = makeSupabaseMock({
      classes: { data: { school_id: null, course_code: 'course-x' }, error: null },
      // Existing row outranks 'SSi Student Access' → wouldDowngradePlan skips the write,
      // and the same table is re-queried for the existing row id.
      subscriptions: { data: { id: 'existing-sub-1', plan_name: 'SSi Premium (tutor bundle)', status: 'active' }, error: null },
      learners: { data: { id: 'learner-1' }, error: null },
      teacher_referrals: { data: null, error: null },
      user_tags: { data: null, error: null },
      course_enrollments: { data: null, error: null },
    })

    await handleStudentSubscription(supabase as any, baseData, {
      supabase_user_id: 'user-1',
      class_id: 'class-1',
    })

    const upsertedTables = supabase.calls.filter((c) => c.method === 'upsert').map((c) => c.table)

    // The redundant row write IS suppressed.
    expect(upsertedTables).not.toContain('subscriptions')

    // But the payment's side effects are NOT — this is the regression.
    expect(upsertedTables).toContain('user_tags')
    expect(upsertedTables).toContain('course_enrollments')
    expect(upsertedTables).toContain('teacher_referrals')
  })

  it('handleStudentSubscription: normal path (no outranking row) still writes everything', async () => {
    const supabase = makeSupabaseMock({
      classes: { data: { school_id: null, course_code: 'course-x' }, error: null },
      subscriptions: { data: { id: 'new-sub-1' }, error: null },
      learners: { data: { id: 'learner-1' }, error: null },
      teacher_referrals: { data: null, error: null },
      user_tags: { data: null, error: null },
      course_enrollments: { data: null, error: null },
    })

    await handleStudentSubscription(supabase as any, baseData, {
      supabase_user_id: 'user-1',
      class_id: 'class-1',
    })

    const upsertedTables = supabase.calls.filter((c) => c.method === 'upsert').map((c) => c.table)
    expect(upsertedTables).toContain('subscriptions')
    expect(upsertedTables).toContain('teacher_referrals')
    expect(upsertedTables).toContain('user_tags')
    expect(upsertedTables).toContain('course_enrollments')
  })

  it('handlePremiumSubscription: still links teachers.own_subscription_id when the guard skips the row write', async () => {
    const supabase = makeSupabaseMock({
      teachers: { data: { id: 'teacher-1', learner_id: 'learner-1' }, error: null },
      // Existing row outranks 'SSi Premium' → wouldDowngradePlan skips the write.
      subscriptions: { data: { id: 'existing-sub-1', plan_name: 'SSi Premium (tutor bundle)', status: 'active' }, error: null },
    })

    await handlePremiumSubscription(supabase as any, baseData, {
      teacher_id: 'teacher-1',
    })

    const updatedTables = supabase.calls.filter((c) => c.method === 'update').map((c) => c.table)
    const teacherUpdateCall = supabase.calls.find((c) => c.table === 'teachers' && c.method === 'update')

    expect(updatedTables).toContain('teachers')
    expect(teacherUpdateCall?.args[0]).toMatchObject({ own_subscription_id: 'existing-sub-1' })
  })
})
