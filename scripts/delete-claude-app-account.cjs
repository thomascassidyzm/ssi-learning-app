#!/usr/bin/env node
/**
 * One-off cleanup: delete the stray app account "claude@saysomethingin.com"
 * (learner id b050351b-cb2e-403d-98ea-0ecbf9627f5e) — founder-confirmed kill.
 *
 * It is believed inert (no role / tags / classes / sessions). This script
 * VERIFIES that is still true before deleting, then removes:
 *   1. the learners row (FK-sound cascade takes its owned rows), and
 *   2. the auth user via supabase.auth.admin.deleteUser (service role).
 * Finally it re-checks that both are gone.
 *
 * Usage:
 *   node scripts/delete-claude-app-account.cjs            # dry run + inertness report
 *   node scripts/delete-claude-app-account.cjs --apply     # actually delete
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dotenv in this workspace) — mirrors
// scripts/delete-audit-fixture-account.cjs.
const REPO_ROOTS = [
  path.resolve(__dirname, '..'),
  '/Users/tomcassidy/SSi/ssi-learning-app',
];
for (const root of REPO_ROOTS) {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }
}

const TARGET_LEARNER_ID = 'b050351b-cb2e-403d-98ea-0ecbf9627f5e';
const TARGET_EMAIL = 'claude@saysomethingin.com';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function count(table, column, value) {
  const { count: c, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, value);
  if (error) return { table, error: error.message };
  return { table, count: c ?? 0 };
}

async function main() {
  console.log(`\n🔎 Inspecting learner ${TARGET_LEARNER_ID} ("${TARGET_EMAIL}")…\n`);

  const { data: learner, error: learnerErr } = await supabase
    .from('learners')
    .select('id, user_id, display_name, created_at, platform_role, educational_role')
    .eq('id', TARGET_LEARNER_ID)
    .maybeSingle();

  if (learnerErr) {
    console.error('❌ Error querying learners:', learnerErr.message);
    process.exit(1);
  }
  if (!learner) {
    console.log('✅ No learner row with that id — already gone, nothing to do.');
    return;
  }

  console.log('Learner row:');
  console.table([learner]);
  const authUid = learner.user_id;

  // HARD BLOCKERS — anything that makes this account *depended-upon* by others:
  // a platform/educational role, an org attachment (teacher/school/govt/class/
  // tags), or paid access (entitlements/subscriptions). If any is present this
  // is NOT a stray and we refuse. *_user_id / user_id (teacher/school/tags/govt)
  // hold the auth uid; learner_id columns hold learners.id (CLAUDE.md canon).
  const blockers = await Promise.all([
    count('user_tags', 'user_id', authUid),
    count('teachers', 'learner_id', TARGET_LEARNER_ID),
    count('schools', 'admin_user_id', authUid),
    count('govt_admins', 'user_id', authUid),
    count('classes', 'teacher_user_id', authUid),
    count('class_sessions', 'teacher_user_id', authUid),
    count('user_entitlements', 'learner_id', TARGET_LEARNER_ID),
    count('subscriptions', 'learner_id', TARGET_LEARNER_ID),
  ]);

  console.log('\nHard-blocker probes (must all be 0):');
  console.table(blockers);

  const roleFlags = {
    platform_role: learner.platform_role,
    educational_role: learner.educational_role,
  };
  console.log('Role flags:', roleFlags);

  const nonEmpty = blockers.filter((p) => p.count > 0);
  const hasRole =
    (learner.platform_role && learner.platform_role !== 'user') ||
    !!learner.educational_role;
  const probeErrors = blockers.filter((p) => p.error);

  if (probeErrors.length) {
    console.error('\n❌ Some probes errored — cannot confirm strayness:', probeErrors);
    process.exit(1);
  }

  if (nonEmpty.length || hasRole) {
    console.error('\n⛔ NOT a stray — refusing to delete.');
    if (nonEmpty.length) console.error('   Depended-upon rows:', nonEmpty);
    if (hasRole) console.error('   Carries a role:', roleFlags);
    process.exit(1);
  }

  // Self-owned learner-data spine (its own sessions/plays) — trivial, cascades
  // with the account. Reported, then explicitly removed so no orphan survives
  // regardless of the FK's ON DELETE setting (loud, not silent).
  const SPINE = [
    ['player_events', 'learner_id'],
    ['player_events', 'user_id'],
    ['sessions', 'learner_id'],
    ['course_enrollments', 'learner_id'],
    ['daily_contributions', 'learner_id'],
    ['response_metrics', 'learner_id'],
    ['spike_events', 'learner_id'],
    ['learner_points', 'learner_id'],
    ['lego_progress', 'learner_id'],
    ['seed_progress', 'learner_id'],
  ];
  const spineCounts = await Promise.all(SPINE.map(([t, c]) => count(t, c, TARGET_LEARNER_ID)));
  console.log('\nSelf-owned spine (will cascade):');
  console.table(spineCounts.filter((p) => p.error || p.count > 0));

  console.log('\n✅ Stray confirmed: no role, no org attachment, no entitlement/subscription. Only its own trivial play data remains.');

  if (!APPLY) {
    console.log('\n(dry run — pass --apply to cascade-delete the spine + learner row + auth user)');
    return;
  }

  console.log('\n🗑  Cascading self-owned spine rows…');
  for (const [t, c] of SPINE) {
    const { error } = await supabase.from(t).delete().eq(c, TARGET_LEARNER_ID);
    // A missing table / column is fine (schema drift) — only real delete errors matter.
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      console.error(`❌ delete from ${t} (${c}) failed:`, error.message);
      process.exit(1);
    }
  }
  console.log('   spine cleared.');

  console.log('🗑  Deleting learner row…');
  const { error: delErr } = await supabase.from('learners').delete().eq('id', TARGET_LEARNER_ID);
  if (delErr) {
    console.error('❌ Learner delete failed:', delErr.message);
    process.exit(1);
  }
  console.log('   learner row deleted.');

  console.log('🗑  Deleting auth user…');
  const { error: authErr } = await supabase.auth.admin.deleteUser(authUid);
  if (authErr) {
    console.error('❌ auth.admin.deleteUser failed:', authErr.message);
    process.exit(1);
  }
  console.log('   auth user deleted.');

  // Confirm gone.
  const { data: gone } = await supabase
    .from('learners')
    .select('id')
    .eq('id', TARGET_LEARNER_ID)
    .maybeSingle();
  const { data: authAfter } = await supabase.auth.admin.getUserById(authUid);
  console.log('\nConfirm — learner row:', gone ? '⛔ STILL PRESENT' : '✅ gone');
  console.log('Confirm — auth user:', authAfter?.user ? '⛔ STILL PRESENT' : '✅ gone');
}

main();
