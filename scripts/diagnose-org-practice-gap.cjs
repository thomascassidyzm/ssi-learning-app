#!/usr/bin/env node
/**
 * diagnose-org-practice-gap.cjs — READ ONLY.
 *
 * Answers "this org's dashboard says nobody has practised — is that true?"
 * end to end, for one org (group) node, with live rows:
 *
 *   1. WHO is attached      — user_tags tag_type='group', plus the govt_admins
 *                             leader row (the "Manager", which is NOT a
 *                             user_tag and so appears in no member list).
 *   2. WHAT they did        — sessions / course_enrollments / player_events /
 *                             lego_progress / seed_progress per learner.
 *                             NB player_events.user_id is a uuid holding
 *                             learners.id, NOT the auth uid (CLAUDE.md).
 *   3. WHAT THE SCREEN SEES — school_summary rows for the subtree's schools,
 *                             i.e. the number /api/groups/:id/home reports as
 *                             practiceHours, and whether the explainer's
 *                             org-not-started rule would fire.
 *
 * Written 2026-08-06 for Deborah's field report ("I've listened to a few
 * phrases but the Manager's screen still says none of them have practised").
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/diagnose-org-practice-gap.cjs <group-id|name-fragment>
 *
 * Credentials are read from the environment or a .env in cwd (same pattern as
 * scripts/check-contribution-data.cjs). Service role: it bypasses RLS to tell
 * you what is really there, so keep it to diagnosis. NOTHING here writes.
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

async function rest(query) {
  const res = await fetch(`${URL}/rest/v1/${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${query} :: ${await res.text()}`)
  return res.json()
}

const list = (arr) => `(${arr.join(',')})`

async function main() {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node scripts/diagnose-org-practice-gap.cjs <group-id|name-fragment>')
    process.exit(1)
  }

  const isUuid = /^[0-9a-f-]{36}$/i.test(target)
  const orgs = await rest(
    isUuid
      ? `groups?select=id,name,type,path,parent_id,created_at&id=eq.${target}`
      : `groups?select=id,name,type,path,parent_id,created_at&name=ilike.*${encodeURIComponent(target)}*`,
  )
  if (orgs.length === 0) {
    console.log(`No group matches "${target}".`)
    return
  }
  if (orgs.length > 1) {
    console.log(`\n⚠  ${orgs.length} groups match "${target}" — DUPLICATE ORGS. Each is diagnosed below.\n`)
  }

  const allGroups = await rest('groups?select=id,name,path')
  const pathById = new Map(allGroups.map((g) => [g.id, g.path]))

  for (const org of orgs) {
    console.log('='.repeat(72))
    console.log(`ORG  ${org.name}  [${org.type}]`)
    console.log(`     id ${org.id}   path ${org.path}   created ${org.created_at}`)

    const subtree = allGroups
      .filter((g) => g.path === org.path || (g.path || '').startsWith(`${org.path}/`))
      .map((g) => g.id)
    console.log(`     subtree nodes: ${subtree.length}`)

    // ── 1. WHO ────────────────────────────────────────────────────────────
    const leaders = await rest(
      `govt_admins?select=user_id,organization_name,created_at&group_id=in.${list(subtree)}`,
    )
    const tags = await rest(
      `user_tags?select=user_id,role_in_context,tag_value,added_at,removed_at&tag_type=eq.group&tag_value=in.${list(subtree.map((id) => `"GROUP:${id}"`))}&removed_at=is.null`,
    )
    const authUids = [...new Set([...leaders.map((l) => l.user_id), ...tags.map((t) => t.user_id)])]
    const learners = authUids.length
      ? await rest(`learners?select=id,user_id,display_name,educational_role,verified_emails&user_id=in.${list(authUids)}`)
      : []
    const byUid = new Map(learners.map((l) => [l.user_id, l]))

    console.log('\n  PEOPLE')
    if (leaders.length === 0) console.log('    (no leader/"Manager" row — govt_admins is empty for this subtree)')
    for (const l of leaders) {
      const p = byUid.get(l.user_id)
      console.log(`    LEADER (govt_admins, in NO member list)  ${p ? p.display_name : '??'}  <${p ? (p.verified_emails || []).join(', ') : '?'}>  role=${p ? p.educational_role : '?'}`)
    }
    for (const t of tags) {
      const p = byUid.get(t.user_id)
      console.log(`    MEMBER (user_tags ${t.role_in_context})  ${p ? p.display_name : '??'}  <${p ? (p.verified_emails || []).join(', ') : '?'}>  learner=${p ? p.id : '—'}`)
    }

    // ── 2. WHAT THEY DID ─────────────────────────────────────────────────
    console.log('\n  TELEMETRY (per learner account)')
    for (const p of learners) {
      const [sessions, enrols, events, legos, seeds] = await Promise.all([
        rest(`sessions?select=course_id,started_at,ended_at,duration_seconds,items_practiced&learner_id=eq.${p.id}&order=started_at.asc`),
        rest(`course_enrollments?select=course_id,enrolled_at,last_practiced_at,last_completed_lego_id&learner_id=eq.${p.id}`),
        // player_events.user_id holds learners.id, NOT the auth uid.
        rest(`player_events?select=event_type&user_id=eq.${p.id}&limit=2000`),
        rest(`lego_progress?select=learner_id&learner_id=eq.${p.id}&limit=1`),
        rest(`seed_progress?select=learner_id&learner_id=eq.${p.id}&limit=1`),
      ])
      const secs = sessions.reduce((s, r) => s + (Number(r.duration_seconds) || 0), 0)
      console.log(`    ${p.display_name} (${p.id})`)
      console.log(`      sessions ${sessions.length} (${secs}s total) · enrollments ${enrols.length} · player_events ${events.length} · lego_progress ${legos.length ? '>0' : '0'} · seed_progress ${seeds.length ? '>0' : '0'}`)
      for (const s of sessions) console.log(`        session ${s.course_id}  ${s.started_at} → ${s.ended_at}  ${s.duration_seconds}s  items=${s.items_practiced}`)
      for (const e of enrols) console.log(`        enrolled ${e.course_id}  last practised ${e.last_practiced_at}  last lego ${e.last_completed_lego_id || '—'}`)
    }

    // ── 3. WHAT THE SCREEN SEES ──────────────────────────────────────────
    const schools = await rest(
      `schools?select=id,school_name&or=(group_id.in.${list(subtree)},node_group_id.in.${list(subtree)})`,
    )
    const summaries = schools.length
      ? await rest(`school_summary?select=school_id,total_practice_hours&school_id=in.${list(schools.map((s) => s.id))}`)
      : []
    const schoolHours = summaries.reduce((s, r) => s + (Number(r.total_practice_hours) || 0), 0)

    console.log('\n  WHAT THE ORG DASHBOARD SEES')
    console.log(`    subtree schools: ${schools.length}  →  school_summary practice hours: ${Math.round(schoolHours * 10) / 10}h`)
    console.log(`    members counted (learnerCount): ${tags.length}`)
    if (tags.length > 0 && schoolHours === 0) {
      console.log('    ⚠  learnerCount > 0 AND school-shaped practice = 0 →')
      console.log('       the explainer rule `org-not-started` fires: "none of them has practised yet".')
      console.log('       If the TELEMETRY block above shows real sessions, that banner is WRONG —')
      console.log('       practiceHours must add directly group-attached people\'s sessions')
      console.log('       (api/_utils/directMemberPractice.ts).')
    }
    console.log('')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
