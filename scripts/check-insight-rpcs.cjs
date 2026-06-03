#!/usr/bin/env node
/**
 * Read-only verification of the Insight Engine analytics RPCs + their source data.
 *
 *  1. Calls each new analytics_* RPC with the service key. Because they are
 *     is_god_user()-gated (RAISE EXCEPTION 'Forbidden' for non-god callers),
 *     the EXPECTED result is the "Forbidden" error — which proves the function
 *     EXISTS, the signature matches, and the gate fires. Anything else
 *     ("function does not exist", a column/relation error) is a real problem.
 *  2. Probes each RPC's source tables/columns directly (service key bypasses
 *     RLS) to confirm the columns the RPC reads exist and have live data, so
 *     the boards won't render empty for the wrong reason.
 *
 * Run:  node scripts/check-insight-rpcs.cjs
 * Needs VITE_SUPABASE_URL/SUPABASE_URL + a service key in env / .env.
 * READ-ONLY: no writes, no auth session created.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../ssi-dashboard-v7-clean/.env') });
require('dotenv').config();

const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Missing SUPABASE url/service key in env'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

(async () => {
  // Grab a real course_id for the friction RPC arg.
  const { data: ce0 } = await db.from('course_enrollments').select('course_id').limit(1);
  const sampleCourse = ce0?.[0]?.course_id || 'spa';

  console.log('\n=== 1. RPC existence + gate (expect "Forbidden: god mode required") ===\n');
  const calls = [
    ['analytics_course_value', {}],
    ['analytics_friction_extended', { p_course_id: sampleCourse }],
    ['analytics_health', { p_days: 30 }],
    ['analytics_retention_days_active', { p_weeks: 12 }],
    ['analytics_trial_conversion', {}],
  ];
  for (const [fn, args] of calls) {
    const { data, error } = await db.rpc(fn, args);
    if (error) {
      const forbidden = /forbidden/i.test(error.message);
      const missing = /does not exist|could not find|schema cache/i.test(error.message);
      if (forbidden) console.log(`  ${ok('PASS')}  ${fn}  ${dim('— installed + gated (Forbidden as expected)')}`);
      else if (missing) console.log(`  ${bad('FAIL')}  ${fn}  ${bad('— NOT FOUND: ' + error.message)}`);
      else console.log(`  ${bad('ERR ')}  ${fn}  ${bad('— ' + error.message)}`);
    } else {
      // Shouldn't happen with service key (no god uid), but if it returns, show it.
      console.log(`  ${ok('RET ')}  ${fn}  ${dim('— returned data (unexpected via service key): ' + JSON.stringify(data).slice(0, 120))}`);
    }
  }

  console.log('\n=== 2. Source columns exist + live data present (service-key direct reads) ===\n');
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const day30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const probes = [
    ['learner_speaking_opportunities (courseValue/retention)',
      () => db.from('learner_speaking_opportunities').select('course_code, learner_id, day, play_seconds').gte('day', day30).limit(5)],
    ['course_enrollments (courseValue)',
      () => db.from('course_enrollments').select('course_id, learner_id, last_practiced_at, total_practice_minutes').limit(5)],
    ['player_events audio_play/failed (health/friction)',
      () => db.from('player_events').select('event_type, device_type, client_version, payload, occurred_at, user_id').in('event_type', ['audio_play', 'audio_failed']).gte('occurred_at', d30).limit(5)],
    ['player_events phase_skip (friction)',
      () => db.from('player_events').select('event_type, payload, course_code').eq('event_type', 'phase_skip').gte('occurred_at', d30).limit(5)],
    ['subscriptions (trialConversion — expect 0 rows)',
      () => db.from('subscriptions').select('learner_id, status, signup_course_code').limit(5)],
    ['sessions (retention)',
      () => db.from('sessions').select('learner_id, course_id, started_at, items_practiced').gte('started_at', d30).limit(5)],
  ];
  for (const [label, q] of probes) {
    const { data, error, count } = await q();
    if (error) { console.log(`  ${bad('FAIL')}  ${label}\n          ${bad(error.message)}`); continue; }
    const n = data?.length ?? 0;
    const cols = n ? Object.keys(data[0]).join(', ') : '(no rows)';
    console.log(`  ${n ? ok('OK  ') : dim('EMPTY')}  ${label}  ${dim('— ' + n + ' sample row(s); cols: ' + cols)}`);
  }

  // courseValue sanity: distinct active courses last 30d + a quick reach-per-course tally
  console.log('\n=== 3. courseValue sanity — distinct active courses (last 30d) ===\n');
  const { data: lso } = await db.from('learner_speaking_opportunities')
    .select('course_code, learner_id, play_seconds').gte('day', day30).limit(5000);
  if (lso?.length) {
    const byCourse = {};
    for (const r of lso) {
      byCourse[r.course_code] = byCourse[r.course_code] || { learners: new Set(), secs: 0 };
      byCourse[r.course_code].learners.add(r.learner_id);
      byCourse[r.course_code].secs += Number(r.play_seconds) || 0;
    }
    const rows = Object.entries(byCourse)
      .map(([c, v]) => [c, v.learners.size, Math.round(v.secs / 3600 * 10) / 10])
      .sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log('  course        reach(30d)  hours(30d)');
    for (const [c, reach, hrs] of rows) console.log(`  ${String(c).padEnd(12)}  ${String(reach).padStart(9)}  ${String(hrs).padStart(9)}`);
    console.log(dim(`\n  (${Object.keys(byCourse).length} courses active in last 30d — the Course Scoreboard treemap will have this many tiles)`));
  } else {
    console.log(dim('  no speaking-opportunity rows in last 30d'));
  }
  console.log('');
})().catch(e => { console.error(bad('\nFATAL: ' + e.message)); process.exit(1); });
