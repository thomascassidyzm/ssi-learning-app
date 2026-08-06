#!/usr/bin/env node
/**
 * repair-group-leader-membership.cjs — backfill leader MEMBERSHIP tags.
 *
 * Founder ruling (Tom, 2026-08-06): "the creator of a group/org must
 * automatically become its first manager (group leader)." Going forward that
 * is enforced at creation (api/_utils/groupLeaderTag.ts, wired into
 * createRootOrgAndLeader and POST /api/groups). Orgs created BEFORE the ruling
 * have a `govt_admins` row — authz — and no `user_tags` membership, which is
 * what every people list in the org UI actually reads.
 *
 * This writes the missing membership rows. It is:
 *   - ADDITIVE ONLY. It inserts `user_tags` rows. It never deletes, never
 *     updates, never touches `groups`, `govt_admins`, or any org's existence.
 *     The standing "recommend, do not delete" instruction on the duplicate
 *     Deborah Testing orgs is untouched by this script.
 *   - IDEMPOTENT. A leader who already has the tag is skipped.
 *   - REVERSIBLE. Every inserted row is printed with its id and echoed to
 *     --log <file>; undo is a soft delete of exactly those ids:
 *       update user_tags set removed_at = now() where id in (<ids>);
 *
 * Usage:
 *   node scripts/repair-group-leader-membership.cjs --group <id> [--group <id>…]
 *        [--also <groupId>:<authUid>]   extra leader to add (Tom's explicit call)
 *        [--apply]                      default is DRY RUN
 *        [--log repair-log.json]
 *
 * Credentials: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
 * from the environment or a .env in cwd — same pattern as the other scripts here.
 */

const fs = require('fs')
const path = require('path')

function loadEnv() {
  const file = path.join(process.cwd(), '.env')
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
    }
  }
}
loadEnv()

const URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim()
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY).')
  process.exit(1)
}

const LEADER_ROLE = 'admin' // must match api/_utils/groupLeaderTag.ts

async function rest(query, init = {}) {
  const res = await fetch(`${URL}/rest/v1/${query}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${query} :: ${text}`)
  return text ? JSON.parse(text) : null
}

function parseArgs(argv) {
  const groups = []
  const also = []
  let apply = false
  let log = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--group') groups.push(argv[++i])
    else if (argv[i] === '--also') also.push(argv[++i])
    else if (argv[i] === '--apply') apply = true
    else if (argv[i] === '--log') log = argv[++i]
  }
  return { groups, also, apply, log }
}

async function main() {
  const { groups, also, apply, log } = parseArgs(process.argv.slice(2))
  if (groups.length === 0 && also.length === 0) {
    console.error('Nothing to do. Pass --group <id> and/or --also <groupId>:<authUid>.')
    process.exit(1)
  }
  console.log(apply ? '=== APPLY ===' : '=== DRY RUN (pass --apply to write) ===')

  // Intended (groupId, userId) pairs: every govt_admins leader of each named
  // group, plus any explicit --also additions.
  const intended = []
  for (const groupId of groups) {
    const leaders = await rest(`govt_admins?select=user_id,group_id&group_id=eq.${groupId}`)
    if (leaders.length === 0) console.log(`  ! ${groupId} has no govt_admins leader — nothing to backfill from`)
    for (const l of leaders) intended.push({ groupId, userId: l.user_id, why: 'govt_admins leader of this group' })
  }
  for (const spec of also) {
    const [groupId, userId] = spec.split(':')
    if (!groupId || !userId) throw new Error(`--also must be <groupId>:<authUid>, got "${spec}"`)
    intended.push({ groupId, userId, why: 'explicit --also' })
  }

  // Names, so the log reads like people rather than uuids.
  const uids = [...new Set(intended.map((i) => i.userId))]
  const learners = uids.length
    ? await rest(`learners?select=user_id,display_name,verified_emails&user_id=in.(${uids.join(',')})`)
    : []
  const nameOf = new Map(learners.map((l) => [l.user_id, l.display_name]))
  const groupIds = [...new Set(intended.map((i) => i.groupId))]
  const groupRows = groupIds.length
    ? await rest(`groups?select=id,name,created_at&id=in.(${groupIds.join(',')})`)
    : []
  const groupName = new Map(groupRows.map((g) => [g.id, g.name]))

  const written = []
  const skipped = []
  for (const item of intended) {
    const tagValue = `GROUP:${item.groupId}`
    const existing = await rest(
      `user_tags?select=id&user_id=eq.${item.userId}&tag_type=eq.group&tag_value=eq.${encodeURIComponent(tagValue)}&role_in_context=eq.${LEADER_ROLE}&removed_at=is.null`,
    )
    const label = `${nameOf.get(item.userId) || item.userId} → "${groupName.get(item.groupId) || item.groupId}"`
    if (existing.length > 0) {
      console.log(`  = SKIP  ${label} (already a leader member, tag ${existing[0].id})`)
      skipped.push({ ...item, reason: 'already tagged', tagId: existing[0].id })
      continue
    }
    if (!apply) {
      console.log(`  + WOULD WRITE  ${label}  [${item.why}]`)
      written.push({ ...item, tagId: null, applied: false })
      continue
    }
    const [row] = await rest('user_tags', {
      method: 'POST',
      body: JSON.stringify({
        user_id: item.userId,
        tag_type: 'group',
        tag_value: tagValue,
        role_in_context: LEADER_ROLE,
        added_by: item.userId,
      }),
    })
    console.log(`  + WROTE  ${label}  tag id ${row.id}`)
    written.push({ ...item, tagId: row.id, applied: true, name: nameOf.get(item.userId) || null, group: groupName.get(item.groupId) || null })
  }

  console.log(`\n${apply ? 'Wrote' : 'Would write'} ${written.length} row(s); skipped ${skipped.length}.`)
  if (apply && written.length > 0) {
    console.log('\nUNDO (soft delete — never a hard delete):')
    console.log(`  update user_tags set removed_at = now() where id in (${written.map((w) => `'${w.tagId}'`).join(', ')});`)
  }
  if (log) {
    fs.writeFileSync(log, JSON.stringify({ apply, written, skipped }, null, 2))
    console.log(`\nLog written to ${log}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
