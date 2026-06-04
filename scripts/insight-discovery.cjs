#!/usr/bin/env node
/**
 * SSi Insight Engine — Discovery deep-run (the "before you asked" feed).
 *
 * Builds an AGGREGATE digest (real telemetry, school-demo students excluded —
 * raw events never leave this process), hands it to `claude -p` on the Pro Max
 * SUBSCRIPTION (never the billed API — ANTHROPIC_API_KEY is scrubbed from the
 * child env), and asks for a ranked set of findings in the InsightSpec shape.
 * Zero npm deps (hand-rolled env + raw fetch) so it runs with plain `node` on
 * the SSi Machine cron. Read-only against the DB unless --write.
 *
 * Usage:
 *   node scripts/insight-discovery.cjs [windowDays=30]   # real run -> stdout + ~/Desktop
 *   node scripts/insight-discovery.cjs --write           # real run, persisted to insight_discoveries (cron)
 *   node scripts/insight-discovery.cjs --demo            # synthetic populated digest (source='demo'), no DB read
 *   node scripts/insight-discovery.cjs --demo --write    # demo run persisted, for GOV/SALES presentations
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

function loadEnv(p) {
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
loadEnv(path.join(__dirname, '..', '.env'))
loadEnv(path.join(__dirname, '..', '.env.local'))

const BASE = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const argv = process.argv.slice(2)
const DEMO = argv.includes('--demo')
const WRITE = argv.includes('--write')
const WINDOW_DAYS = Number(argv.find(a => /^\d+$/.test(a)) || 30)
const sinceISO = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString()
const since7 = new Date(Date.now() - 7 * 86400_000).toISOString()

async function count(filter) {
  const r = await fetch(`${BASE}/rest/v1/player_events?${filter}`, {
    method: 'HEAD', headers: { ...H, Prefer: 'count=exact' },
  })
  return Number((r.headers.get('content-range') || '*/0').split('/')[1] || 0)
}
async function pageAll(table, qs, cap = 40000) {
  const out = []
  for (let from = 0; from < cap; from += 1000) {
    const r = await fetch(`${BASE}/rest/v1/${table}?${qs}`, { headers: { ...H, Range: `${from}-${from + 999}` } })
    if (!r.ok) break
    const rows = await r.json()
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}
function topBy(rows, keyFn, n = 10) {
  const m = new Map()
  for (const r of rows) { const k = keyFn(r); if (k) m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }))
}

// ---------- REAL digest (school-demo students excluded) ----------
async function buildRealDigest() {
  // exclusion set is learners.ID — player_events.user_id AND course_enrollments.learner_id
  // both key on learners.id, NOT learners.user_id. (1180 'student' accounts = school demos.)
  const demoRows = await pageAll('learners', `select=id&educational_role=eq.student`, 20000)
  const DEMOIDS = new Set(demoRows.map(d => d.id))

  const [totalEvents, plays, fails] = await Promise.all([
    count(`occurred_at=gte.${sinceISO}`),
    count(`occurred_at=gte.${sinceISO}&event_type=eq.audio_play`),
    count(`occurred_at=gte.${sinceISO}&event_type=eq.audio_failed`),
  ])
  const failRows = (await pageAll('player_events',
    `select=user_id,client_version,device_type,course_code&event_type=eq.audio_failed&occurred_at=gte.${sinceISO}`, 5000))
    .filter(r => !DEMOIDS.has(r.user_id))
  const skipRows = (await pageAll('player_events',
    `select=user_id,event_type,course_code,payload&event_type=in.(tap_skip,phase_skip)&occurred_at=gte.${since7}`, 8000))
    .filter(r => !DEMOIDS.has(r.user_id))
  const enr = await pageAll('course_enrollments',
    `select=learner_id,course_id,current_mode,last_practiced_at,highest_completed_round_index`, 40000)

  const now = Date.now(), courseAgg = {}
  for (const e of enr) {
    const c = e.course_id; if (!c || DEMOIDS.has(e.learner_id)) continue
    courseAgg[c] = courseAgg[c] || { course: c, enrolled: 0, active7: 0, active30: 0, infplay: 0 }
    courseAgg[c].enrolled++
    if (e.current_mode === 'infplay') courseAgg[c].infplay++
    const lp = e.last_practiced_at ? new Date(e.last_practiced_at).getTime() : 0
    if (now - lp < 7 * 86400_000) courseAgg[c].active7++
    if (now - lp < 30 * 86400_000) courseAgg[c].active30++
  }
  const topCourses = Object.values(courseAgg).sort((a, b) => b.active30 - a.active30).slice(0, 15)

  return {
    window_days: WINDOW_DAYS, generated_at: new Date().toISOString(), source: 'real',
    excluded_school_demo_learners: DEMOIDS.size,
    note: 'All figures EXCLUDE school-demo students (educational_role=student) — real self-serve learners only.',
    volume: { total_events: totalEvents, audio_play: plays, audio_failed: fails,
              audio_fail_rate: plays ? +(fails / plays).toFixed(4) : 0 },
    audio_failed_by_build: topBy(failRows, r => r.client_version, 8),
    audio_failed_by_device: topBy(failRows, r => r.device_type, 6),
    audio_failed_by_course: topBy(failRows, r => r.course_code, 8),
    friction_top_legos_7d: topBy(skipRows, r => (r.payload && (r.payload.legoId || r.payload.lego_id)), 12),
    friction_by_course_7d: topBy(skipRows, r => r.course_code, 8),
    course_activity: topCourses,
  }
}

// ---------- DEMO digest (deterministic synthetic; no DB) ----------
function buildDemoDigest() {
  let s = 0x5e1ec7ed
  const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const courses = ['spa_for_eng','fra_for_eng','deu_for_eng','ita_for_eng','cym_s_for_eng','nld_for_eng','por_for_eng','zho_for_eng','jpn_for_eng','kor_for_eng','gle_for_eng','eus_for_eng']
  const course_activity = courses.map((c, i) => {
    const enrolled = Math.max(8, Math.round(420 / (i + 1)) + ri(-10, 20))
    const active30 = Math.round(enrolled * (0.28 + rnd() * 0.3))
    return { course: c, enrolled, active30, active7: Math.round(active30 * (0.4 + rnd() * 0.4)), infplay: ri(0, 4) }
  }).sort((a, b) => b.active30 - a.active30)
  const builds = ['a1b2c3d','e4f5a6b','c7d8e9f','b0a1c2d']
  const plays = ri(70000, 95000), fails = Math.round(plays * (0.022 + rnd() * 0.01))
  return {
    window_days: WINDOW_DAYS, generated_at: new Date().toISOString(), source: 'demo',
    excluded_school_demo_learners: ri(900, 1300),
    note: 'SYNTHETIC populated digest for presentations — not real data.',
    volume: { total_events: Math.round(plays * 1.2), audio_play: plays, audio_failed: fails, audio_fail_rate: +(fails / plays).toFixed(4) },
    audio_failed_by_build: builds.map((b, i) => ({ key: b, count: i === 1 ? ri(180, 240) : ri(20, 70) })).sort((a, b) => b.count - a.count),
    audio_failed_by_device: [{ key: 'mobile', count: Math.round(fails * 0.6) }, { key: 'desktop', count: Math.round(fails * 0.4) }],
    audio_failed_by_course: courses.slice(0, 6).map(c => ({ key: c, count: ri(20, 190) })).sort((a, b) => b.count - a.count),
    friction_top_legos_7d: ['S0008L02','S0040L01','S0020L01','S0001L04','S0095L01','S0152L01','S0061L02','S0033L01'].map((k, i) => ({ key: k, count: ri(40, 80) - i * 3 })),
    friction_by_course_7d: courses.map(c => ({ key: c, count: ri(40, 1000) })).sort((a, b) => b.count - a.count).slice(0, 8),
    course_activity,
  }
}

const PROMPT = (digest) => `
You are the SSi Insight Engine's DISCOVERY analyst — the "before you asked" pass.
SSi is a language-learning app. Below is today's AGGREGATE telemetry digest (no raw
events, no named learners). Find the 4-6 things most worth a human's eye this week.

Rules:
- Reason over aggregates only. Never name or imply an individual learner. Sovereign.
- Apply the friction law: friction concentrated on a UNIT (a lego, everyone stalls in
  the same place) = a CONTENT quality problem -> owner "popty". Friction that would move
  with a person = adaptation (engine's job, not a ticket).
- audio_failed concentrated on a build/device = a HEALTH/ops issue -> owner "product".
- Read curvature, not just level: call out what MOVED or is anomalous, not just what's big.
- ${digest.source === 'demo' ? 'This is a SYNTHETIC demo digest for a presentation; write as if real but plausible.' : 'School-demo accounts are ALREADY EXCLUDED — real self-serve learners only (a small base). Be honest about thinness: pre-revenue, mostly testers.'}
- Each finding terminates in 1-2 graded actions (tier: try|investigate|together; owner:
  popty|growth|product|marketing|you|you+claude).

Return ONLY a JSON array (no prose, no markdown fence). Each element:
{ "widget": one of stat|time-series|ranked-bar|cohort-grid|funnel|treemap|narrative-card,
  "frame": "world" | "content",
  "title": "the question/headline",
  "story": "one-line read — number -> meaning",
  "tone": "neutral"|"good"|"warn"|"alarm",
  "metric": "courseValue|contentFriction|retention|health|trialConversion",
  "annotate": "what specifically IS the story (the spike/leak/hot unit)",
  "actions": [ {"tier":"try|investigate|together","owner":"...","text":"..."} ] }

DIGEST:
${JSON.stringify(digest, null, 1)}
`.trim()

;(async () => {
  if (!DEMO && (!BASE || !KEY)) { console.error('Missing SUPABASE env'); process.exit(1) }
  const digest = DEMO ? buildDemoDigest() : await buildRealDigest()

  const childEnv = { ...process.env }
  delete childEnv.ANTHROPIC_API_KEY      // never bill — use the Max subscription
  delete childEnv.ANTHROPIC_AUTH_TOKEN
  delete childEnv.CLAUDECODE             // required for nested claude --print calls

  let raw
  try {
    raw = execFileSync('claude', ['-p', PROMPT(digest), '--output-format', 'text'],
      { env: childEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 240_000 })
  } catch (e) { console.error('claude -p failed:', e.message); process.exit(1) }

  const jsonText = raw.replace(/```json|```/g, '').trim()
  let findings
  try { findings = JSON.parse(jsonText.slice(jsonText.indexOf('['), jsonText.lastIndexOf(']') + 1)) }
  catch (e) { console.error('Could not parse findings JSON. Raw:\n', raw); process.exit(1) }

  const result = { generated_at: digest.generated_at, window_days: WINDOW_DAYS, source: digest.source, digest, findings }

  // persist to Desktop (always) + insight_discoveries (--write)
  const stamp = digest.generated_at.replace(/[:.]/g, '-')
  const outPath = path.join(os.homedir(), 'Desktop', `ssi-insight-discovery-${digest.source}-${stamp}.json`)
  try { fs.writeFileSync(outPath, JSON.stringify(result, null, 2)) } catch {}

  if (WRITE) {
    const r = await fetch(`${BASE}/rest/v1/insight_discoveries`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ generated_at: digest.generated_at, window_days: WINDOW_DAYS, source: digest.source, digest, findings }),
    })
    console.log(r.ok ? `\nwrote to insight_discoveries (source=${digest.source})` : `\nWRITE FAILED ${r.status}: ${await r.text()}`)
  }

  console.log(`\n=== ${digest.source.toUpperCase()} digest — ${WINDOW_DAYS}d ===`)
  if (digest.volume) console.log(`events: ${digest.volume.total_events}  plays: ${digest.volume.audio_play}  failed: ${digest.volume.audio_failed}  rate: ${(digest.volume.audio_fail_rate*100).toFixed(2)}%`)
  console.log(`top active: ${digest.course_activity.slice(0,5).map(c=>`${c.course}(${c.active30})`).join(', ')}`)
  console.log(`\n=== ${findings.length} DISCOVERIES ===`)
  for (const f of findings) {
    console.log(`\n• [${(f.tone||'').toUpperCase()}] ${f.title}\n  ${f.story}`)
    if (f.annotate) console.log(`  ${f.annotate}`)
    for (const a of (f.actions||[])) console.log(`  → [${a.tier}/${a.owner}] ${a.text}`)
  }
  console.log(`\nsaved: ${outPath}`)
})().catch(e => { console.error(e); process.exit(1) })
