#!/usr/bin/env node
/**
 * Read-only telemetry INVENTORY: what are we actually capturing right now?
 * Event-type mix, courses, devices, build-sha landing, attributable learners.
 * Grounds the admin-insights think in reality.
 *
 * Run:  node scripts/check-tele-inventory.cjs
 * Needs VITE_SUPABASE_URL + a service key in env / .env.
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
);
const d30 = new Date(Date.now() - 30 * 86400000).toISOString();
const tally = (rows, f) => { const m = {}; for (const r of rows) { const k = f(r) ?? '(null)'; m[k] = (m[k] || 0) + 1; } return m; };
const top = (m, n = 12) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);

(async () => {
  const cAll = await supabase.from('player_events').select('*', { count: 'exact', head: true });
  const c30 = await supabase.from('player_events').select('*', { count: 'exact', head: true }).gte('occurred_at', d30);
  console.log(`\nplayer_events: ${cAll.count} all-time, ${c30.count} in last 30d\n`);

  // Sample the most recent events (PostgREST caps ~1000) to read the shape.
  const { data: ev } = await supabase.from('player_events')
    .select('occurred_at, event_type, course_code, device_type, client_version, payload, user_id')
    .order('occurred_at', { ascending: false }).limit(1000);
  const rows = ev || [];
  console.log(`--- shape of the most recent ${rows.length} events ---`);
  console.log(`span: ${rows[rows.length - 1]?.occurred_at?.slice(0,19)} → ${rows[0]?.occurred_at?.slice(0,19)}\n`);

  console.log('event_type:'); for (const [k, v] of top(tally(rows, r => r.event_type))) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('\ncourse_code (top):'); for (const [k, v] of top(tally(rows, r => r.course_code), 10)) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('\ndevice_type:'); for (const [k, v] of top(tally(rows, r => r.device_type))) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log('\nclient_version (build sha landing?):'); for (const [k, v] of top(tally(rows, r => r.client_version))) console.log(`  ${String(v).padStart(4)}  ${k}`);

  const learners = new Set(rows.map(r => r.payload?.learnerId).filter(Boolean));
  const loggedIn = rows.filter(r => r.user_id).length;
  console.log(`\nattribution: ${learners.size} distinct payload.learnerId in sample; ${loggedIn}/${rows.length} events have a user_id (logged-in)`);

  // What payload keys exist (the richness of the signal)?
  const keys = {}; for (const r of rows) for (const k of Object.keys(r.payload || {})) keys[k] = (keys[k] || 0) + 1;
  console.log('\npayload keys seen:'); for (const [k, v] of top(keys, 20)) console.log(`  ${String(v).padStart(4)}  ${k}`);
})().catch(e => { console.error(e); process.exit(1); });
