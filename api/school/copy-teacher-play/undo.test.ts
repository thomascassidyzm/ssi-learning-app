/**
 * Gate tests for POST /api/school/copy-teacher-play/undo.
 *
 * The reversal itself is pinned in api/_utils/classProgressCopy.test.ts; here
 * undoCopy is mocked and only the door is tested:
 *   - View-as is refused 403 before anything else, like every other write;
 *   - the teacher whose play was copied may undo it, because it is her message
 *     and her mistake to unmake;
 *   - the school admin of that class and a platform admin may too;
 *   - anyone else gets 403 and nothing is undone;
 *   - an unknown audit id is 404;
 *   - undoing twice answers 200 saying it was already put back, never an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-key'

let authUserId = 'davidlane'
vi.mock('../../_utils/auth', () => ({
  verifyAuthToken: vi.fn(async () => ({ valid: true, userId: authUserId })),
}))

let schoolAdmin = false
let platformAdmin = false
vi.mock('../../_utils/classTeacherAuth', () => ({
  fetchClassAuthRow: vi.fn(async (_svc: unknown, id: string) => id === 'class-1'
    ? { id: 'class-1', teacher_user_id: 'davidlane', school_id: 'school-1', group_id: null }
    : null),
  isSchoolAdminOfClass: vi.fn(async () => schoolAdmin),
  isPlatformAdmin: vi.fn(async () => platformAdmin),
}))

const undoCopy = vi.fn()
vi.mock('../../_utils/classProgressCopy', () => ({
  undoCopy: (...a: unknown[]) => undoCopy(...a),
  AUDIT_TABLE: 'class_progress_copy_audit',
}))

function fakeFrom(table: string) {
  const filters: Array<[string, unknown]> = []
  const q: any = {
    select() { return q },
    eq(c: string, v: unknown) { filters.push([c, v]); return q },
    maybeSingle() {
      const rows: any[] = table === 'class_progress_copy_audit'
        ? [{ id: 'audit-1', class_id: 'class-1', source_learner_id: 'teacher-learner' }]
        : table === 'learners'
          ? [{ id: 'teacher-learner', user_id: 'davidlane' }]
          : []
      const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v))
      return Promise.resolve({ data: hit ?? null, error: null })
    },
  }
  return q
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: fakeFrom }) }))

function mockRes() {
  const out: { status: number | null; body: any } = { status: null, body: null }
  const res = {
    status(code: number) { out.status = code; return res },
    json(body: unknown) { out.body = body; return res },
    setHeader() { return res },
    end() { return res },
  } as unknown as VercelResponse
  return { res, out }
}
const request = (body: unknown, headers: Record<string, string> = {}) =>
  ({ method: 'POST', body, headers }) as unknown as VercelRequest

async function run(body: unknown, headers: Record<string, string> = {}) {
  const handler = (await import('./undo')).default
  const { res, out } = mockRes()
  await handler(request(body, headers), res)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  authUserId = 'davidlane'
  schoolAdmin = false
  platformAdmin = false
  undoCopy.mockResolvedValue({
    undone: true,
    alreadyUndone: false,
    undoAuditId: 'audit-2',
    detail: { deleted: { sessions: 5, player_events: 84 }, missing: {}, cursor: 'restored', minutesRemoved: 0 },
  })
})

describe('POST /api/school/copy-teacher-play/undo', () => {
  it('refuses View-as before anything else', async () => {
    const out = await run({ audit_id: 'audit-1' }, { 'x-ssi-view-as': '1' })
    expect(out.status).toBe(403)
    expect(undoCopy).not.toHaveBeenCalled()
  })

  it('the teacher whose play was copied may undo it', async () => {
    const out = await run({ audit_id: 'audit-1' })
    expect(out.status).toBe(200)
    expect(out.body.undone).toBe(true)
    expect(out.body.total_rows_deleted).toBe(89)
    expect(out.body.cursor).toBe('restored')
    expect(undoCopy).toHaveBeenCalledWith(expect.anything(), 'audit-1', { actorUserId: 'davidlane' })
  })

  it('the school admin of that class may undo it', async () => {
    authUserId = 'angharad'
    schoolAdmin = true
    expect((await run({ audit_id: 'audit-1' })).status).toBe(200)
  })

  it('a platform admin may undo it', async () => {
    authUserId = 'tom'
    platformAdmin = true
    expect((await run({ audit_id: 'audit-1' })).status).toBe(200)
  })

  it('anybody else is refused, and nothing is undone', async () => {
    authUserId = 'some-other-teacher'
    const out = await run({ audit_id: 'audit-1' })
    expect(out.status).toBe(403)
    expect(undoCopy).not.toHaveBeenCalled()
  })

  it('an unknown copy is 404, and a missing audit_id is 400', async () => {
    expect((await run({ audit_id: 'nope' })).status).toBe(404)
    expect((await run({})).status).toBe(400)
    expect(undoCopy).not.toHaveBeenCalled()
  })

  it('undoing twice says it was already put back, and is not an error', async () => {
    undoCopy.mockResolvedValue({ undone: false, alreadyUndone: true })
    const out = await run({ audit_id: 'audit-1' })
    expect(out.status).toBe(200)
    expect(out.body.already_undone).toBe(true)
    expect(out.body.undone).toBe(false)
  })
})
