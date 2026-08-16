/**
 * Unified Invites API - /api/admin/invites
 *
 * GET  — { invites: UnifiedInvite[] } aggregated over the four existing code
 *        tables (invite_codes, entitlement_codes, email_access_grants,
 *        try_links) — the lens described in docs/invites-redesign/DESIGN.md.
 *        No new table, no dual-write; this is a read-side view over storage
 *        that keeps redeeming exactly as before.
 * POST { source, id, is_active } — toggle is_active on the owning table.
 *
 * Scoping mirrors /api/admin/codes: ssi_admin/god sees and may toggle
 * everything; any other caller sees/toggles ONLY invite_codes rows they
 * created — nothing from the other three tables.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyAuthToken } from '../_utils/auth'

const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim()
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('[AdminInvites] Missing env vars:', { hasUrl: !!supabaseUrl, hasKey: !!supabaseServiceKey })
}

type WhereKind = 'platform' | 'group' | 'school' | 'class'
type Who = 'learner' | 'teacher' | 'school_admin' | 'govt_admin' | 'tester' | 'ssi_admin' | 'guest' | 'access'
type Source = 'invite' | 'entitlement' | 'email_grant' | 'try_link'

interface WhereResult {
  kind: WhereKind
  id: string | null
  name: string | null
  path: string | null
  isDemo: boolean
}

interface UnifiedInvite {
  source: Source
  id: string
  code: string | null
  urlPath: string | null
  who: Who
  where: WhereResult
  what: string
  email: string | null
  limits: { expiresAt: string | null; maxUses: number | null; useCount: number }
  isActive: boolean
  redeemedAt: string | null
  createdBy: string
  createdByName: string | null
  createdAt: string
}

const PLATFORM_WHERE: WhereResult = { kind: 'platform', id: null, name: null, path: null, isDemo: false }

const WHO_BY_CODE_TYPE: Record<string, Who> = {
  student: 'learner',
  teacher: 'teacher',
  school_admin: 'school_admin',
  school_admin_join: 'school_admin',
  govt_admin: 'govt_admin',
  tester: 'tester',
  ssi_admin: 'ssi_admin',
  god: 'ssi_admin',
}

const SOURCE_TABLE: Record<Source, string> = {
  invite: 'invite_codes',
  entitlement: 'entitlement_codes',
  email_grant: 'email_access_grants',
  try_link: 'try_links',
}

function chunk<T>(arr: T[], size = 150): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function uniq<T>(values: (T | null | undefined)[]): T[] {
  return [...new Set(values.filter((v): v is T => v != null))]
}

function formatAccessWhat(row: {
  access_type: string
  granted_courses: string[] | null
  duration_type: string | null
  duration_days: number | null
}): string {
  const base = row.access_type === 'full' ? 'Full access' : `Courses: ${(row.granted_courses || []).join(', ')}`
  const suffix = row.duration_type === 'lifetime'
    ? ' · lifetime'
    : row.duration_days != null ? ` · ${row.duration_days} days` : ''
  return base + suffix
}

/**
 * Batch-resolves grants_class_id / grants_school_id / grants_group_id on
 * invite_codes rows to a human breadcrumb (group chain via groups.path
 * prefixes, one extra bounded IN query for ancestors not already loaded —
 * never an unbounded/recursive walk) plus the isDemo flag inherited from any
 * node in the chain. See DESIGN.md "WHERE resolution".
 */
async function resolveInviteWheres(supabase: SupabaseClient, inviteRows: any[]): Promise<Map<string, WhereResult>> {
  const result = new Map<string, WhereResult>()

  const classIds = uniq(inviteRows.map(r => r.grants_class_id))
  const directSchoolIds = uniq(inviteRows.map(r => r.grants_school_id))
  const directGroupIds = uniq(inviteRows.map(r => r.grants_group_id))

  const classMap = new Map<string, any>()
  for (const batch of chunk(classIds)) {
    const { data } = await supabase.from('classes').select('id, class_name, school_id').in('id', batch)
    for (const c of data || []) classMap.set((c as any).id, c)
  }

  const schoolIds = uniq([...directSchoolIds, ...[...classMap.values()].map(c => c.school_id)])
  const schoolMap = new Map<string, any>()
  for (const batch of chunk(schoolIds)) {
    const { data } = await supabase.from('schools').select('id, school_name, group_id, is_demo').in('id', batch)
    for (const s of data || []) schoolMap.set((s as any).id, s)
  }

  const groupIds = uniq([...directGroupIds, ...[...schoolMap.values()].map(s => s.group_id)])
  const groupById = new Map<string, any>()
  const groupByPath = new Map<string, any>()
  for (const batch of chunk(groupIds)) {
    const { data } = await supabase.from('groups').select('id, name, path, parent_id, is_demo').in('id', batch)
    for (const g of data || []) {
      groupById.set((g as any).id, g)
      if ((g as any).path) groupByPath.set((g as any).path, g)
    }
  }

  // One bounded pass to pull in ancestor groups by path prefix — no recursion.
  const neededPrefixes = new Set<string>()
  for (const g of groupById.values()) {
    if (!g.path) continue
    const segments = (g.path as string).split('/')
    for (let i = 1; i < segments.length; i++) {
      const prefix = segments.slice(0, i).join('/')
      if (!groupByPath.has(prefix)) neededPrefixes.add(prefix)
    }
  }
  if (neededPrefixes.size) {
    const { data } = await supabase.from('groups').select('id, name, path, parent_id, is_demo').in('path', [...neededPrefixes])
    for (const g of data || []) {
      groupById.set((g as any).id, g)
      if ((g as any).path) groupByPath.set((g as any).path, g)
    }
  }

  function groupChain(groupId: string | null | undefined): { names: string[]; isDemo: boolean } {
    if (!groupId) return { names: [], isDemo: false }
    const g = groupById.get(groupId)
    if (!g) return { names: [], isDemo: false }

    if (g.path) {
      const segments = (g.path as string).split('/')
      const chain: any[] = []
      for (let i = 1; i <= segments.length; i++) {
        const cg = groupByPath.get(segments.slice(0, i).join('/'))
        if (cg) chain.push(cg)
      }
      return { names: chain.map(c => c.name), isDemo: chain.some(c => c.is_demo) }
    }

    // Fallback: parent walk using only already-fetched groups (bounded, no
    // further queries — "do NOT do unbounded recursive queries").
    const chain: any[] = []
    let cur = g
    let depth = 0
    while (cur && depth < 10) {
      chain.unshift(cur)
      cur = cur.parent_id ? groupById.get(cur.parent_id) : null
      depth++
    }
    return { names: chain.map(c => c.name), isDemo: chain.some(c => c.is_demo) }
  }

  // Demo orgs name their hidden school and class after the owning group, so a
  // literal breadcrumb reads "Welsh Health › Welsh Health › Welsh Health" —
  // collapse consecutive duplicates, and return null when nothing beyond the
  // node's own name remains (the UI then skips the redundant sub-line).
  function joinPath(parts: (string | null | undefined)[], ownName?: string | null): string | null {
    const cleaned: string[] = []
    for (const p of parts) {
      if (!p) continue
      if (cleaned.length && cleaned[cleaned.length - 1] === p) continue
      cleaned.push(p)
    }
    if (!cleaned.length) return null
    if (ownName && cleaned.length === 1 && cleaned[0] === ownName) return null
    return cleaned.join(' › ')
  }

  for (const row of inviteRows) {
    if (row.grants_class_id) {
      const cls = classMap.get(row.grants_class_id)
      if (!cls) {
        result.set(row.id, { kind: 'class', id: row.grants_class_id, name: null, path: null, isDemo: false })
        continue
      }
      const school = schoolMap.get(cls.school_id)
      const chain = groupChain(school?.group_id ?? null)
      const isDemo = !!school?.is_demo || chain.isDemo
      const pathParts = [...chain.names, ...(school ? [school.school_name] : []), cls.class_name]
      result.set(row.id, { kind: 'class', id: row.grants_class_id, name: cls.class_name, path: joinPath(pathParts, cls.class_name), isDemo })
    } else if (row.grants_school_id) {
      const school = schoolMap.get(row.grants_school_id)
      if (!school) {
        result.set(row.id, { kind: 'school', id: row.grants_school_id, name: null, path: null, isDemo: false })
        continue
      }
      const chain = groupChain(school.group_id)
      const isDemo = !!school.is_demo || chain.isDemo
      const pathParts = [...chain.names, school.school_name]
      result.set(row.id, { kind: 'school', id: row.grants_school_id, name: school.school_name, path: joinPath(pathParts, school.school_name), isDemo })
    } else if (row.grants_group_id) {
      const chain = groupChain(row.grants_group_id)
      const g = groupById.get(row.grants_group_id)
      result.set(row.id, {
        kind: 'group',
        id: row.grants_group_id,
        name: g?.name ?? null,
        path: joinPath(chain.names, g?.name ?? null),
        isDemo: chain.isDemo,
      })
    } else {
      result.set(row.id, PLATFORM_WHERE)
    }
  }

  return result
}

async function namesByUserId(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (const batch of chunk(userIds)) {
    const { data } = await supabase.from('learners').select('user_id, display_name').in('user_id', batch)
    for (const l of data || []) {
      if ((l as any).display_name) map.set((l as any).user_id, (l as any).display_name)
    }
  }
  return map
}

async function handleGet(supabase: SupabaseClient, userId: string, isSsiAdmin: boolean, res: VercelResponse): Promise<void> {
  try {
    let inviteQuery = supabase.from('invite_codes').select('*').order('created_at', { ascending: false })
    if (!isSsiAdmin) inviteQuery = inviteQuery.eq('created_by', userId)
    const { data: inviteRowsRaw, error: inviteError } = await inviteQuery
    if (inviteError) {
      console.error('[AdminInvites] invite_codes query error:', inviteError)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
    const inviteRows = inviteRowsRaw || []

    let entitlementRows: any[] = []
    let emailGrantRows: any[] = []
    let tryLinkRows: any[] = []

    // Non-admins see ONLY invite codes they created — nothing from the other
    // three tables (DESIGN.md scoping).
    if (isSsiAdmin) {
      const [entRes, emailRes, tryRes] = await Promise.all([
        supabase.from('entitlement_codes').select('*').order('created_at', { ascending: false }),
        supabase.from('email_access_grants').select('*').order('created_at', { ascending: false }),
        supabase.from('try_links').select('*').order('created_at', { ascending: false }),
      ])
      if (entRes.error || emailRes.error || tryRes.error) {
        console.error('[AdminInvites] aggregate query error:', entRes.error, emailRes.error, tryRes.error)
        res.status(500).json({ error: 'Internal server error' })
        return
      }
      entitlementRows = entRes.data || []
      emailGrantRows = emailRes.data || []
      tryLinkRows = tryRes.data || []
    }

    const whereByInviteId = await resolveInviteWheres(supabase, inviteRows)

    const createdByIds = uniq([
      ...inviteRows.map(r => r.created_by),
      ...entitlementRows.map(r => r.created_by),
      ...emailGrantRows.map(r => r.created_by),
      ...tryLinkRows.map(r => r.created_by),
    ]).map(String)
    const nameByCreatedBy = await namesByUserId(supabase, createdByIds)

    const invites: UnifiedInvite[] = []

    for (const row of inviteRows) {
      const where = whereByInviteId.get(row.id) || PLATFORM_WHERE
      invites.push({
        source: 'invite',
        id: row.id,
        code: row.code,
        urlPath: row.code_type === 'student' ? `/with/${row.code}` : `/redeem/${row.code}`,
        who: WHO_BY_CODE_TYPE[row.code_type] || 'tester',
        where,
        what: where.isDemo ? 'Demo' : 'Real account',
        email: null,
        limits: { expiresAt: row.expires_at, maxUses: row.max_uses, useCount: row.use_count },
        isActive: row.is_active,
        redeemedAt: null,
        createdBy: row.created_by,
        createdByName: nameByCreatedBy.get(String(row.created_by)) ?? null,
        createdAt: row.created_at,
      })
    }

    for (const row of entitlementRows) {
      invites.push({
        source: 'entitlement',
        id: row.id,
        code: row.code,
        urlPath: `/redeem/${row.code}`,
        who: 'access',
        where: PLATFORM_WHERE,
        // The label is who the grant is FOR (IndividualAccessForm writes the
        // person's name there, and the metadata bag carries their email) —
        // without it an individual grant reads as an anonymous "Full access"
        // row and is unfindable by name in the audit list's search.
        what: row.label ? `${row.label} — ${formatAccessWhat(row)}` : formatAccessWhat(row),
        email: typeof row.metadata?.recipient_email === 'string' ? row.metadata.recipient_email : null,
        limits: { expiresAt: row.expires_at, maxUses: row.max_uses, useCount: row.use_count },
        isActive: row.is_active,
        redeemedAt: null,
        createdBy: row.created_by,
        createdByName: nameByCreatedBy.get(String(row.created_by)) ?? null,
        createdAt: row.created_at,
      })
    }

    for (const row of emailGrantRows) {
      invites.push({
        source: 'email_grant',
        id: row.id,
        code: null,
        urlPath: null,
        who: 'access',
        where: PLATFORM_WHERE,
        what: formatAccessWhat(row),
        email: row.email,
        limits: { expiresAt: null, maxUses: null, useCount: row.redeemed_at ? 1 : 0 },
        isActive: row.is_active,
        redeemedAt: row.redeemed_at,
        createdBy: row.created_by,
        createdByName: nameByCreatedBy.get(String(row.created_by)) ?? null,
        createdAt: row.created_at,
      })
    }

    for (const row of tryLinkRows) {
      invites.push({
        source: 'try_link',
        id: row.id,
        code: row.code,
        urlPath: `/try/${row.code}`,
        who: 'guest',
        where: PLATFORM_WHERE,
        what: 'Course preview',
        email: null,
        limits: { expiresAt: row.expires_at, maxUses: null, useCount: 0 },
        isActive: row.is_active,
        redeemedAt: null,
        createdBy: String(row.created_by),
        createdByName: nameByCreatedBy.get(String(row.created_by)) ?? null,
        createdAt: row.created_at,
      })
    }

    invites.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

    res.status(200).json({ invites })
  } catch (error) {
    console.error('[AdminInvites] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

async function handlePost(supabase: SupabaseClient, userId: string, isSsiAdmin: boolean, req: VercelRequest, res: VercelResponse): Promise<void> {
  const { source, id, is_active } = (req.body || {}) as { source?: string; id?: string; is_active?: boolean }

  if (source !== 'invite' && source !== 'entitlement' && source !== 'email_grant' && source !== 'try_link') {
    res.status(400).json({ error: "source must be one of 'invite', 'entitlement', 'email_grant', 'try_link'" })
    return
  }
  if (!id || typeof id !== 'string') {
    res.status(400).json({ error: 'id is required' })
    return
  }
  if (typeof is_active !== 'boolean') {
    res.status(400).json({ error: 'is_active must be a boolean' })
    return
  }

  const table = SOURCE_TABLE[source]

  if (!isSsiAdmin) {
    if (source !== 'invite') {
      res.status(403).json({ error: 'Only SSi admins can toggle this invite' })
      return
    }
    const { data: row } = await supabase.from('invite_codes').select('created_by').eq('id', id).single()
    if (!row || (row as any).created_by !== userId) {
      res.status(403).json({ error: 'You can only toggle codes you created' })
      return
    }
  }

  try {
    const { error } = await supabase.from(table).update({ is_active }).eq('id', id)
    if (error) {
      console.error('[AdminInvites] Toggle error:', error)
      res.status(500).json({ error: 'Internal server error' })
      return
    }
    res.status(200).json({ ok: true, is_active })
  } catch (error) {
    console.error('[AdminInvites] Error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: 'Server misconfigured — missing SUPABASE_SERVICE_ROLE_KEY' })
    return
  }

  const authResult = await verifyAuthToken(req)
  if (!authResult.valid || !authResult.userId) {
    res.status(401).json({ error: authResult.error || 'Unauthorized' })
    return
  }
  const userId = authResult.userId

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const { data: learner } = await supabase
    .from('learners')
    .select('platform_role, educational_role')
    .eq('user_id', userId)
    .single()

  const isSsiAdmin = learner?.platform_role === 'ssi_admin' || learner?.educational_role === 'god'

  if (req.method === 'GET') {
    await handleGet(supabase, userId, isSsiAdmin, res)
    return
  }

  await handlePost(supabase, userId, isSsiAdmin, req, res)
}
