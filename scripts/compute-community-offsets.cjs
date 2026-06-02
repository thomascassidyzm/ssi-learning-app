#!/usr/bin/env node
/**
 * Compute the community all-time OFFSET per language = 2 × (last 30 days of
 * daily_contributions). The polluted historical all-time (mostly schools
 * test entities) is discarded; the offset is a sensible "we've been going a
 * while" starting point grounded in recent tester activity. Frozen as of the
 * snapshot date; all-time then grows from post-snapshot rows. Testing-phase
 * approximation — see docs/sessions-and-days-active.md / stats modal work.
 *
 * Read-only. Run:  node scripts/compute-community-offsets.cjs
 * Needs VITE_SUPABASE_URL + a service key in env / .env.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);

const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

(async () => {
  const { data, error } = await supabase
    .from('daily_contributions')
    .select('target_language, contribution_date, minutes_practiced, phrases_count')
    .gte('contribution_date', d30);
  if (error) { console.error(error.message); process.exit(1); }

  const byLang = {};
  for (const r of data || []) {
    const k = r.target_language;
    if (!byLang[k]) byLang[k] = { m: 0, p: 0 };
    byLang[k].m += Number(r.minutes_practiced) || 0;
    byLang[k].p += Number(r.phrases_count) || 0;
  }

  // 2× the last-30-days as the offset.
  const offsets = {};
  for (const [k, v] of Object.entries(byLang)) offsets[k] = { minutes: v.m * 2, phrases: v.p * 2 };

  console.log(`\n// Community all-time offsets = 2 × last-30-days as of snapshot (${d30}+30d window).`);
  console.log(`// ${Object.keys(offsets).length} languages with activity in the window.\n`);
  // Print sorted, pasteable as a TS object literal.
  const lines = Object.keys(offsets).sort().map(
    k => `  ${k}: { minutes: ${offsets[k].minutes}, phrases: ${offsets[k].phrases} },`
  );
  console.log('{\n' + lines.join('\n') + '\n}');
})().catch(e => { console.error(e); process.exit(1); });
