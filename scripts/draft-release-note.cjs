#!/usr/bin/env node
/**
 * SSi Release-Note Drafter — git-derived, learner-facing "What's new" drafts.
 *
 * Reads the `main..staging` commit range (staging→main adds nothing new, so
 * `main..staging` IS the release), drops engineering noise, and hands the
 * surviving commit subjects to `claude --print` (the CLI on the Pro Max
 * SUBSCRIPTION — NEVER the billed API; ANTHROPIC_API_KEY is scrubbed from the
 * child env, and CLAUDECODE is unset so the nested call runs). Claude returns a
 * super-concise learner-facing note ({headline, bullets[]}). We assemble a
 * DRAFT row (is_published:false) for the existing `release_notes` table — the
 * exact same column shapes /admin/release-notes writes — and Tom reviews +
 * publishes there.
 *
 * SAFETY: DRY-RUN BY DEFAULT. It prints the note + the row it WOULD insert and
 * writes NOTHING to the DB. A real insert happens ONLY with --commit.
 *
 * Usage:
 *   node scripts/draft-release-note.cjs                 # dry-run on origin/main..origin/staging (default)
 *   node scripts/draft-release-note.cjs --commit        # actually insert the DRAFT row
 *   node scripts/draft-release-note.cjs --version 278499e7   # override version (else origin/staging short SHA)
 *   node scripts/draft-release-note.cjs --range origin/main..origin/staging   # override the range
 *   node scripts/draft-release-note.cjs --model sonnet  # model for claude --print (default: sonnet)
 *   node scripts/draft-release-note.cjs --show-prompt   # print the assembled prompt and exit (no claude, no DB)
 *
 * VERSION SHA NUANCE (for the future weekly cut-the-train flow):
 *   The app's build version (= client_version on player_events) is the 7-char
 *   git SHA of the DEPLOYED commit (VERCEL_GIT_COMMIT_SHA, see vite.config.js).
 *   For a real weekly release, version should be the POST-MERGE main SHA (the
 *   commit that actually deploys to prod). Run this AFTER promoting staging→main
 *   with `--version $(git rev-parse --short origin/main)`. Standalone (this
 *   default), version = the staging tip — the content that's about to deploy.
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

// ---------- env (worktree convention first, then the main checkout) ----------
function loadEnv(p) {
  if (!p || !fs.existsSync(p)) return false
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
  return true
}
// Same shape as insight-discovery.cjs: env lives at the repo root (this script
// is in scripts/, so ../ is the root). Run from a normal checkout with .env.local.
loadEnv(path.join(__dirname, '..', '.env'))
loadEnv(path.join(__dirname, '..', '.env.local'))

const BASE = process.env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// ---------- args ----------
const argv = process.argv.slice(2)
function flagVal(name) {
  const i = argv.indexOf(name)
  return i !== -1 && i + 1 < argv.length ? argv[i + 1] : null
}
const COMMIT = argv.includes('--commit')          // the ONLY thing that writes to the DB
const SHOW_PROMPT = argv.includes('--show-prompt') // assemble + print prompt, then exit
const RANGE = flagVal('--range') || 'origin/main..origin/staging'
const MODEL = flagVal('--model') || 'sonnet'
const VERSION_OVERRIDE = flagVal('--version')

const ADMIN_URL = 'https://staging.saysomethingin.app/admin/release-notes'

// ---------- 1. git range -> filtered, learner-relevant commit subjects ----------
function sh(args) {
  return execFileSync('git', args, { cwd: __dirname, encoding: 'utf8' }).trim()
}

// Conventional-commit types that are internal/non-learner-facing — dropped.
// (Keep feat/fix/polish and bare subjects — those are real learner changes.)
const NOISE_TYPES = /^(chore|test|ci|build|refactor|style|perf|docs|deps|wip|revert)\b/i
// Promotion / merge bookkeeping lines.
const NOISE_LINES = /^(promote|merge\b|merge branch|merge pull request|merge remote)/i

function collectSubjects(range) {
  let raw
  try {
    raw = sh(['log', range, '--no-merges', '--pretty=%s'])
  } catch (e) {
    console.error(`git log ${range} failed: ${e.message}`)
    process.exit(1)
  }
  const all = raw ? raw.split('\n').map(s => s.trim()).filter(Boolean) : []
  const kept = all.filter(s => !NOISE_TYPES.test(s) && !NOISE_LINES.test(s))
  // De-dupe identical subjects (re-applied cherry-picks across promotions).
  const seen = new Set()
  const deduped = kept.filter(s => (seen.has(s) ? false : (seen.add(s), true)))
  return { total: all.length, kept: deduped, dropped: all.length - deduped.length }
}

// ---------- 2. prompt for claude --print ----------
function buildPrompt(subjects) {
  return `
You are drafting a SUPER-CONCISE, LEARNER-FACING release note for SSi, a
language-learning app. Below is the raw list of git commit subjects shipped in
this release. Translate them into what the LEARNER actually gets — plain
language, no jargon, no commit-speak, no internal/technical detail.

Rules:
- Write for a language learner using the app, not a developer. No file names,
  no "refactor", no ticket-speak, no acronyms unless a learner would know them.
- GROUP related commits into one bullet (e.g. several tiling/pinyin commits ->
  one bullet about clearer pronunciation help).
- SKIP anything internal: tests, refactors, telemetry, build/ops, admin-only
  tooling, insight/analytics dashboards (those are for the team, not learners).
- Lead with the changes a learner would NOTICE and care about.
- A short, warm, plain headline (<= ~8 words). Then 3-6 bullets, each one short
  plain sentence describing a benefit. No markdown, no leading dashes.
- If there genuinely isn't much learner-facing, fewer bullets is fine. Be honest,
  never invent features.

Return ONLY strict JSON, no prose, no markdown fence:
{"headline": "...", "bullets": ["...", "...", "..."]}

COMMIT SUBJECTS:
${subjects.map(s => `- ${s}`).join('\n')}
`.trim()
}

// ---------- 3. run claude --print on the SUBSCRIPTION (never the API) ----------
function runClaude(prompt) {
  const childEnv = { ...process.env }
  delete childEnv.ANTHROPIC_API_KEY     // never bill — use the Max subscription
  delete childEnv.ANTHROPIC_AUTH_TOKEN
  delete childEnv.CLAUDECODE            // required for nested claude --print calls
  let raw
  try {
    raw = execFileSync('claude', ['--print', '--model', MODEL, prompt],
      { env: childEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 180_000 })
  } catch (e) {
    console.error(`claude --print failed: ${e.message}`)
    if (e.stdout) console.error('stdout:', e.stdout)
    if (e.stderr) console.error('stderr:', e.stderr)
    process.exit(1)
  }
  // Tolerate an accidental ```json fence; extract the first {...} object.
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) {
    console.error('Could not find JSON object in claude output. Raw:\n', raw)
    process.exit(1)
  }
  let parsed
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch (e) {
    console.error('Could not parse JSON from claude output. Raw:\n', raw)
    process.exit(1)
  }
  if (!parsed.headline || !Array.isArray(parsed.bullets)) {
    console.error('Parsed JSON missing headline/bullets. Got:', JSON.stringify(parsed))
    process.exit(1)
  }
  // Normalise bullets to clean plain strings (the table column is text[]).
  parsed.bullets = parsed.bullets.map(b => String(b).replace(/^[-•\s]+/, '').trim()).filter(Boolean)
  return parsed
}

// ---------- 4. assemble the DRAFT row (matches AdminReleaseNotes.vue shapes) ----------
function buildRow(note) {
  const version = VERSION_OVERRIDE || sh(['rev-parse', '--short', 'origin/staging'])
  return {
    version,                                  // text — short SHA (= client_version style)
    released_at: new Date().toISOString(),    // timestamptz ISO, like the admin UI
    headline: note.headline.trim() || null,   // text or null
    bullets: note.bullets,                     // text[] — plain strings, one headline each
    is_published: false,                       // DRAFT — Tom publishes via the admin UI
  }
}

// ---------- 5. insert (ONLY with --commit) ----------
async function insertRow(row) {
  if (!BASE || !KEY) {
    console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — cannot --commit.')
    process.exit(1)
  }
  const r = await fetch(`${BASE}/rest/v1/release_notes`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  })
  if (!r.ok) {
    console.error(`INSERT FAILED ${r.status}: ${await r.text()}`)
    process.exit(1)
  }
  const [created] = await r.json()
  return created
}

// ---------- main ----------
;(async () => {
  const { total, kept, dropped } = collectSubjects(RANGE)
  console.log(`\n=== release-note drafter ===`)
  console.log(`range:   ${RANGE}`)
  console.log(`commits: ${total} total -> ${kept.length} learner-relevant (${dropped} noise/dupe dropped)\n`)

  if (kept.length === 0) {
    console.error('No learner-facing commits in range — nothing to draft.')
    process.exit(1)
  }

  const prompt = buildPrompt(kept)

  if (SHOW_PROMPT) {
    console.log('--- ASSEMBLED PROMPT (claude --print --model ' + MODEL + ') ---\n')
    console.log(prompt)
    console.log('\n--- (--show-prompt: stopping here, no claude call, no DB write) ---')
    return
  }

  const note = runClaude(prompt)
  const row = buildRow(note)

  console.log('--- GENERATED NOTE ---')
  console.log(`headline: ${note.headline}`)
  for (const b of note.bullets) console.log(`  • ${b}`)

  console.log('\n--- ROW THAT WOULD BE INSERTED (release_notes) ---')
  console.log(JSON.stringify(row, null, 2))

  if (!COMMIT) {
    console.log(`\n[DRY-RUN] No DB write. Re-run with --commit to insert this DRAFT.`)
    console.log(`Review + publish drafts at: ${ADMIN_URL}`)
    return
  }

  const created = await insertRow(row)
  console.log(`\n[COMMITTED] Inserted DRAFT release_notes row id=${created.id} (is_published=false).`)
  console.log(`Review + publish at: ${ADMIN_URL}`)
})().catch(e => { console.error(e); process.exit(1) })
