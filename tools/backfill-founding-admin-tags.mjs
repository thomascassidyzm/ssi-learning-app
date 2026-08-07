#!/usr/bin/env node
/**
 * Backfill: give every school's FOUNDING admin the user_tags SCHOOL: membership
 * row she never got.
 *
 * The class (Chepstow, 2026-08-06): only api/code/redeem.ts's school_admin_join
 * branch — an admin CLAIMING a vacant seat — ever wrote an admin's SCHOOL: tag.
 * The three paths that CREATE a school with an admin_user_id never did. Every
 * staff-keyed number is derived from user_tags, so the founding admin was
 * invisible in her own school: Angharad had 76 min across 19 sessions and her
 * dashboard headline showed 7m (the two invited teachers only), and she was
 * absent from her own Teachers list. The code fix is in api/_utils/schoolStaff.ts;
 * this heals the schools created before it.
 *
 * WRITES ONLY user_tags INSERTs. No deletions. No updates to schools, learners,
 * or any other table. Idempotent and re-runnable: it re-derives the target set
 * from the live DB every run (never a hard-coded list), and treats 23505 on the
 * user_tags_active_natural_key partial unique index as an already-done no-op —
 * so running it twice is a no-op the second time.
 *
 * Usage (service role required — the anon key silently undercounts):
 *   set -a; . /path/to/.env; set +a
 *   node tools/backfill-founding-admin-tags.mjs            # DRY RUN (default)
 *   node tools/backfill-founding-admin-tags.mjs --apply    # write
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) + SUPABASE_SERVICE_KEY (or
 * SUPABASE_SERVICE_ROLE_KEY).
 *
 * A per-row JSON log is written next to the script as
 * backfill-founding-admin-tags-{dryrun,applied}-log.json.
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

/** Re-derive the target set from the live DB. Never trust a pasted list. */
async function findUntaggedFoundingAdmins() {
  const { data: schools, error } = await svc
    .from('schools')
    .select('id, school_name, admin_user_id, created_at')
    .not('admin_user_id', 'is', null)
  if (error) throw error

  const { data: tags, error: tagErr } = await svc
    .from('user_tags')
    .select('user_id, tag_value')
    .eq('tag_type', 'school')
    .is('removed_at', null)
  if (tagErr) throw tagErr

  const active = new Set(tags.map((t) => `${t.user_id}|${t.tag_value}`))
  return schools
    .filter((s) => !active.has(`${s.admin_user_id}|SCHOOL:${s.id}`))
    .sort((a, b) => String(a.school_name).localeCompare(String(b.school_name)))
}

const targets = await findUntaggedFoundingAdmins()

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${targets.length} school(s) whose founding admin has no active SCHOOL: tag\n`)

const log = []
for (const s of targets) {
  const row = {
    school_id: s.id,
    school_name: s.school_name,
    school_created_at: s.created_at,
    user_id: s.admin_user_id,
    tag_type: 'school',
    tag_value: `SCHOOL:${s.id}`,
    role_in_context: 'admin',
    added_by: s.admin_user_id,
  }

  if (!APPLY) {
    log.push({ ...row, result: 'would-insert' })
    console.log(`  would tag ${s.admin_user_id}  →  SCHOOL:${s.id}  (${s.school_name})`)
    continue
  }

  // Per-row before-state assertion: re-check immediately before writing, so a
  // concurrent redemption between the census above and this write is caught as
  // "already tagged" rather than racing into a 23505 we'd have to interpret.
  const { data: pre, error: preErr } = await svc
    .from('user_tags')
    .select('id')
    .eq('user_id', s.admin_user_id)
    .eq('tag_type', 'school')
    .eq('tag_value', `SCHOOL:${s.id}`)
    .is('removed_at', null)
    .maybeSingle()
  if (preErr) {
    log.push({ ...row, result: 'error', detail: preErr.message })
    console.log(`  ERROR  precheck ${s.school_name}: ${preErr.message}`)
    continue
  }
  if (pre) {
    log.push({ ...row, result: 'already-tagged' })
    console.log(`  skip   ${s.school_name} — already tagged`)
    continue
  }

  const { error: insErr } = await svc.from('user_tags').insert({
    user_id: row.user_id,
    tag_type: row.tag_type,
    tag_value: row.tag_value,
    role_in_context: row.role_in_context,
    added_by: row.added_by,
  })
  if (insErr && insErr.code === '23505') {
    log.push({ ...row, result: 'already-tagged' })
    console.log(`  skip   ${s.school_name} — 23505, already tagged`)
  } else if (insErr) {
    log.push({ ...row, result: 'error', detail: insErr.message })
    console.log(`  ERROR  ${s.school_name}: ${insErr.message}`)
  } else {
    log.push({ ...row, result: 'inserted' })
    console.log(`  TAGGED ${s.admin_user_id}  →  SCHOOL:${s.id}  (${s.school_name})`)
  }
}

const counts = log.reduce((a, r) => ({ ...a, [r.result]: (a[r.result] || 0) + 1 }), {})
console.log('\n' + JSON.stringify(counts))

const logPath = join(HERE, `backfill-founding-admin-tags-${APPLY ? 'applied' : 'dryrun'}-log.json`)
writeFileSync(logPath, JSON.stringify({ mode: APPLY ? 'applied' : 'dryrun', counts, rows: log }, null, 2))
console.log(`log → ${logPath}`)

if (APPLY) {
  const residue = await findUntaggedFoundingAdmins()
  console.log(`\nre-audit: ${residue.length} school(s) still untagged` +
    (residue.length ? ` — ${residue.map((s) => s.school_name).join(', ')}` : ' ✓'))
}
