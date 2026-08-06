/**
 * verify-deborah-orgs.mts — READ-ONLY state probe for the two "Deborah
 * Testing" orgs, run BEFORE and AFTER the duplicate-org removal
 * (scripts/remove-duplicate-deborah-org.mts) so the surviving org's numbers
 * can be compared exactly.
 *
 * It exercises the REAL server-side resolution utilities rather than
 * re-implementing their queries: computeGroupImpact (emptiness), computeNodeExtras
 * (the rollup the Structure lenses and node home share), directMemberPractice +
 * school_summary (the practiceHours composition in api/groups/[id]/home.ts),
 * leadersForNodes (the "Led by" line), and the govt_admins → ownGroupId +
 * callerCanSeeGroup path that resolveGroupTreeCaller runs for a non-admin
 * caller. Token verification (verifyAuthToken) is NOT exercised — that needs a
 * real signed JWT, and minting one for a real person's account is an
 * outward-facing action. Everything downstream of the uid IS exercised.
 *
 * Usage:  node scripts/verify-deborah-orgs.mts [--out <file.json>]
 * Credentials: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY),
 * from the environment or a .env — same loader as the other scripts here.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { computeGroupImpact } from '../api/_utils/schoolGroupDeletion.ts'
import { computeNodeExtras } from '../api/_utils/groupRollups.ts'
import { directMemberPracticeSeconds } from '../api/_utils/directMemberPractice.ts'
import { leadersForNodes } from '../api/_utils/groupLeaderTag.ts'
import { descendantIds } from '../api/_utils/groupSubtree.ts'
import { callerCanSeeGroup } from '../api/_utils/groupTreeAuth.ts'
import { chunk } from '../api/_utils/schoolScope.ts'

export const DOOMED = '049679a1-5e4c-4e08-ad1a-ab0ab66eb678'
export const SURVIVOR = 'b7878832-ffbb-4190-84cb-8cc5ce62c5bd'
export const DEBORAH_UID = 'ae49953a-924e-4c96-b779-9c0cfd1e46ce'
export const MANAGER_UID = '9358d7a5-ddb4-467f-81ff-fdd475d3c589'

export function loadEnv(): void {
  for (const file of [
    path.join(process.cwd(), '.env'),
    '/home/tomcassidy/SSi/ssi-dashboard-v7-clean/.env',
  ]) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
}

export function client(): SupabaseClient {
  loadEnv()
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).')
    process.exit(1)
  }
  return createClient(url, key)
}

/** practiceHours exactly as api/groups/[id]/home.ts composes it for a node. */
async function practiceHoursForNode(svc: SupabaseClient, nodeId: string): Promise<number> {
  const { data: allGroups } = await svc.from('groups').select('id, path, parent_id')
  const subtreeIds = descendantIds((allGroups ?? []) as any[], nodeId)
  const schoolIds = new Set<string>()
  await Promise.all(chunk(subtreeIds).flatMap((batch) => [
    svc.from('schools').select('id').in('node_group_id', batch).then(({ data }) => {
      for (const s of data ?? []) schoolIds.add((s as any).id)
    }),
    svc.from('schools').select('id').in('group_id', batch).then(({ data }) => {
      for (const s of data ?? []) schoolIds.add((s as any).id)
    }),
  ]))
  const classIds = new Set<string>()
  await Promise.all([
    ...chunk(subtreeIds).map(async (batch) => {
      const { data } = await svc.from('classes').select('id').in('group_id', batch).eq('is_active', true)
      for (const c of data ?? []) classIds.add((c as any).id)
    }),
    ...chunk([...schoolIds]).map(async (batch) => {
      const { data } = await svc.from('classes').select('id').in('school_id', batch).eq('is_active', true)
      for (const c of data ?? []) classIds.add((c as any).id)
    }),
  ])
  let hours = 0
  await Promise.all([
    ...chunk([...schoolIds]).map(async (batch) => {
      const { data } = await svc.from('school_summary').select('total_practice_hours').in('school_id', batch)
      for (const r of data ?? []) hours += Number((r as any).total_practice_hours) || 0
    }),
    directMemberPracticeSeconds(svc, {
      subtreeGroupIds: subtreeIds,
      subtreeSchoolIds: [...schoolIds],
      subtreeClassIds: [...classIds],
    }).then((seconds) => { hours += seconds / 3600 }),
  ])
  return Math.round(hours * 1000) / 1000
}

async function namesFor(svc: SupabaseClient, uids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!uids.length) return out
  const { data } = await svc.from('learners').select('user_id, display_name').in('user_id', uids)
  for (const l of data ?? []) if (!out[(l as any).user_id]) out[(l as any).user_id] = (l as any).display_name || 'Unnamed'
  return out
}

async function orgSnapshot(svc: SupabaseClient, groupId: string) {
  const { data: row } = await svc.from('groups').select('*').eq('id', groupId).maybeSingle()
  if (!row) return { groupId, exists: false as const }
  const [impact, extras, practiceHours, leadersByNode] = await Promise.all([
    computeGroupImpact(svc, groupId),
    computeNodeExtras(svc, [groupId]),
    practiceHoursForNode(svc, groupId),
    leadersForNodes(svc, [groupId]),
  ])
  const leaderUids = [...(leadersByNode.get(groupId) || [])]
  const names = await namesFor(svc, leaderUids)
  return {
    groupId,
    exists: true as const,
    name: (row as any).name,
    createdAt: (row as any).created_at,
    impact,
    rollup: extras[groupId]?.rollup,
    practiceHours,
    ledBy: leaderUids.map((u) => names[u] || 'Unnamed').sort(),
    leaderUids: leaderUids.sort(),
  }
}

/** The non-admin half of resolveGroupTreeCaller, from the uid down. */
async function callerSnapshot(svc: SupabaseClient, uid: string) {
  const { data: govt } = await svc.from('govt_admins').select('group_id').eq('user_id', uid).maybeSingle()
  const ownGroupId = ((govt as any)?.group_id as string | undefined) ?? null
  const caller = { userId: uid, isAdmin: false, ownGroupId }
  const [canSeeSurvivor, canSeeDoomed] = await Promise.all([
    callerCanSeeGroup(svc, caller, SURVIVOR),
    callerCanSeeGroup(svc, caller, DOOMED),
  ])
  const { data: tags } = await svc
    .from('user_tags')
    .select('id, tag_type, tag_value, role_in_context, removed_at')
    .eq('user_id', uid)
  const { data: dangling } = ownGroupId
    ? await svc.from('groups').select('id').eq('id', ownGroupId).maybeSingle()
    : { data: null }
  return {
    uid,
    ownGroupId,
    ownGroupExists: ownGroupId ? Boolean(dangling) : null,
    canSeeSurvivor,
    canSeeDoomed,
    tags: tags ?? [],
  }
}

export async function snapshot(svc: SupabaseClient) {
  const { data: forest } = await svc.from('groups').select('id, name, parent_id, path')
  const [doomed, survivor, deborah, manager] = await Promise.all([
    orgSnapshot(svc, DOOMED),
    orgSnapshot(svc, SURVIVOR),
    callerSnapshot(svc, DEBORAH_UID),
    callerSnapshot(svc, MANAGER_UID),
  ])
  return {
    groupCount: (forest ?? []).length,
    groupIds: (forest ?? []).map((g) => (g as any).id).sort(),
    doomed,
    survivor,
    deborah,
    manager,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outIdx = process.argv.indexOf('--out')
  const out = outIdx >= 0 ? process.argv[outIdx + 1] : null
  const svc = client()
  const snap = await snapshot(svc)
  const json = JSON.stringify(snap, null, 2)
  console.log(json)
  if (out) {
    fs.writeFileSync(out, json + '\n')
    console.log(`\nwritten: ${out}`)
  }
}
