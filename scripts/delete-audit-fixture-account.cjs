#!/usr/bin/env node
/**
 * One-off cleanup: delete the leftover fixture/test account
 * "audit-return-1@ssi-internal.test" left over from a prior audit session.
 *
 * Usage:
 *   node scripts/delete-audit-fixture-account.cjs            # dry run (default)
 *   node scripts/delete-audit-fixture-account.cjs --apply     # actually delete
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dotenv dependency in this workspace) — mirrors
// scripts/check-course-visibility.cjs's env var names, just without the lib.
// Reads from the main worktree's repo root, since gitignored .env files
// aren't copied into a fresh `git worktree add` checkout.
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

const TARGET_EMAIL = 'audit-return-1@ssi-internal.test';
const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log(`\n🔎 Looking up "${TARGET_EMAIL}" in learner_emails…\n`);

  const { data: emailRows, error: emailErr } = await supabase
    .from('learner_emails')
    .select('learner_id, email, is_primary')
    .ilike('email', TARGET_EMAIL);

  if (emailErr) {
    console.error('❌ Error querying learner_emails:', emailErr.message);
    process.exit(1);
  }

  if (!emailRows || emailRows.length === 0) {
    console.log('✅ No learner_emails row found for that address — already gone, nothing to do.');
    return;
  }

  const learnerIds = Array.from(new Set(emailRows.map(r => r.learner_id)));
  console.log('Matching learner_id(s):', learnerIds);

  const { data: learners, error: learnerErr } = await supabase
    .from('learners')
    .select('id, user_id, display_name, created_at, platform_role, educational_role')
    .in('id', learnerIds);

  if (learnerErr) {
    console.error('❌ Error querying learners:', learnerErr.message);
    process.exit(1);
  }

  console.log('\nLearner row(s):');
  console.table(learners);

  if (!APPLY) {
    console.log('\n(dry run — pass --apply to actually delete this learner and its rows)');
    return;
  }

  console.log('\n🗑  Deleting…');
  const { error: delErr } = await supabase.from('learners').delete().in('id', learnerIds);
  if (delErr) {
    console.error('❌ Delete failed:', delErr.message);
    process.exit(1);
  }

  console.log(`✅ Deleted ${learnerIds.length} learner row(s) for "${TARGET_EMAIL}".`);
}

main();
