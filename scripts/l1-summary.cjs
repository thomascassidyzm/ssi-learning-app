#!/usr/bin/env node
/**
 * L1 listening summary — diagnose whether Layer 1 listening clusters
 * are firing on the expected schedule for a given learner + course.
 *
 * Usage:
 *   node --env-file=.env.local scripts/l1-summary.cjs <email> <course_code> [--days N]
 *
 * Example:
 *   node --env-file=.env.local scripts/l1-summary.cjs aran@hey.com hrv_for_eng
 *
 * What it shows:
 *   - Round range the learner has completed
 *   - Expected vs actual L1 active fires (every round % 3 == 0)
 *   - Expected vs actual L1 reserve fires (every round % 13 == 0)
 *   - Per-cluster audio play counts and distinct seeds touched
 *
 * Telemetry sources (all in `player_events`, by event_type):
 *   - round_complete      — round progression
 *   - l1_cluster_start    — every L1 cluster boundary (added 2026-05-14)
 *   - audio_play          — every audio file played (added 2026-05-14)
 *
 * NOTE: `player_events.user_id` stores `learners.id`, not `auth.uid()`.
 */

const { createClient } = require('@supabase/supabase-js');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flagDays = (() => {
  const f = process.argv.find(a => a.startsWith('--days='));
  if (!f) return 14;
  const n = parseInt(f.split('=')[1], 10);
  return Number.isFinite(n) && n > 0 ? n : 14;
})();

const [EMAIL, COURSE] = args;
if (!EMAIL || !COURSE) {
  console.error('Usage: node --env-file=.env.local scripts/l1-summary.cjs <email> <course_code> [--days=N]');
  process.exit(1);
}

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

async function main() {
  // 1. Resolve learner by email
  const { data: learners, error: lErr } = await supabase
    .from('learners')
    .select('id, user_id, display_name, verified_emails')
    .or(`verified_emails.cs.{${EMAIL}}`);
  if (lErr) { console.error('Learner lookup failed:', lErr.message); process.exit(1); }
  if (!learners || learners.length === 0) {
    console.error(`No learner found for ${EMAIL}`);
    process.exit(1);
  }
  const learner = learners[0];
  console.log(`\nLearner: ${learner.display_name} (id=${learner.id})\n`);

  const sinceIso = new Date(Date.now() - flagDays * 86400_000).toISOString();

  // 2. Pull telemetry in three event types in parallel
  const [rounds, l1Starts, audioPlays] = await Promise.all([
    supabase.from('player_events').select('occurred_at, payload')
      .eq('user_id', learner.id).eq('course_code', COURSE).eq('event_type', 'round_complete')
      .gte('occurred_at', sinceIso).order('occurred_at', { ascending: true }).limit(2000),
    supabase.from('player_events').select('occurred_at, payload')
      .eq('user_id', learner.id).eq('course_code', COURSE).eq('event_type', 'l1_cluster_start')
      .gte('occurred_at', sinceIso).order('occurred_at', { ascending: true }).limit(2000),
    supabase.from('player_events').select('occurred_at, payload')
      .eq('user_id', learner.id).eq('course_code', COURSE).eq('event_type', 'audio_play')
      .gte('occurred_at', sinceIso).order('occurred_at', { ascending: true }).limit(20000),
  ]);

  const rs = rounds.data || [];
  const l1s = l1Starts.data || [];
  const plays = audioPlays.data || [];

  console.log(`Telemetry in last ${flagDays}d:`);
  console.log(`  round_complete:    ${rs.length}`);
  console.log(`  l1_cluster_start:  ${l1s.length}`);
  console.log(`  audio_play:        ${plays.length}\n`);

  if (rs.length === 0) {
    console.log('No round_complete events — nothing to analyse.');
    return;
  }

  const roundIdxs = rs.map(r => r.payload?.roundIndex).filter(n => Number.isFinite(n));
  const minRound = Math.min(...roundIdxs);
  const maxRound = Math.max(...roundIdxs);
  console.log(`Round range: R${minRound} → R${maxRound}`);
  console.log(`(Distinct completed rounds: ${new Set(roundIdxs).size})\n`);

  // 3. Build a Set of rounds that L1 actually fired on (from l1_cluster_start payload)
  const firedOn = new Set(l1s.map(l => l.payload?.round).filter(n => Number.isFinite(n)));

  // 4. Expected schedule. The graduation offset is 90 rounds; assume the
  // first seed graduates around round 95 and start checking from there.
  // (If the learner has a higher first round, start from that instead.)
  const checkFrom = Math.max(minRound, 90);
  console.log(`=== Expected vs actual L1 fires (R${checkFrom} → R${maxRound}) ===\n`);
  const expectedTable = [];
  for (let r = checkFrom; r <= maxRound; r++) {
    const expActive = r % 3 === 0;
    const expReserve = r % 13 === 0;
    if (!expActive && !expReserve) continue;
    expectedTable.push({
      round: r,
      expected: [expActive && 'active', expReserve && 'reserve'].filter(Boolean).join('+'),
      l1_fired: firedOn.has(r) ? 'YES' : 'no',
    });
  }
  if (expectedTable.length === 0) {
    console.log('No rounds in checked range — learner not yet past graduation threshold.\n');
  } else {
    console.table(expectedTable);
    const expected = expectedTable.length;
    const actual = expectedTable.filter(r => r.l1_fired === 'YES').length;
    console.log(`\n  Expected L1 fires: ${expected}`);
    console.log(`  Actual L1 fires:   ${actual}`);
    console.log(`  Coverage:          ${expected ? Math.round((actual / expected) * 100) : 0}%\n`);
  }

  // 5. For each L1 cluster, count listening audio plays within 5min after
  //    the cluster_start event. Lists distinct seedIds touched.
  if (l1s.length > 0) {
    console.log('=== L1 clusters in detail (audio plays within 5min of each cluster_start) ===\n');
    const rows = [];
    for (const cluster of l1s) {
      const startMs = new Date(cluster.occurred_at).getTime();
      const endMs = startMs + 5 * 60 * 1000;
      const inside = plays.filter(p => {
        const t = new Date(p.occurred_at).getTime();
        const ct = p.payload?.cycleType;
        return t >= startMs && t < endMs
          && (ct === 'listen_intro' || ct === 'listening' || ct === 'listen_outro');
      });
      const seeds = new Set(inside.map(p => p.payload?.seedId).filter(Boolean));
      rows.push({
        at: cluster.occurred_at.slice(0, 19),
        round: cluster.payload?.round,
        listening_audios: inside.length,
        distinct_seeds: seeds.size,
        seeds: [...seeds].sort().slice(0, 12).join(','),
      });
    }
    console.table(rows);
  } else {
    console.log('=== No l1_cluster_start events recorded yet ===');
    console.log('Either (a) L1 genuinely isn\'t firing, or (b) the telemetry was');
    console.log('added after the learner\'s last session. Have them play a few');
    console.log('more rounds past R90 then re-run.\n');
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
