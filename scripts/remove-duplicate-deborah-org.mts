/**
 * remove-duplicate-deborah-org.mts — remove the EMPTY duplicate "Deborah
 * Testing" organisation, reversibly.
 *
 * FOUNDER RULING (Tom, 2026-08-06): "Ok cool - remove for Deborah" — on the
 * fork "keep `b7878832` (05 Aug, holds the learner and the practice), remove
 * the empty `049679a1`; the only cost is the spare +mgr@ account losing its
 * leader seat." That cost was accepted in advance and is the intended outcome.
 * Provenance: docs/schools/deborah-leader-repair-2026-08-06.json (the repair
 * worker that discovered the two orgs were eating each other's rollups).
 *
 * REVERSIBILITY. `groups` has no archived_at/deleted_at column and adding one
 * to soft-delete a single row fails better × simpler × cheaper, so the
 * mechanism is: a COMMITTED full-row export (docs/schools/
 * deborah-duplicate-org-removal-2026-08-06.json, written by this script's dry
 * run and committed BEFORE any apply) plus a hard delete of the org row and
 * its scaffolding. Where a table already supports soft delete it is used:
 * the two leader `user_tags` rows are retired with `removed_at`, never deleted
 * (same undo the repair script documented).
 *
 * DELETION ORDER mirrors deleteGroupCascade() in api/_utils/schoolGroupDeletion.ts
 * — the FK-safe order this repo has proved out — with two deliberate departures,
 * which is why the util is not called directly:
 *   1. `user_tags` GROUP: rows are SOFT-deleted (removed_at), not hard-deleted.
 *   2. The subtree is resolved through `parent_id` (groupSubtree.descendantIds),
 *      NOT through the slug `path`. Both Deborah orgs have path 'deborah-testing',
 *      so a path walk ('deborah-testing/%') would sweep any child of the SURVIVING
 *      org into this deletion. There are no children today (verified), but the
 *      path walk is the wrong instrument for a duplicated slug and this script
 *      will not use it. [Reported to Tom as a latent hazard in the shared util.]
 * Every other step is the same set of tables in the same order: invite_codes
 * unlink + delete, govt_admins, node-schools, legacy school ungroup, classes
 * detach, group tags, then the groups row.
 *
 * SAFETY. Dry run by default; --apply required to write. Every row is
 * re-read and asserted against the export before it is touched (drift aborts).
 * Emptiness is re-proved live via computeGroupImpact() before anything happens,
 * and any learner / session with cycles / school / class / descendant group
 * aborts the run — an unexpectedly non-empty org means the premise Tom ruled on
 * was wrong, and that is his call, not this script's.
 *
 * Usage:
 *   node --import ./scripts/ts-resolve-hook.mjs scripts/remove-duplicate-deborah-org.mts \
 *        [--export docs/schools/deborah-duplicate-org-removal-2026-08-06.json] \
 *        [--log <file.json>] [--apply]
 *
 * Credentials: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).
 */

import fs from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { computeGroupImpact } from '../api/_utils/schoolGroupDeletion.ts'
import { descendantIds } from '../api/_utils/groupSubtree.ts'
import { loadEnv } from './verify-deborah-orgs.mts'

const DOOMED = '049679a1-5e4c-4e08-ad1a-ab0ab66eb678'
const SURVIVOR = 'b7878832-ffbb-4190-84cb-8cc5ce62c5bd'
/** Deborah's leader tag on the SURVIVING org — must never be touched. */
const PROTECTED_TAG = 'fdaa4c6a-d47b-48fe-81df-539cd4d42c44'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const exportPath = args.includes('--export') ? args[args.indexOf('--export') + 1]
  : 'docs/schools/deborah-duplicate-org-removal-2026-08-06.json'
const logPath = args.includes('--log') ? args[args.indexOf('--log') + 1] : null
const RUN_AT = new Date().toISOString()

loadEnv()
const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).')
  process.exit(1)
}
const svc: SupabaseClient = createClient(url, key)

function die(msg: string): never {
  console.error(`\nABORT: ${msg}`)
  process.exit(1)
}

async function rows(table: string, filter: (q: any) => any): Promise<any[]> {
  const { data, error } = await filter(svc.from(table).select('*'))
  if (error) die(`${table} read failed: ${error.message}`)
  return (data ?? []) as any[]
}

// ─── 1. Re-prove emptiness, live ───────────────────────────────────────────
const group = (await rows('groups', (q: any) => q.eq('id', DOOMED)))[0]
if (!group) die(`group ${DOOMED} does not exist — nothing to do (already removed?)`)

const impact = await computeGroupImpact(svc, DOOMED)
const { data: forest } = await svc.from('groups').select('id, name, parent_id, path')
const subtree = descendantIds((forest ?? []) as any[], DOOMED)
const descendants = subtree.filter((id) => id !== DOOMED)

const groupTags = await rows('user_tags', (q: any) => q.eq('tag_value', `GROUP:${DOOMED}`))
const govtAdmins = await rows('govt_admins', (q: any) => q.eq('group_id', DOOMED))
const inviteCodes = await rows('invite_codes', (q: any) => q.eq('grants_group_id', DOOMED))
const entitlements = await rows('entitlement_grants', (q: any) => q.eq('group_id', DOOMED))
const classesHere = await rows('classes', (q: any) => q.eq('group_id', DOOMED))
const schoolsParented = await rows('schools', (q: any) => q.eq('group_id', DOOMED))
const schoolsNoded = await rows('schools', (q: any) => q.eq('node_group_id', DOOMED))
const demoOrgs = await rows('demo_orgs', (q: any) => q.eq('group_id', DOOMED))

const blockers: string[] = []
if (impact.learnerCount > 0) blockers.push(`learnerCount=${impact.learnerCount}`)
if (impact.teacherCount > 0) blockers.push(`teacherCount=${impact.teacherCount}`)
if (impact.hasRealActivity) blockers.push('hasRealActivity=true (a session with cycles_completed > 0)')
if (impact.sessionCount > 0) blockers.push(`sessionCount=${impact.sessionCount}`)
if (impact.classCount > 0 || classesHere.length) blockers.push(`classes=${impact.classCount + classesHere.length}`)
if (schoolsParented.length || schoolsNoded.length) blockers.push(`schools=${schoolsParented.length + schoolsNoded.length}`)
if (descendants.length) blockers.push(`descendantGroups=${descendants.length}`)
if (entitlements.length) blockers.push(`entitlement_grants=${entitlements.length}`)
if (demoOrgs.length) blockers.push(`demo_orgs=${demoOrgs.length}`)
const studentTags = groupTags.filter((t) => t.role_in_context === 'student' && !t.removed_at)
if (studentTags.length) blockers.push(`student membership tags=${studentTags.length}`)
if (inviteCodes.some((c) => Number(c.use_count) > 0)) blockers.push('invite_codes with use_count > 0')

console.log(`\n=== Doomed org ${DOOMED} ("${group.name}", created ${group.created_at})`)
console.log('   impact:', JSON.stringify(impact))
console.log(`   scaffolding: user_tags=${groupTags.length} govt_admins=${govtAdmins.length} invite_codes=${inviteCodes.length}`)
if (blockers.length) {
  die(`the doomed org is NOT empty — ${blockers.join('; ')}.\n`
    + 'Tom ruled on removing an EMPTY duplicate. Nothing changed. This is a finding for him, not a judgement call here.')
}
console.log('   EMPTY — re-proved live. No learners, no practice, no schools, no classes, no descendants.')

if (groupTags.some((t) => t.id === PROTECTED_TAG)) die('protected surviving-org tag appeared in the doomed set — refusing')

// ─── 2. Full-row export ────────────────────────────────────────────────────
const exportDoc = {
  ruling: 'Tom, 2026-08-06: "Ok cool - remove for Deborah" — remove the EMPTY duplicate '
    + '"Deborah Testing" org 049679a1, keep b7878832 (05 Aug, holds the learner and the practice). '
    + 'Accepted cost: the +mgr@ account (9358d7a5, "Deb Test Manager") loses its leader seat.',
  provenance: 'docs/schools/deborah-leader-repair-2026-08-06.json (Deborah field-report worker #2)',
  runAt: RUN_AT,
  ranBy: 'scripts/remove-duplicate-deborah-org.mts (Claude worker, Kai account)',
  removedOrgId: DOOMED,
  survivingOrgId: SURVIVOR,
  emptinessProof: { impact, descendantGroupIds: descendants, demoOrgs: demoOrgs.length },
  rows: {
    groups: [group],
    user_tags: groupTags,
    govt_admins: govtAdmins,
    invite_codes: inviteCodes,
    entitlement_grants: entitlements,
    classes: classesHere,
    schools_parented: schoolsParented,
    schools_noded: schoolsNoded,
    demo_orgs: demoOrgs,
    descendant_groups: [] as any[],
  },
  restoreProcedure: [
    '1. INSERT the `groups` row above verbatim (all columns, same id 049679a1-…). '
      + 'The path/slug trigger will recompute `path`; it was "deborah-testing", the same slug as the '
      + 'surviving org — that duplication is the original defect, not something to preserve deliberately.',
    '2. INSERT the `govt_admins` row(s) above verbatim (id 7e1e625d-…, user 9358d7a5-…). This is what '
      + 'restores the +mgr@ account\'s leader seat and its ownGroupId in resolveGroupTreeCaller.',
    '3. UN-retire the leader membership tags: '
      + 'update user_tags set removed_at = null where id in (\'58390b6f-8760-440a-9f34-004382523308\', '
      + '\'1a081ecc-315e-415a-b2ab-ad10f9c41170\');  — the rows themselves were never deleted.',
    '4. There were no invite_codes, entitlement_grants, classes, schools, demo_orgs or descendant groups '
      + 'attached, so nothing else needs re-inserting. If a future run of this script finds any, they are '
      + 'exported above in full and re-insert in this order: invite_codes → schools → classes → entitlement_grants.',
    '5. Verify with: node --import ./scripts/ts-resolve-hook.mjs scripts/verify-deborah-orgs.mts',
  ],
}

fs.writeFileSync(exportPath, JSON.stringify(exportDoc, null, 2) + '\n')
console.log(`\nexport written: ${exportPath}`)

if (!APPLY) {
  console.log('\nDRY RUN — nothing written to the database. Re-run with --apply to remove.')
  console.log('Would soft-delete (user_tags.removed_at):', groupTags.map((t) => t.id).join(', ') || '(none)')
  console.log('Would delete: govt_admins', govtAdmins.map((r) => r.id).join(', ') || '(none)',
    '| invite_codes', inviteCodes.map((r) => r.id).join(', ') || '(none)',
    '| groups', DOOMED)
  process.exit(0)
}

// ─── 3. Apply, mirroring deleteGroupCascade's order ─────────────────────────
const touched: any[] = []

/** Re-read a row and assert it still matches what we exported. */
async function assertUnchanged(table: string, id: string, expected: any): Promise<void> {
  const { data, error } = await svc.from(table).select('*').eq('id', id).maybeSingle()
  if (error) die(`${table} re-read failed: ${error.message}`)
  if (!data) die(`${table} row ${id} vanished between export and apply — state drifted, refusing`)
  if (JSON.stringify(data) !== JSON.stringify(expected)) {
    die(`${table} row ${id} changed between export and apply — state drifted, refusing.\n`
      + `  exported: ${JSON.stringify(expected)}\n  live:     ${JSON.stringify(data)}`)
  }
}

// 3a. invite_codes: unlink govt_admins pointers, then delete codes (none today).
for (const c of inviteCodes) {
  await assertUnchanged('invite_codes', c.id, c)
  const { error } = await svc.from('invite_codes').delete().eq('id', c.id)
  if (error) die(`invite_codes delete failed: ${error.message}`)
  touched.push({ table: 'invite_codes', id: c.id, action: 'deleted', undo: 'INSERT the exported row verbatim' })
}

// 3b. govt_admins — the authz seat. Hard delete (no soft-delete column; FK has
//     no ON DELETE, so this must precede the groups delete).
for (const g of govtAdmins) {
  await assertUnchanged('govt_admins', g.id, g)
  const { error: unlinkErr } = await svc.from('govt_admins').update({ invite_code_id: null }).eq('id', g.id).not('invite_code_id', 'is', null)
  if (unlinkErr) die(`govt_admins invite_code_id unlink failed: ${unlinkErr.message}`)
  const { error } = await svc.from('govt_admins').delete().eq('id', g.id)
  if (error) die(`govt_admins delete failed: ${error.message}`)
  touched.push({ table: 'govt_admins', id: g.id, action: 'deleted', user_id: g.user_id, undo: 'INSERT the exported row verbatim' })
}

// 3c. user_tags — SOFT delete (removed_at), the table's own retirement path.
for (const t of groupTags) {
  if (t.id === PROTECTED_TAG) die('refusing to touch the surviving org tag')
  await assertUnchanged('user_tags', t.id, t)
  if (t.removed_at) { touched.push({ table: 'user_tags', id: t.id, action: 'already-removed', undo: 'n/a' }); continue }
  const { error } = await svc.from('user_tags').update({ removed_at: RUN_AT }).eq('id', t.id)
  if (error) die(`user_tags soft-delete failed: ${error.message}`)
  touched.push({
    table: 'user_tags', id: t.id, action: 'soft-deleted', user_id: t.user_id,
    undo: `update user_tags set removed_at = null where id = '${t.id}';`,
  })
}

// 3d. the groups row itself (no schools/classes/descendants to detach — proved above).
await assertUnchanged('groups', DOOMED, group)
{
  const { error } = await svc.from('groups').delete().eq('id', DOOMED)
  if (error) die(`groups delete failed: ${error.message}`)
  touched.push({ table: 'groups', id: DOOMED, action: 'deleted', undo: 'INSERT the exported row verbatim (see restoreProcedure)' })
}

// ─── 4. Re-verify ──────────────────────────────────────────────────────────
const stillThere = (await rows('groups', (q: any) => q.eq('id', DOOMED))).length
const survivorRow = (await rows('groups', (q: any) => q.eq('id', SURVIVOR)))[0]
const survivorTag = (await rows('user_tags', (q: any) => q.eq('id', PROTECTED_TAG)))[0]
const survivorGovt = await rows('govt_admins', (q: any) => q.eq('group_id', SURVIVOR))
const managerLeft = {
  govt_admins: await rows('govt_admins', (q: any) => q.eq('user_id', '9358d7a5-ddb4-467f-81ff-fdd475d3c589')),
  live_tags: (await rows('user_tags', (q: any) => q.eq('user_id', '9358d7a5-ddb4-467f-81ff-fdd475d3c589')))
    .filter((t) => !t.removed_at),
}
if (stillThere) die('the doomed group row is STILL present after delete')
if (!survivorRow) die('the SURVIVING group row is missing — cascade overreached')
if (!survivorTag || survivorTag.removed_at) die('Deborah\'s leader tag on the surviving org was harmed')
if (!survivorGovt.length) die('the surviving org lost its govt_admins row')

const result = {
  apply: true,
  runAt: RUN_AT,
  removedOrgId: DOOMED,
  survivingOrgId: SURVIVOR,
  emptinessProof: impact,
  touched,
  postChecks: {
    doomedGroupRowsRemaining: stillThere,
    survivingGroupIntact: true,
    survivingLeaderTagIntact: survivorTag,
    survivingGovtAdmins: survivorGovt,
    managerAccountLeftHolding: managerLeft,
  },
  undoOneLiner: 'Re-insert the exported groups + govt_admins rows, then: '
    + 'update user_tags set removed_at = null where id in '
    + `(${groupTags.map((t) => `'${t.id}'`).join(', ')});`,
}
console.log('\n' + JSON.stringify(result, null, 2))
if (logPath) {
  fs.writeFileSync(logPath, JSON.stringify(result, null, 2) + '\n')
  console.log(`\nlog written: ${logPath}`)
}
