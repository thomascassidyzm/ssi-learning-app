#!/usr/bin/env node
/**
 * Read-only: summarise a learner's recent player_events by session, to spot a
 * mid-stream session reset (a new session_id) and which build they're on.
 *
 * Run:  node scripts/check-learner-tele.cjs <email> [coursePrefix] [hoursBack]
 *   e.g. node scripts/check-learner-tele.cjs aran@hey.com hrv 4
 * Needs VITE_SUPABASE_URL + a service key in env / .env.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

const email = process.argv[2];
const coursePrefix = process.argv[3] || '';
const hoursBack = Number(process.argv[4] || 4);
if (!email) { console.error('usage: check-learner-tele.cjs <email> [coursePrefix] [hoursBack]'); process.exit(1); }

const t = (s) => new Date(s).toISOString().replace('T', ' ').slice(0, 19);

(async () => {
  // 1. Resolve learner by verified_emails (array) then email column.
  let learner = null;
  let { data: byArr } = await supabase.from('learners').select('id, user_id, verified_emails').contains('verified_emails', [email]);
  if (byArr && byArr.length) learner = byArr[0];
  if (!learner) {
    const { data: byCol } = await supabase.from('learners').select('id, user_id, verified_emails').eq('email', email);
    if (byCol && byCol.length) learner = byCol[0];
  }
  if (!learner) { console.error(`No learner found for ${email}`); process.exit(1); }
  console.log(`\nlearner.id=${learner.id}  user_id=${learner.user_id || '(none)'}  for ${email}\n`);

  // 2. Recent player_events for this learner (by stamped payload.learnerId).
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
  let q = supabase.from('player_events')
    .select('occurred_at, session_id, event_type, course_code, client_version, payload')
    .eq('payload->>learnerId', learner.id)
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true });
  if (coursePrefix) q = q.like('course_code', `${coursePrefix}%`);
  let { data: ev } = await q;
  ev = ev || [];
  // Fallback: some logged-in events may key on user_id, not payload.learnerId.
  if (!ev.length && learner.user_id) {
    let q2 = supabase.from('player_events')
      .select('occurred_at, session_id, event_type, course_code, client_version, payload')
      .eq('user_id', learner.user_id).gte('occurred_at', since).order('occurred_at', { ascending: true });
    if (coursePrefix) q2 = q2.like('course_code', `${coursePrefix}%`);
    ev = (await q2).data || [];
  }

  console.log(`${ev.length} events in the last ${hoursBack}h${coursePrefix ? ` on ${coursePrefix}*` : ''}\n`);
  if (!ev.length) return;

  // 3. Group by session_id → first/last/count/builds.
  const sessions = new Map();
  for (const e of ev) {
    const s = sessions.get(e.session_id) || { first: e.occurred_at, last: e.occurred_at, n: 0, builds: new Set(), types: {}, course: e.course_code };
    s.last = e.occurred_at; s.n++; s.builds.add(e.client_version || '?');
    s.types[e.event_type] = (s.types[e.event_type] || 0) + 1;
    sessions.set(e.session_id, s);
  }
  const ordered = [...sessions.entries()].sort((a, b) => new Date(a[1].first) - new Date(b[1].first));
  console.log(`SESSIONS (${ordered.length} — more than 1 mid-stream = a RESET):\n`);
  for (const [sid, s] of ordered) {
    const mins = Math.round((new Date(s.last) - new Date(s.first)) / 60000);
    console.log(`  session ${sid.slice(0, 8)}…  ${t(s.first)} → ${t(s.last)}  (~${mins}m, ${s.n} events)  course=${s.course}`);
    console.log(`     builds: ${[...s.builds].join(', ')}`);
  }
  console.log(`\nfirst event: ${t(ev[0].occurred_at)}   last event: ${t(ev[ev.length - 1].occurred_at)}`);
})().catch(e => { console.error(e); process.exit(1); });
