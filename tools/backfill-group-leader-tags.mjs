#!/usr/bin/env node
/**
 * Backfill: give every org/group LEADER the user_tags GROUP: membership row
 * that records their leadership as a MEMBERSHIP, not only as authz.
 *
 * The twin of tools/backfill-founding-admin-tags.mjs, one level up. A school's
 * founding admin was invisible in her own school because every staff-keyed
 * number is derived from user_tags and she only had schools.admin_user_id. The
 * identical shape exists for orgs: leadership was recorded in `govt_admins`,
 * which is an AUTHZ table, while the org's numbers read `user_tags`.
 *
 * WHAT THIS DOES AND DOES NOT FIX. api/_utils/groupLeaderTag.ts already writes
 * the tag on the org-CREATION paths, and org people LISTS union govt_admins
 * with the leader tag — so leaders' NAMES already appear. Practice HOURS do
 * not union: api/_utils/directMemberPractice.ts is tag-only. So a leader
 * created before that ruling, or one who claimed a seat by code, has their own
 * practice counted NOWHERE in their org's headline. Measured on live prod
 * 2026-08-07: 37 of 41 govt_admins rows had no leader tag; 10 of those leaders
 * had real practice; 85 minutes invisible. This closes that.
 *
 * Founder ruling it applies: 2026-07-18, "a school's headline hours should
 * include staff's OWN practice… a more valid testament to true engagement" —
 * the same ruling directMemberPractice.ts was built to honour for group-tagged
 * people, applied to the leaders it never reached.
 *
 * ROLE: 'admin' (GROUP_LEADER_ROLE in api/_utils/groupLeaderTag.ts) — the one
 * convention, and the one the live check constraint admits. Deliberately NOT
 * 'teacher' or 'student': api/_utils/groupRollups.ts counts a node's teachers
 * and learners by those exact roles, so an 'admin' tag adds the leader's
 * practice to the headline WITHOUT inflating either count. Verified against
 * groupRollups.ts before this script was written.
 *
 * NOT AN AUTHZ CHANGE. resolveGroupTreeCaller still resolves authority from
 * govt_admins alone; the tag grants nothing.
 *
 * WRITES ONLY user_tags INSERTs. No deletions. No updates to groups,
 * govt_admins, learners, or any other table. Idempotent and re-runnable: it
 * re-derives the target set from the live DB every run (never a hard-coded
 * list), and treats 23505 on the user_tags_active_natural_key partial unique
 * index as an already-done no-op.
 *
 * Usage (service role required — the anon key silently undercounts):
 *   set -a; . /path/to/.env; set +a
 *   node tools/backfill-group-leader-tags.mjs            # DRY RUN (default)
 *   node tools/backfill-group-leader-tags.mjs --apply    # write
 *
 * A per-row JSON log is written next to the script as
 * backfill-group-leader-tags-{dryrun,applied}-log.json.
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const APPLY = process.argv.includes('--apply')
const HERE = dirname(fileURLToPath(import.meta.url))

/** Mirrors GROUP_LEADER_ROLE in api/_utils/groupLeaderTag.ts. */
const GROUP_LEADER_ROLE = 'admin'

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY (service role required).')
  process.exit(1)
}
const svc = createClient(url, key)

/** Re-derive the target set from the live DB. Never trust a pasted list. */
async function findUntaggedLeaders() {
  const { data: leaders, error } = await svc
    .from('govt_admins')
    .select('user_id, group_id, organization_name, created_at')
    .not('group_id', 'is', null)
  if (error) throw error

  const { data: tags, error: tagErr } = await svc
    .from('user_tags')
    .select('user_id, tag_value')
    .eq('tag_type', 'group')
    .is('removed_at', null)
  if (tagErr) throw tagErr

  // Any ACTIVE group tag counts as present — a leader who already holds e.g. a
  // 'teacher' tag on their own node must NOT get a second active tag for the
  // same node: user_tags_active_natural_key is unique on
  // (user_id, tag_type, tag_value) REGARDLESS of role, so inserting would 23505.
  const active = new Set(tags.map((t) => `${t.user_id}|${t.tag_value}`))
  return leaders
    .filter((l) => !active.has(`${l.user_id}|GROUP:${l.group_id}`))
    .sort((a, b) => String(a.organization_name ?? '').localeCompare(String(b.organization_name ?? '')))
}

const targets = await findUntaggedLeaders()

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${targets.length} leader(s) with no active GROUP: tag on their own node\n`)

const log = []
for (const l of targets) {
  const row = {
    group_id: l.group_id,
    organization_name: l.organization_name,
    govt_admin_created_at: l.created_at,
    user_id: l.user_id,
    tag_type: 'group',
    tag_value: `GROUP:${l.group_id}`,
    role_in_context: GROUP_LEADER_ROLE,
    added_by: l.user_id,
  }

  if (!APPLY) {
    log.push({ ...row, result: 'would-insert' })
    console.log(`  would tag ${l.user_id}  →  GROUP:${l.group_id}  (${l.organization_name || '—'})`)
    continue
  }

  // Per-row before-state assertion: re-check immediately before writing, so a
  // concurrent redemption between the census above and this write is caught as
  // "already tagged" rather than racing into a 23505 we'd have to interpret.
  const { data: pre, error: preErr } = await svc
    .from('user_tags')
    .select('id')
    .eq('user_id', l.user_id)
    .eq('tag_type', 'group')
    .eq('tag_value', `GROUP:${l.group_id}`)
    .is('removed_at', null)
    .maybeSingle()
  if (preErr) {
    log.push({ ...row, result: 'error', detail: preErr.message })
    console.log(`  ERROR  precheck ${l.organization_name}: ${preErr.message}`)
    continue
  }
  if (pre) {
    log.push({ ...row, result: 'already-tagged' })
    console.log(`  skip   ${l.organization_name || l.group_id} — already tagged`)
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
    console.log(`  skip   ${l.organization_name || l.group_id} — 23505, already tagged`)
  } else if (insErr) {
    log.push({ ...row, result: 'error', detail: insErr.message })
    console.log(`  ERROR  ${l.organization_name || l.group_id}: ${insErr.message}`)
  } else {
    log.push({ ...row, result: 'inserted' })
    console.log(`  TAGGED ${l.user_id}  →  GROUP:${l.group_id}  (${l.organization_name || '—'})`)
  }
}

const counts = log.reduce((a, r) => ({ ...a, [r.result]: (a[r.result] || 0) + 1 }), {})
console.log('\n' + JSON.stringify(counts))

const logPath = join(HERE, `backfill-group-leader-tags-${APPLY ? 'applied' : 'dryrun'}-log.json`)
writeFileSync(logPath, JSON.stringify({ mode: APPLY ? 'applied' : 'dryrun', counts, rows: log }, null, 2))
console.log(`log → ${logPath}`)

if (APPLY) {
  const residue = await findUntaggedLeaders()
  console.log(`\nre-audit: ${residue.length} leader(s) still untagged` + (residue.length ? '' : ' ✓'))
}
