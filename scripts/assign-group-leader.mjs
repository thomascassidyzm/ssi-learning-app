#!/usr/bin/env node
/**
 * assign-group-leader — make an existing account the leader of an existing group.
 * =============================================================================
 *
 * WHY THIS EXISTS (job #572). A funded org's group node can be stood up by
 * api/admin/org-enrolment-setup with nobody leading it — the enrolment link
 * works, learners enrol, the funder numbers accrue, and NOBODY at the org can
 * read them, because every org-scoped read resolves authority from a
 * govt_admins row that does not exist. That was the Canolfan's position on
 * 2026-09-08: two enrolments, a live sign-up link, and an ssi_admin needed for
 * every question about it.
 *
 * The normal way in is an invite code, and it stays the normal way: mint one
 * with api/admin/create-govt-admin and the person becomes leader by redeeming
 * it under their own email. That is right for somebody who has no account yet.
 * It is ceremony for somebody who already signs in here every day — so this
 * script does the SAME three writes redemption does, for an account that
 * already exists:
 *
 *   1. govt_admins  — the AUTHZ row. This alone is what resolveGroupTreeCaller
 *                     reads, and therefore what unlocks the node home, the
 *                     insights and the funder export for their own subtree.
 *   2. user_tags    — the leader MEMBERSHIP, role 'admin' on GROUP:<id>, so
 *                     their own org page names them rather than showing a group
 *                     nobody leads (founder ruling 2026-08-06).
 *   3. learners.educational_role = 'govt_admin' — what the browser routes on,
 *                     so signing in lands them on their org rather than on the
 *                     learner player.
 *
 * Idempotent throughout: run it twice and nothing doubles. It REFUSES to move
 * a leader who already leads a different group — govt_admins carries a unique
 * key on user_id, so that is a real decision about who governs what, not a
 * detail for a script to take silently.
 *
 * Dry run by default. Nothing is written without --apply.
 *
 * Usage:
 *   node scripts/assign-group-leader.mjs --email <address> --group <uuid>
 *   node scripts/assign-group-leader.mjs --email <address> --group <uuid> --apply
 *
 * Credentials: SUPABASE_SERVICE_ROLE_KEY in the environment, or the single
 * line of ~/.ssi-sentinel.env. SUPABASE_URL defaults to the live project.
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
function arg(name) {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}
const email = (arg('email') || '').trim().toLowerCase()
const groupId = (arg('group') || '').trim()
const apply = args.includes('--apply')

if (!email || !groupId) {
  console.error('Usage: node scripts/assign-group-leader.mjs --email <address> --group <uuid> [--apply]')
  process.exit(2)
}

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://swfvymspfxmnfhevgdkg.supabase.co').trim()
let key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
if (!key) {
  const sentinel = path.join(os.homedir(), '.ssi-sentinel.env')
  if (fs.existsSync(sentinel)) {
    const m = fs.readFileSync(sentinel, 'utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)
    if (m) key = m[1].trim()
  }
}
if (!key) {
  console.error('No SUPABASE_SERVICE_ROLE_KEY in the environment or ~/.ssi-sentinel.env')
  process.exit(2)
}

const sb = createClient(url, key)
const say = (...m) => console.log(apply ? '[apply]' : '[dry-run]', ...m)

/** The auth account, by email. No account, no leader — this script never mints people. */
async function findAuthUser(address) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    const hit = (data?.users || []).find((u) => (u.email || '').toLowerCase() === address)
    if (hit) return hit
    if ((data?.users || []).length < 1000) return null
  }
  return null
}

const user = await findAuthUser(email)
if (!user) {
  console.error(`No account for ${email}. They must sign in once before they can lead a group.`)
  process.exit(1)
}

const { data: group, error: groupErr } = await sb
  .from('groups')
  .select('id, name, type')
  .eq('id', groupId)
  .maybeSingle()
if (groupErr) throw new Error(groupErr.message)
if (!group) {
  console.error(`No group ${groupId}.`)
  process.exit(1)
}

say(`${email} → ${user.id}`)
say(`group ${group.id} — ${group.name}`)

// ── 1. The authz row ───────────────────────────────────────────────────────
const { data: existingLeader } = await sb
  .from('govt_admins')
  .select('id, group_id')
  .eq('user_id', user.id)
  .maybeSingle()

if (existingLeader && existingLeader.group_id !== groupId) {
  console.error(
    `REFUSING: ${email} already leads group ${existingLeader.group_id}. ` +
    'One person leads one group, and moving them is a decision, not a fix. ' +
    'Delete or repoint that row deliberately if that is what you mean.',
  )
  process.exit(1)
}

if (existingLeader) {
  say('govt_admins row already there — nothing to write')
} else if (apply) {
  const { error } = await sb.from('govt_admins').insert({
    user_id: user.id,
    group_id: groupId,
    organization_name: group.name,
    created_by: user.id,
  })
  if (error && error.code !== '23505') throw new Error(`govt_admins insert failed: ${error.message}`)
  say('govt_admins row written — this is what unlocks their node home, insights and funder export')
} else {
  say('WOULD write the govt_admins row')
}

// ── 2. The leader membership ───────────────────────────────────────────────
const tagValue = `GROUP:${groupId}`
const { data: existingTag } = await sb
  .from('user_tags')
  .select('id')
  .eq('user_id', user.id)
  .eq('tag_type', 'group')
  .eq('tag_value', tagValue)
  .eq('role_in_context', 'admin')
  .is('removed_at', null)
  .maybeSingle()

if (existingTag) {
  say('leader membership tag already there')
} else if (apply) {
  const { error } = await sb.from('user_tags').insert({
    user_id: user.id,
    tag_type: 'group',
    tag_value: tagValue,
    // 'admin', never 'leader' — the live check constraint admits exactly
    // admin | teacher | student. See api/_utils/groupLeaderTag.ts.
    role_in_context: 'admin',
    added_by: user.id,
  })
  if (error) throw new Error(`user_tags insert failed: ${error.message}`)
  say('leader membership tag written — their own org page will now name them')
} else {
  say('WOULD write the leader membership tag')
}

// ── 3. What the browser routes on ──────────────────────────────────────────
const { data: learner } = await sb
  .from('learners')
  .select('id, display_name, educational_role')
  .eq('user_id', user.id)
  .maybeSingle()

if (!learner) {
  console.error('WARNING: no learners row for this account. The two writes above still grant authority, but the app will not route them to their org until they have signed in once.')
} else if (learner.educational_role === 'govt_admin') {
  say('educational_role already govt_admin')
} else if (apply) {
  const { error } = await sb.from('learners').update({ educational_role: 'govt_admin' }).eq('id', learner.id)
  if (error) throw new Error(`learners update failed: ${error.message}`)
  say(`educational_role ${learner.educational_role ?? 'null'} → govt_admin`)
} else {
  say(`WOULD set educational_role ${learner.educational_role ?? 'null'} → govt_admin`)
}

say(`done. Their page: /org/${groupId}`)
if (!apply) console.log('\nNothing was written. Re-run with --apply to make it so.')
