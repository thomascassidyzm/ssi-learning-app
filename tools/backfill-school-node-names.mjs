#!/usr/bin/env node
/**
 * Backfill: realign every school NODE whose name has drifted from its school
 * record.
 *
 * The class (found live on production, 2026-08-06): a school's name lives in
 * two rows — `schools.school_name` and `groups.name` on the school's own node
 * (`schools.node_group_id`), which is synthesised lazily the first time anyone
 * opens the dashboard. The dashboard heading reads the NODE. Every rename
 * writer wrote only one of the two, so a leader who opened her dashboard and
 * THEN named her school in the wizard read the replaced name for ever, in
 * every browser, on every machine.
 *
 * The code fix is api/_utils/schoolNodeName.ts, wired into all three rename
 * writers (school/update-profile, onboarding/profile, PATCH /api/groups/:id).
 * This heals the schools that drifted before it.
 *
 * WHICH NAME WINS: the school record. `schools.school_name` is what the
 * wizard and Settings write — the surfaces a school's own leader uses to name
 * her school — and it is what rosters, invites, exports and the admin school
 * list already show her. The node is the copy that fell behind. Every row is
 * logged with BOTH names and the node's updated_at, so a divergence that
 * actually ran the other way (an org-tree rename that the school record never
 * heard about) is visible in the dry run before anything is written.
 *
 * WRITES ONLY `groups.name` (+ name_confirmed, updated_at) on rows that ARE a
 * school's node AND currently disagree with it. No inserts. No deletions.
 * Nothing outside `groups`. Idempotent and re-runnable: the target set is
 * re-derived from the live DB every run, never a pasted list, so a second run
 * finds nothing.
 *
 * Usage (service role required — the anon key silently undercounts):
 *   set -a; . /path/to/.env; set +a
 *   node tools/backfill-school-node-names.mjs            # DRY RUN (default)
 *   node tools/backfill-school-node-names.mjs --apply    # write
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY).
 *
 * A per-row JSON log is written next to the script as
 * backfill-school-node-names-{dryrun,applied}-log.json.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const HERE = dirname(fileURLToPath(import.meta.url))

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (service role required).')
  process.exit(1)
}
const svc = createClient(url, key)

const norm = (v) => String(v ?? '').trim()

/** Re-derive the drifted set from the live DB. Never trust a pasted list. */
async function findDriftedNodes() {
  const { data: schools, error } = await svc
    .from('schools')
    .select('id, school_name, node_group_id, is_demo, is_test')
    .not('node_group_id', 'is', null)
  if (error) throw error

  const nodes = new Map()
  const ids = schools.map((s) => s.node_group_id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error: gErr } = await svc
      .from('groups')
      .select('id, name, name_confirmed, updated_at')
      .in('id', ids.slice(i, i + 200))
    if (gErr) throw gErr
    for (const g of data || []) nodes.set(g.id, g)
  }

  const drifted = []
  for (const s of schools) {
    const node = nodes.get(s.node_group_id)
    // A node id that resolves to nothing is a different fault (a dangling
    // link); this script does not invent nodes — ensureSchoolNode does that.
    if (!node) continue
    if (!norm(s.school_name)) continue
    if (norm(node.name) === norm(s.school_name)) continue
    drifted.push({
      school_id: s.id,
      node_id: node.id,
      school_name: s.school_name,
      node_name_before: node.name,
      node_name_after: norm(s.school_name),
      node_updated_at: node.updated_at ?? null,
      is_demo: !!s.is_demo,
      is_test: !!s.is_test,
    })
  }
  return { scanned: schools.length, drifted }
}

const { scanned, drifted } = await findDriftedNodes()
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${scanned} schools with a node scanned, ${drifted.length} drifted.`)

const log = []
for (const row of drifted) {
  console.log(
    `  ${row.school_id}  node ${row.node_id}\n` +
    `      node reads : "${row.node_name_before}"  (updated ${row.node_updated_at ?? 'never'})\n` +
    `      school says: "${row.node_name_after}"${row.is_demo ? '  [demo]' : ''}${row.is_test ? '  [test]' : ''}`,
  )
  if (!APPLY) { log.push({ ...row, result: 'would_update' }); continue }

  // Per-row before-state assertion: re-read immediately before writing and
  // abort this row if the live node no longer reads what the scan saw.
  const { data: fresh, error: reErr } = await svc
    .from('groups').select('id, name').eq('id', row.node_id).maybeSingle()
  if (reErr || !fresh) {
    console.log('      SKIPPED — node re-read failed')
    log.push({ ...row, result: 'skipped_reread_failed', error: reErr?.message ?? 'missing' })
    continue
  }
  if (norm(fresh.name) !== norm(row.node_name_before)) {
    console.log(`      SKIPPED — node drifted under us, now reads "${fresh.name}"`)
    log.push({ ...row, result: 'skipped_changed_under_us', now: fresh.name })
    continue
  }

  const { error: updErr } = await svc
    .from('groups')
    .update({ name: row.node_name_after, name_confirmed: true, updated_at: new Date().toISOString() })
    .eq('id', row.node_id)
  if (updErr) {
    console.log('      FAILED —', updErr.message)
    log.push({ ...row, result: 'failed', error: updErr.message })
  } else {
    console.log('      updated')
    log.push({ ...row, result: 'updated' })
  }
}

const logPath = join(HERE, `backfill-school-node-names-${APPLY ? 'applied' : 'dryrun'}-log.json`)
writeFileSync(logPath, JSON.stringify({ ran_at: new Date().toISOString(), apply: APPLY, scanned, drifted: drifted.length, rows: log }, null, 2))
console.log(`\nlog → ${logPath}`)
if (!APPLY && drifted.length) console.log('Re-run with --apply to write.')
