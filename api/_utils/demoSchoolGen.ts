/**
 * demoSchoolGen — provisioning engine behind /admin/demos
 * (api/admin/demo-schools.ts). "Demos" spec (Tom, 2026-07-17): NO teachers,
 * classes, or students anywhere in the UI or flow — a demo is an arbitrary-
 * depth group hierarchy (the same founder org model as the real
 * `AdminStructure.vue` tree) whose leaves hold LEARNERS directly. Provisioning
 * here creates just the root organisation group and its first joinable leaf
 * (via demoLeaf.ts's ensureDemoLeafClass — a hidden school+class the Demos
 * UI never names or shows); the admin grows the tree afterwards from
 * AdminDemoSchools.vue, each new leaf getting its own hidden join target the
 * same way.
 *
 * Previously this seeded a full showcase (fake staff auth accounts, fake
 * students, session/progress rows) per the old "Demo Schools" school-sales
 * tool — removed with the spec, not merely hidden (dead code left in place
 * would drift). `pick`/`between`/`weekdayTimestamp`/`insertChunked`/
 * `resolveMaxSeed`/`DAY` stay exported: `demoSchoolRefresh.ts`'s "Refresh
 * Activity" action still applies to any pre-2026-07-17 legacy demo_orgs rows
 * that DO carry seeded staff/students.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureDemoLeafClass } from './demoLeaf'

export interface DemoOrgSpec {
  prospectName: string
  courseCode: string
  createdBy: string
}

export interface DemoOrgResult {
  demoOrgId: string
  orgName: string
  courseCode: string
  groupId: string
  studentJoinCode: string
  expiresAt: string
}

// ---------- seeded-ish PRNG (Math.random is fine here — sales showcase
// data, not test fixtures that need reproducibility) ----------
// Exported for reuse by demoSchoolRefresh.ts (legacy "Refresh Activity") —
// same engagement-mix shape must continue on top-up, not a fresh random draw.
export const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
export const between = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))
export const DAY = 86400000

// Weekday-clustered timestamp (~85% land Mon-Fri) — real classroom/practice
// activity isn't uniform across the week; a demo that IS uniform reads as
// synthetic at a glance.
export function weekdayTimestamp(startMs: number, endMs: number): Date {
  for (let attempt = 0; attempt < 8; attempt++) {
    const t = startMs + Math.random() * (endMs - startMs)
    const day = new Date(t).getDay() // 0=Sun..6=Sat
    if (day !== 0 && day !== 6) return new Date(t)
    if (Math.random() < 0.15) return new Date(t) // let a minority land on weekends anyway
  }
  return new Date(startMs + Math.random() * (endMs - startMs))
}

export async function insertChunked(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const { error } = await supabase.from(table).insert(chunk)
    if (error) throw new Error(`${table} bulk insert failed: ${error.message}`)
  }
}

// Shared with demoSchoolRefresh.ts — the course's own seed count caps how far
// any learner (fresh or continuing) can plausibly be advanced.
export async function resolveMaxSeed(supabase: SupabaseClient, courseCode: string): Promise<number> {
  const { count: seedCount } = await supabase
    .from('course_seeds')
    .select('seed_number', { count: 'exact', head: true })
    .eq('course_code', courseCode)
  return Math.max(20, Math.min(45, (seedCount ?? 45) - 5))
}

export async function provisionDemoOrg(
  supabase: SupabaseClient,
  spec: DemoOrgSpec,
): Promise<DemoOrgResult> {
  const { prospectName, courseCode, createdBy } = spec

  // Phantom-course guard — server-side, not just the client dropdown. A demo
  // may be shaped to any language pair a prospect wants, so it accepts the
  // full canonical learner catalogue (new_app_status IN ('live','beta') —
  // the same set App.vue / api/courses/available.ts surface to real
  // learners). draft/not_available codes are still rejected: they'd leave the
  // demo's first join code pointing at content nobody can play.
  const PLAYABLE_STATUSES = ['live', 'beta']
  const { data: course, error: courseErr } = await supabase
    .from('courses')
    .select('course_code, new_app_status')
    .eq('course_code', courseCode)
    .maybeSingle()
  if (courseErr || !course || !PLAYABLE_STATUSES.includes(course.new_app_status)) {
    throw new Error(`course_code "${courseCode}" is not an available course`)
  }

  // ---- root organisation group (founder org model — the root of the
  // groups tree, is_demo cascading to whatever the admin builds under it
  // via the Demos tree UI). ----
  const { data: group, error: groupErr } = await supabase
    .from('groups')
    .insert({
      name: prospectName,
      type: 'organisation',
      is_demo: true,
      is_test: true,
      // A demo org's name is chosen deliberately by the admin minting it,
      // never a leader's placeholder guess — so it starts already
      // "confirmed" (mirrors schools.name_confirmed's own true default).
      name_confirmed: true,
    })
    .select('id')
    .single()
  if (groupErr || !group) throw new Error(`groups insert failed: ${groupErr?.message}`)
  const groupId = group.id as string

  // ---- the root's own hidden leaf, so a fresh demo has a join code ready
  // immediately, before the admin grows the tree any further. ----
  // Pass the course explicitly: the owning demo_orgs row is inserted just
  // below, so ensureDemoLeafClass cannot yet resolve it by walking the tree.
  const leaf = await ensureDemoLeafClass(supabase, groupId, createdBy, courseCode)
  if ('error' in leaf) throw new Error(`root leaf provisioning failed: ${leaf.error}`)

  const expiresAt = new Date(Date.now() + 30 * DAY).toISOString()

  const { data: demoOrg, error: demoOrgErr } = await supabase
    .from('demo_orgs')
    .insert({
      created_by: createdBy,
      prospect_name: prospectName,
      // No more shapes to pick from (arbitrary tree, grown after creation) —
      // 'group' is a fixed, non-surfaced bookkeeping value satisfying the
      // column's legacy CHECK constraint.
      org_shape: 'group',
      course_code: courseCode,
      group_id: groupId,
      school_id: null,
      expires_at: expiresAt,
      status: 'active',
      metadata: { orgName: prospectName },
    })
    .select('id')
    .single()
  if (demoOrgErr || !demoOrg) throw new Error(`demo_orgs insert failed: ${demoOrgErr?.message}`)

  return {
    demoOrgId: demoOrg.id as string,
    orgName: prospectName,
    courseCode,
    groupId,
    studentJoinCode: leaf.studentJoinCode,
    expiresAt,
  }
}
