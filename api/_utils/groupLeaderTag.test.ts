/**
 * Tests for groupLeaderTag — leader membership for a group node.
 *
 * Founder ruling (Tom, 2026-08-06): the creator of a group/org automatically
 * becomes its first manager. Leadership used to be recorded only in
 * `govt_admins`, an authz table no lens reads, so a creator governed a group
 * that listed no manager anywhere. These pin the membership write and the
 * two-source read that lets pre-ruling orgs still name their leader.
 */
import { describe, it, expect, vi } from 'vitest'
import { ensureGroupLeaderTag, leadersForNodes, GROUP_LEADER_ROLE } from './groupLeaderTag'

type Row = Record<string, unknown>

function makeSvc(tables: Record<string, Row[]>, opts: { insertError?: string } = {}) {
  const inserted: { table: string; row: Row }[] = []
  const svc = {
    from(table: string) {
      const calls: { m: string; a: unknown[] }[] = []
      const builder: Record<string, unknown> = {}
      const chain = (m: string) => (...a: unknown[]) => { calls.push({ m, a }); return builder }
      builder.select = chain('select')
      builder.eq = chain('eq')
      builder.in = chain('in')
      builder.is = chain('is')
      builder.insert = (row: Row) => {
        if (opts.insertError) return Promise.resolve({ error: { message: opts.insertError } })
        inserted.push({ table, row })
        ;(tables[table] ||= []).push(row)
        return Promise.resolve({ error: null })
      }
      const rows = () => {
        let out = tables[table] || []
        for (const c of calls) {
          if (c.m === 'eq') out = out.filter((r) => r[c.a[0] as string] === c.a[1])
          else if (c.m === 'in') out = out.filter((r) => (c.a[1] as unknown[]).includes(r[c.a[0] as string]))
          else if (c.m === 'is') out = out.filter((r) => (r[c.a[0] as string] ?? null) === c.a[1])
        }
        return out
      }
      builder.maybeSingle = () => Promise.resolve({ data: rows()[0] || null, error: null })
      builder.then = (resolve: (r: { data: Row[]; error: null }) => unknown) => resolve({ data: rows(), error: null })
      return builder
    },
  }
  return { svc: svc as never, inserted }
}

describe('ensureGroupLeaderTag', () => {
  it('writes the leader membership tag for a group creator', async () => {
    const { svc, inserted } = makeSvc({ user_tags: [] })
    expect(await ensureGroupLeaderTag(svc, { groupId: 'org-1', userId: 'creator-uid' })).toBe('created')
    expect(inserted).toHaveLength(1)
    expect(inserted[0].row).toMatchObject({
      user_id: 'creator-uid',
      tag_type: 'group',
      tag_value: 'GROUP:org-1',
      role_in_context: GROUP_LEADER_ROLE,
      added_by: 'creator-uid',
    })
  })

  // The live DB's user_tags_role_in_context_check admits exactly
  // admin | teacher | student — 'leader'/'manager'/'owner' are rejected. And
  // 'teacher' would land the leader in teacherCount: an invisible manager
  // swapped for a miscounted one.
  it("stores 'admin' — the only value the schema allows that isn't a miscount", () => {
    expect(GROUP_LEADER_ROLE).toBe('admin')
    expect(['admin', 'teacher', 'student']).toContain(GROUP_LEADER_ROLE)
  })

  it('is idempotent — a second call writes nothing', async () => {
    const { svc, inserted } = makeSvc({
      user_tags: [
        { user_id: 'creator-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'admin', removed_at: null },
      ],
    })
    expect(await ensureGroupLeaderTag(svc, { groupId: 'org-1', userId: 'creator-uid' })).toBe('existed')
    expect(inserted).toHaveLength(0)
  })

  it('re-adds after the tag was removed', async () => {
    const { svc, inserted } = makeSvc({
      user_tags: [
        { user_id: 'creator-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'admin', removed_at: '2026-08-01T00:00:00Z' },
      ],
    })
    expect(await ensureGroupLeaderTag(svc, { groupId: 'org-1', userId: 'creator-uid' })).toBe('created')
    expect(inserted).toHaveLength(1)
  })

  it('records who added the tag when a different actor does it', async () => {
    const { svc, inserted } = makeSvc({ user_tags: [] })
    await ensureGroupLeaderTag(svc, { groupId: 'org-1', userId: 'creator-uid', addedBy: 'admin-uid' })
    expect(inserted[0].row.added_by).toBe('admin-uid')
  })

  it('reports failure instead of throwing — a display tag must never cost the caller their org', async () => {
    const { svc } = makeSvc({ user_tags: [] }, { insertError: 'boom' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await ensureGroupLeaderTag(svc, { groupId: 'org-1', userId: 'creator-uid' })).toBe('failed')
    spy.mockRestore()
  })

  it('refuses an empty id rather than writing a junk row', async () => {
    const { svc, inserted } = makeSvc({ user_tags: [] })
    expect(await ensureGroupLeaderTag(svc, { groupId: '', userId: 'x' })).toBe('failed')
    expect(inserted).toHaveLength(0)
  })
})

describe('leadersForNodes', () => {
  it('names the leader of an org created BEFORE the ruling, from govt_admins alone', async () => {
    const { svc } = makeSvc({
      govt_admins: [{ user_id: 'deborah-uid', group_id: 'org-1' }],
      user_tags: [],
    })
    const byNode = await leadersForNodes(svc, ['org-1'])
    expect([...(byNode.get('org-1') || [])]).toEqual(['deborah-uid'])
  })

  it('names the leader from the membership tag alone', async () => {
    const { svc } = makeSvc({
      govt_admins: [],
      user_tags: [
        { user_id: 'tagged-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'admin', removed_at: null },
      ],
    })
    const byNode = await leadersForNodes(svc, ['org-1'])
    expect([...(byNode.get('org-1') || [])]).toEqual(['tagged-uid'])
  })

  it('unions both sources without duplicating a leader present in each', async () => {
    const { svc } = makeSvc({
      govt_admins: [{ user_id: 'deborah-uid', group_id: 'org-1' }],
      user_tags: [
        { user_id: 'deborah-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'admin', removed_at: null },
        { user_id: 'second-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'admin', removed_at: null },
      ],
    })
    const byNode = await leadersForNodes(svc, ['org-1'])
    expect([...(byNode.get('org-1') || [])].sort()).toEqual(['deborah-uid', 'second-uid'])
  })

  it('ignores students, teachers and removed leader tags', async () => {
    const { svc } = makeSvc({
      govt_admins: [],
      user_tags: [
        { user_id: 'student-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'student', removed_at: null },
        { user_id: 'teacher-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'teacher', removed_at: null },
        { user_id: 'gone-uid', tag_type: 'group', tag_value: 'GROUP:org-1', role_in_context: 'admin', removed_at: '2026-08-01T00:00:00Z' },
      ],
    })
    const byNode = await leadersForNodes(svc, ['org-1'])
    expect(byNode.get('org-1')).toBeUndefined()
  })

  it('does not leak another node\'s leader', async () => {
    const { svc } = makeSvc({
      govt_admins: [{ user_id: 'other-uid', group_id: 'org-2' }],
      user_tags: [],
    })
    const byNode = await leadersForNodes(svc, ['org-1'])
    expect(byNode.get('org-1')).toBeUndefined()
  })

  it('returns empty for no nodes without touching the DB', async () => {
    const from = vi.fn()
    const byNode = await leadersForNodes({ from } as never, [])
    expect(byNode.size).toBe(0)
    expect(from).not.toHaveBeenCalled()
  })
})
