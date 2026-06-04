#!/usr/bin/env node
/**
 * Insight Engine — Discovery deep-run.
 *
 * Builds an aggregate digest from real telemetry (school-demo students excluded),
 * asks Claude (via the `claude -p` subscription CLI — NEVER the billed API) to read
 * the digest like a director and emit a `findings` array, then persists the result.
 *
 * A finding = { widget, frame, title, story, tone, metric, annotate, actions:[{tier,owner,text}] }.
 * The result = { generated_at, window_days, source, digest, findings }.
 *
 * Usage:
 *   node scripts/insight-discovery.cjs                 # query DB → stdout + Desktop json (source='real')
 *   node scripts/insight-discovery.cjs --demo          # synthetic populated digest (source='demo'), no DB
 *   node scripts/insight-discovery.cjs --write         # also UPSERT result to insight_discoveries (service key)
 *   node scripts/insight-discovery.cjs --demo --write  # demo run persisted for GOV/SALES presentations
 *
 * Env (from ../../ssi-dashboard-v7-clean/.env then local .env):
 *   VITE_SUPABASE_URL / SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY.
 * ANTHROPIC_API_KEY is SCRUBBED from the claude child env (subscription only; the API costs real money).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '../../ssi-dashboard-v7-clean/.env') });
require('dotenv').config();

// ── flags ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const DEMO = argv.includes('--demo');
const WRITE = argv.includes('--write');
const WINDOW_DAYS = 30;

const BASE = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const log = (...a) => console.log(...a);
const NOTE =
  'All figures EXCLUDE school-demo students (educational_role=student); these are real self-serve learners only.';

// =============================================================================
// DEMO digest — deterministic synthetic aggregates (no Math.random; tiny LCG).
// Realistic populated shape so a --demo --write run gives a full feed for
// GOV/SALES presentations without touching the DB.
// =============================================================================
function makeLcg(seed) {
  let s = seed >>> 0;
  return () => {
    // Numerical Recipes LCG → [0,1)
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function buildDemoDigest() {
  const rnd = makeLcg(20260604);
  const pick = (lo, hi) => Math.floor(lo + rnd() * (hi - lo + 1));

  const langs = [
    'spa', 'fra', 'deu', 'ita', 'por', 'nld', 'cym', 'gle', 'zho', 'jpn', 'hrv', 'lit',
  ];
  const courses = langs.map((l) => `${l}_for_eng`);

  // friction hotspots — a clear outlier (cym) then a long tail
  const fricByCourse = courses
    .map((c, i) => ({ key: c, count: i === 6 ? 880 : pick(40, 320) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const fricLegos = [
    'S0008L02', 'S0040L01', 'S0020L01', 'S0001L04', 'S0095L01', 'S0001L03',
    'S0086L01', 'S0092L03', 'S0001L02', 'S0081L01', 'S0094L02', 'S0001L01',
  ].map((k) => ({ key: k, count: pick(38, 75) })).sort((a, b) => b.count - a.count);

  const failByCourse = courses
    .map((c) => ({ key: c, count: pick(40, 190) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const failByDevice = [
    { key: 'mobile', count: pick(560, 680) },
    { key: 'desktop', count: pick(360, 440) },
  ];

  const builds = ['4cc68eb', '5c02b6f', 'fdfd945', '427e4c5', '1d4457e', '0061549', '4f5cf58', '0906194'];
  const failByBuild = builds
    .map((b) => ({ key: b, count: pick(10, 55) }))
    .sort((a, b) => b.count - a.count);

  const totalFail = failByDevice.reduce((s, d) => s + d.count, 0);
  const totalPlay = pick(78000, 86000);

  const courseActivity = courses
    .map((c) => {
      const enrolled = pick(6, 24);
      const active30 = Math.max(3, Math.floor(enrolled * (0.4 + rnd() * 0.4)));
      const active7 = Math.max(1, Math.floor(active30 * (0.4 + rnd() * 0.5)));
      return { course: c, enrolled, active7, active30, infplay: rnd() < 0.18 ? 1 : 0 };
    })
    .sort((a, b) => b.active30 - a.active30)
    .slice(0, 15);

  return {
    window_days: WINDOW_DAYS,
    generated_at: new Date().toISOString(),
    excluded_school_demo_learners: pick(900, 1300),
    note: NOTE,
    volume: {
      total_events: totalPlay + pick(14000, 18000),
      audio_play: totalPlay,
      audio_failed: totalFail,
      audio_fail_rate: Number((totalFail / totalPlay).toFixed(4)),
    },
    audio_failed_by_build: failByBuild,
    audio_failed_by_device: failByDevice,
    audio_failed_by_course: failByCourse,
    friction_top_legos_7d: fricLegos,
    friction_by_course_7d: fricByCourse,
    course_activity: courseActivity,
  };
}

// =============================================================================
// REAL digest — aggregate from telemetry, excluding educational_role='student'.
// =============================================================================
async function buildRealDigest() {
  if (!BASE || !SERVICE_KEY) {
    console.error('Missing SUPABASE url/service key in env (need it for the real digest).');
    process.exit(1);
  }
  const db = createClient(BASE, SERVICE_KEY, { auth: { persistSession: false } });
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();

  // ── the set of learner ids to EXCLUDE: school-demo students ────────────────
  const demoUserIds = new Set();
  {
    const { data, error } = await db
      .from('learners')
      .select('user_id')
      .eq('educational_role', 'student');
    if (error) console.error('[digest] learners(student) error', error.message);
    for (const r of data || []) if (r.user_id) demoUserIds.add(r.user_id);
  }
  const notDemo = (uid) => !uid || !demoUserIds.has(uid);

  // ── player_events over the window (paged) ──────────────────────────────────
  const events = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('player_events')
        .select('event_type, user_id, course_code, client_version, device_type, payload, occurred_at')
        .gte('occurred_at', sinceIso)
        .in('event_type', ['audio_play', 'audio_failed', 'skip_back'])
        .range(from, from + PAGE - 1);
      if (error) { console.error('[digest] player_events error', error.message); break; }
      events.push(...(data || []).filter((e) => notDemo(e.user_id)));
      if (!data || data.length < PAGE) break;
    }
  }

  const tally = (rows, keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (k == null) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  };

  const plays = events.filter((e) => e.event_type === 'audio_play');
  const fails = events.filter((e) => e.event_type === 'audio_failed');
  const totalPlay = plays.length;
  const totalFail = fails.length;

  // ── friction = skip_back, last 7d ──────────────────────────────────────────
  const skipBack7 = events.filter(
    (e) => e.event_type === 'skip_back' && e.occurred_at >= since7,
  );
  const legoOf = (e) => (e.payload && (e.payload.legoId || e.payload.lego_id)) || null;

  // ── course activity (enrollments + active windows), excluding demo ─────────
  const courseActivity = await buildCourseActivity(db, demoUserIds);

  return {
    window_days: WINDOW_DAYS,
    generated_at: new Date().toISOString(),
    excluded_school_demo_learners: demoUserIds.size,
    note: NOTE,
    volume: {
      total_events: events.length,
      audio_play: totalPlay,
      audio_failed: totalFail,
      audio_fail_rate: totalPlay ? Number((totalFail / totalPlay).toFixed(4)) : 0,
    },
    audio_failed_by_build: tally(fails, (e) => e.client_version).slice(0, 8),
    audio_failed_by_device: tally(fails, (e) => e.device_type).slice(0, 6),
    audio_failed_by_course: tally(fails, (e) => e.course_code).slice(0, 8),
    friction_top_legos_7d: tally(skipBack7, legoOf).slice(0, 12),
    friction_by_course_7d: tally(skipBack7, (e) => e.course_code).slice(0, 8),
    course_activity: courseActivity,
  };
}

async function buildCourseActivity(db, demoUserIds) {
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // enrollments per course (learner_id, course_id)
  const enroll = new Map(); // course -> Set(learner)
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('course_enrollments')
        .select('course_id, learner_id')
        .range(from, from + PAGE - 1);
      if (error) { console.error('[digest] course_enrollments error', error.message); break; }
      for (const r of data || []) {
        if (demoUserIds.has(r.learner_id)) continue;
        if (!enroll.has(r.course_id)) enroll.set(r.course_id, new Set());
        enroll.get(r.course_id).add(r.learner_id);
      }
      if (!data || data.length < PAGE) break;
    }
  }

  // active learners per course via learner_speaking_opportunities.day
  const active7 = new Map();
  const active30 = new Map();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('learner_speaking_opportunities')
        .select('course_code, learner_id, day')
        .gte('day', since30)
        .range(from, from + PAGE - 1);
      if (error) { console.error('[digest] lso error', error.message); break; }
      for (const r of data || []) {
        if (demoUserIds.has(r.learner_id)) continue;
        if (!active30.has(r.course_code)) active30.set(r.course_code, new Set());
        active30.get(r.course_code).add(r.learner_id);
        if (r.day >= since7) {
          if (!active7.has(r.course_code)) active7.set(r.course_code, new Set());
          active7.get(r.course_code).add(r.learner_id);
        }
      }
      if (!data || data.length < PAGE) break;
    }
  }

  const rows = [];
  for (const [course, set] of enroll.entries()) {
    rows.push({
      course,
      enrolled: set.size,
      active7: (active7.get(course) || new Set()).size,
      active30: (active30.get(course) || new Set()).size,
      infplay: 0,
    });
  }
  rows.sort((a, b) => b.active30 - a.active30);
  return rows.slice(0, 15);
}

// =============================================================================
// Claude — read the digest, emit findings. Subscription CLI only.
// =============================================================================
function callClaude(digest) {
  const prompt = [
    'You are the director of the SSi Insight Engine. Read this AGGREGATE telemetry digest',
    '(real self-serve learners; school-demo students already excluded) and surface the few',
    'findings that actually matter — curvature/outliers, not noise. Be honest on a thin base.',
    '',
    'Return ONLY a JSON array `findings`. Each finding:',
    '{ "widget": one of stat|ranked-bar|treemap|cohort-grid|narrative-card|funnel|time-series|map|scatter|distribution|flow|table|sovereign-comparison,',
    '  "frame": one of self|group|world|content,',
    '  "title": the question, "story": the one-line read,',
    '  "tone": one of neutral|good|warn|alarm,',
    '  "metric": a metric id (e.g. contentFriction|health|retention|trialConversion|courseValue),',
    '  "annotate": a short honest read of WHY this is the signal,',
    '  "actions": [ { "tier": try|investigate|together, "owner": popty|growth|product|marketing|you|you+claude, "text": "..." } ] }',
    '',
    'DIGEST:',
    JSON.stringify(digest, null, 2),
    '',
    'Output: a single JSON array. No prose, no code fence.',
  ].join('\n');

  // Scrub ANTHROPIC_API_KEY so the CLI uses the Pro Max subscription, never the billed API.
  const childEnv = { ...process.env };
  delete childEnv.ANTHROPIC_API_KEY;

  const res = spawnSync('claude', ['-p', prompt], {
    env: childEnv,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.status !== 0) {
    console.error('[claude] non-zero exit', res.status, res.stderr || '');
    return [];
  }
  return parseFindings(res.stdout || '');
}

function parseFindings(raw) {
  // Pull the first top-level JSON array out of the model output.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    console.error('[claude] no JSON array found in output');
    return [];
  }
  try {
    const arr = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error('[claude] findings parse error', e.message);
    return [];
  }
}

// =============================================================================
// Persistence
// =============================================================================
function writeDesktop(result) {
  const stamp = result.generated_at.replace(/[:.]/g, '-');
  const out = path.join(os.homedir(), 'Desktop', `ssi-insight-discovery-${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  log(`\n📄 wrote ${out}`);
}

async function upsertToTable(result) {
  if (!BASE || !SERVICE_KEY) {
    console.error('[--write] missing SUPABASE url/service key; skipping table write.');
    return;
  }
  const body = {
    generated_at: result.generated_at,
    window_days: result.window_days,
    source: result.source,
    digest: result.digest,
    findings: result.findings,
  };
  const resp = await fetch(`${BASE}/rest/v1/insight_discoveries`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    console.error(`[--write] insert failed ${resp.status}: ${txt}`);
    return;
  }
  log(`\n✅ persisted to insight_discoveries (source=${result.source})`);
}

// =============================================================================
// Main
// =============================================================================
(async () => {
  const digest = DEMO ? buildDemoDigest() : await buildRealDigest();

  log(`\n=== Insight Discovery (${DEMO ? 'demo' : 'real'}) — ${WINDOW_DAYS}d window ===`);
  log(`excluded school-demo learners: ${digest.excluded_school_demo_learners}`);
  log(`events ${digest.volume.total_events} · plays ${digest.volume.audio_play} · fails ${digest.volume.audio_failed} (${(digest.volume.audio_fail_rate * 100).toFixed(2)}%)`);

  const findings = callClaude(digest);
  log(`\nfindings: ${findings.length}`);

  const result = {
    generated_at: digest.generated_at,
    window_days: WINDOW_DAYS,
    source: DEMO ? 'demo' : 'real',
    digest,
    findings,
  };

  // stdout (the proven default behaviour) + Desktop json
  log('\n' + JSON.stringify(result, null, 2));
  writeDesktop(result);

  if (WRITE) await upsertToTable(result);
})().catch((e) => {
  console.error('fatal', e);
  process.exit(1);
});
