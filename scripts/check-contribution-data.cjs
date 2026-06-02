#!/usr/bin/env node
/**
 * Diagnose the contribution DATA FLOW for the stats modal.
 *
 * Compares the GLOBAL community rollup the modal's big number reads from
 * (daily_contributions — fed by a trigger on the flaky `sessions` table)
 * against the RELIABLE per-learner table (learner_speaking_opportunities,
 * written directly per cycle). If the rollup is ~0 / far below the
 * per-learner data, the sessions pipeline is dead/stale and we re-point
 * the rollup onto the reliable table (Phase ③).
 *
 * Read-only. Run:  node scripts/check-contribution-data.cjs [course_code]
 *   e.g.           node scripts/check-contribution-data.cjs cym_for_eng
 * Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env / .env.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

const courseCode = process.argv[2] || 'cym_for_eng';
const targetLang = courseCode.split('_for_')[0];

const ymd = (d) => d.toISOString().split('T')[0];
const today = ymd(new Date());
const d7 = ymd(new Date(Date.now() - 7 * 86400000));
const d30 = ymd(new Date(Date.now() - 30 * 86400000));
const sum = (arr, f) => arr.reduce((s, r) => s + (Number(r[f]) || 0), 0);

(async () => {
  console.log(`\n=== contribution data check: ${courseCode}  (target lang = ${targetLang}) ===\n`);

  // GLOBAL rollup — what the modal's big "community" number reads today.
  const { data: dc, error: dcErr } = await supabase
    .from('daily_contributions')
    .select('contribution_date, minutes_practiced, phrases_count, unique_speakers')
    .eq('target_language', targetLang)
    .order('contribution_date', { ascending: false });
  if (dcErr) console.error('daily_contributions error:', dcErr.message);
  const dcRows = dc || [];
  console.log('daily_contributions  (GLOBAL rollup — modal headline, via the sessions trigger)');
  console.log(`  rows: ${dcRows.length}   latest date: ${dcRows[0]?.contribution_date ?? '(none)'}`);
  console.log(`  minutes -> today: ${sum(dcRows.filter(r => r.contribution_date === today), 'minutes_practiced')}` +
              `   7d: ${sum(dcRows.filter(r => r.contribution_date >= d7), 'minutes_practiced')}` +
              `   30d: ${sum(dcRows.filter(r => r.contribution_date >= d30), 'minutes_practiced')}` +
              `   all-time: ${sum(dcRows, 'minutes_practiced')}`);
  console.log(`  phrases all-time: ${sum(dcRows, 'phrases_count')}\n`);

  // RELIABLE per-learner table, aggregated across ALL courses of this language
  // (so it's comparable to the language-wide rollup above).
  const { data: lso, error: lsoErr } = await supabase
    .from('learner_speaking_opportunities')
    .select('day, play_seconds, opportunities, learner_id, course_code')
    .like('course_code', `${targetLang}_for_%`);
  if (lsoErr) console.error('learner_speaking_opportunities error:', lsoErr.message);
  const lsoRows = lso || [];
  const mins = (arr) => Math.floor(sum(arr, 'play_seconds') / 60);
  console.log('learner_speaking_opportunities  (RELIABLE per-learner, all courses of this language)');
  console.log(`  rows: ${lsoRows.length}   distinct learners: ${new Set(lsoRows.map(r => r.learner_id)).size}`);
  console.log(`  minutes -> today: ${mins(lsoRows.filter(r => r.day === today))}` +
              `   7d: ${mins(lsoRows.filter(r => r.day >= d7))}` +
              `   30d: ${mins(lsoRows.filter(r => r.day >= d30))}` +
              `   all-time: ${mins(lsoRows)}`);
  console.log(`  opportunities all-time: ${sum(lsoRows, 'opportunities')}\n`);

  console.log('READ: if the rollup all-time is ~0 or far below the per-learner all-time,');
  console.log('the sessions pipeline is dead/stale -> Phase ③ re-points the rollup onto');
  console.log('learner_speaking_opportunities (signed-in only, which is the intended scope).\n');
})().catch(e => { console.error(e); process.exit(1); });
