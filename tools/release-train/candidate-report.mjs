#!/usr/bin/env node
/**
 * Release-train candidate report — the Thursday-evening half of the weekly ship.
 *
 * FOUNDER RULING (2026-07-30): "wait on this - I want to ship to production on a weekly
 * basis - Friday mornings." Production ships WEEKLY, FRIDAY MORNINGS, on Tom's explicit GO.
 * Nothing here promotes anything. This script only ANSWERS "what would ship tomorrow, and is
 * it healthy?" and puts that question on Tom's needs-you board as GO / HOLD.
 *
 * Each Thursday run:
 *   1. `git rev-list origin/main..origin/staging` — the exact candidate.
 *   2. Condenses the commits to human headlines: process noise (merges, worklist bookkeeping,
 *      promote records) is separated out, and the substantive commits are clustered by AREA
 *      (schools, player, family/billing, ...) from their conventional-commit scope.
 *   3. CI health: builds a headSha -> conclusion map from the Verify workflow's run history
 *      (check runs are SHA-keyed, so a commit tested on its claude/** branch keeps its verdict
 *      after the merge into dev and the promote to staging), plus the staging head's own
 *      combined status (Vercel).
 *   4. Open regressions / ship-gates read out of WORKLIST.md by keyword heuristic — see
 *      SIGNALS below; the report always states the heuristic it used.
 *   5. Writes the full report to tools/release-train/reports/<date>.md, committed and pushed
 *      to dev from a THROWAWAY GIT WORKTREE (so a cron run can never touch whatever the live
 *      working tree is doing), and posts a needs-you card whose 🔗 opens that report.
 *
 * The needs-you board takes text (300 chars) + url and has no detail field, which is why the
 * detail is a committed file rather than a card body.
 *
 * Usage:  node tools/release-train/candidate-report.mjs [--dry-run] [--no-post] [--no-push]
 *   --dry-run   print the report, touch nothing (implies --no-post --no-push)
 *   --no-post   skip the needs-you card
 *   --no-push   write the report file locally only, no worktree/commit/push
 * Exit 0 = reported. Exit 1 = could not produce a report (said so on the board if it could).
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const REPORTS_DIR = join(HERE, 'reports')
const LOG_FILE = process.env.RELEASE_TRAIN_LOG || '/tmp/ssi-release-train.log'

const SURFACE = 'http://localhost:4317'
// The ssi-learning-app project orchestrator channel — tapping the card opens this chat.
const CONV_ID = '8f1c601c-51d0-4de3-8919-dc711e27fc38'
const GH_REPO = 'thomascassidyzm/ssi-learning-app'
const WORKLIST = join(REPO, 'WORKLIST.md')

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const NO_POST = DRY || argv.includes('--no-post')
const NO_PUSH = DRY || argv.includes('--no-push')

const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`
  console.error(line)
  try { appendFileSync(LOG_FILE, line + '\n') } catch { /* logging is best-effort */ }
}
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 120000, cwd: REPO, ...opts }).trim()

// ── 1. the candidate ────────────────────────────────────────────────────────

function candidate() {
  sh('git', ['fetch', 'origin', '--quiet', '--prune'])
  const raw = sh('git', [
    'log', '--format=%H\x1f%s\x1f%aI\x1f%an', 'origin/main..origin/staging', '--',
  ])
  const commits = raw ? raw.split('\n').map((l) => {
    const [sha, subject, date, author] = l.split('\x1f')
    return { sha, subject, date, author }
  }) : []
  return {
    commits,
    stagingSha: sh('git', ['rev-parse', 'origin/staging']),
    mainSha: sh('git', ['rev-parse', 'origin/main']),
    devAhead: Number(sh('git', ['rev-list', '--count', 'origin/staging..origin/dev'])),
    lastPromote: (() => {
      const d = sh('git', ['log', '-1', '--format=%aI', 'origin/main', '--'])
      return d || null
    })(),
  }
}

// ── 2. condensation ─────────────────────────────────────────────────────────
// Two passes. First, drop PROCESS commits — merges, worklist claim/finish lines, promote
// records, deploy retriggers — which are ~40% of any range here and say nothing about what a
// user gets. Then cluster what's left by AREA, taken from the conventional-commit scope
// (`feat(walkthrough):`) when there is one, else matched off the subject text. Area names are
// the ones this repo actually uses, so the bullets read like the worklist Tom already knows.

const PROCESS_RE = [
  /^Merge (remote-tracking )?branch/i,
  /^Merge pull request/i,
  /^worklist:/i,
  /^promote:/i,
  /^chore: retrigger/i,
  /^decisions?:/i,
]

const AREAS = [
  ['Schools & teachers', /\b(schools?|teacher|classes?|classroom|roster|pupil|student|govt|leader|invite|join code|setup)\b/i],
  ['Player & playback', /\b(player|playback|cycle|audio|round|belt|session|transport|listening|pronunciation|cold[- ]start|swr|course[- ]switch|interlude|typewriter|awakening)\b/i],
  ['Walkthrough & onboarding', /\b(walkthrough|onboard|explainer|how[- ]this[- ]works|guided)\b/i],
  ['Family plan & billing', /\b(family|paddle|billing|subscription|paywall|entitlement|price)\b/i],
  ['Insights & metrics', /\b(insight|metric|analytics|lens|rate[- ]compare|prosody|vad|adaptation|telemetry|player_events)\b/i],
  ['Admin & internal tools', /\b(admin|sentinel|danger[- ]verb|codes|tooling)\b/i],
  ['Infra, cache & offline', /\b(infra|cache|offline|service worker|\bsw\b|vercel|deploy|lockfile|migration|rls|grant)\b/i],
]

function areaOf(subject) {
  const scope = subject.match(/^[a-z]+\(([^)]+)\):/i)?.[1] || ''
  const hay = `${scope} ${subject}`
  for (const [name, re] of AREAS) if (re.test(hay)) return name
  return 'Other'
}

const kindOf = (s) =>
  /^(docs?|apml)[:(]/i.test(s) ? 'docs'
    : /^(test|e2e)[:(]/i.test(s) ? 'tests'
      : /^fix[:(]/i.test(s) ? 'fix'
        : 'change'

function condense(commits) {
  const process_ = commits.filter((c) => PROCESS_RE.some((re) => re.test(c.subject)))
  const substantive = commits.filter((c) => !PROCESS_RE.some((re) => re.test(c.subject)))
  const byArea = new Map()
  for (const c of substantive) {
    const a = areaOf(c.subject)
    if (!byArea.has(a)) byArea.set(a, [])
    byArea.get(a).push({ ...c, kind: kindOf(c.subject) })
  }
  // Biggest area first — that is the headline of the week.
  const areas = [...byArea.entries()]
    .map(([name, list]) => ({
      name,
      list,
      // "code" = anything that isn't a docs or test commit; that count is what a founder cares
      // about when judging risk, so it leads each area line.
      code: list.filter((c) => c.kind !== 'docs' && c.kind !== 'tests').length,
    }))
    .sort((a, b) => b.code - a.code || b.list.length - a.list.length)
  return { process_, substantive, areas }
}

// ── 3. CI health ────────────────────────────────────────────────────────────
// verify.yml runs on claude/**, dev, staging, main and PRs. Runs are SHA-keyed, so for any
// candidate commit we can ask "did Verify ever go green on exactly this tree?" regardless of
// which branch it was on when tested. Commits with no run at all are reported as UNTESTED
// rather than silently counted green — most of those are merge commits, which is why the
// substantive/process split matters here too.

function gh(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', timeout: 90000, cwd: REPO }))
}

function ciHealth(cand) {
  const out = { verify: null, stagingHead: null, error: null }
  try {
    // gh paginates internally up to --limit; 400 covers well over a month of pushes here.
    const runs = gh(['run', 'list', '--workflow', 'verify.yml', '--limit', '400',
      '--json', 'headSha,conclusion,status,displayTitle'])
    const verdict = new Map()
    for (const r of runs) {
      // run list is newest-first; keep the newest verdict per sha
      if (!verdict.has(r.headSha)) verdict.set(r.headSha, r.conclusion || r.status)
    }
    const green = [], red = [], untested = []
    for (const c of cand.commits) {
      const v = verdict.get(c.sha)
      if (v === 'success') green.push(c)
      else if (v === undefined) untested.push(c)
      else red.push({ ...c, conclusion: v })
    }
    out.verify = { green, red, untested, runsScanned: runs.length }
  } catch (e) {
    out.error = String(e.message || e).slice(0, 200)
  }
  try {
    const st = gh(['api', `repos/${GH_REPO}/commits/${cand.stagingSha}/status`])
    out.stagingHead = {
      state: st.state,
      contexts: (st.statuses || []).map((s) => `${s.context}: ${s.state}`),
    }
  } catch (e) {
    out.stagingHead = { state: 'unreadable', contexts: [String(e.message || e).slice(0, 120)] }
  }
  return out
}

// ── 4. worklist signals ─────────────────────────────────────────────────────
// HEURISTIC, stated in the report so nobody mistakes it for a tracker query. WORKLIST.md is
// one line per item with a status box, so each signal is a regex over open lines only:
//   blocked      — `[!]` items (the worklist's own parked/blocked mark)
//   regression   — open items whose text names a live defect (founder bug, desync, wobble, ...)
//   unverified   — open items that say SHIPPED but never say verified/green/PASS
//   ship-gate    — parked migrations & follow-ups whose stated gate is "reaching MAIN", i.e.
//                  things tomorrow's promote would UNBLOCK. Cheap and high-value on a ship day.

const SIGNALS = [
  ['Blocked / parked', (it) => it.box === '!'],
  ['Named regression / live defect', (it) =>
    /\b(regression|founder bug|desync|wobble|broken|stuck|crashes?|leaks?)\b/i.test(it.text)],
  ['Shipped but not stated-verified', (it) =>
    /\bSHIPPED\b/.test(it.text) && !/\b(verified|green|ALL PASS|\d+ PASS)\b/i.test(it.text)],
  ['Unblocked by this promote (gated on MAIN)', (it) =>
    /\bMAIN\b/.test(it.text) && /\b(gated|parked|until|once)\b/i.test(it.text)],
]

// Only real worklist ITEMS count — a line that merely quotes `[~]` inside prose (the header's
// protocol explainer does exactly that) is not an open item and must not raise a flag.
const ITEM_RE = /^\s*[-*]\s*\[([ ~!])\]\s*(.*)$/

function worklistSignals() {
  let text
  try { text = sh('git', ['show', 'origin/staging:WORKLIST.md']) } catch {
    try { text = execFileSync('cat', [WORKLIST], { encoding: 'utf8' }) } catch { return null }
  }
  const items = text.split('\n').map((l) => {
    const m = l.match(ITEM_RE)
    return m ? { box: m[1], text: m[2].replace(/\s+/g, ' ').trim() } : null
  }).filter(Boolean)
  const short = (t) => (t.length > 220 ? t.slice(0, 219) + '…' : t)
  return SIGNALS.map(([name, match]) => ({
    name, hits: items.filter(match).map((it) => short(it.text)),
  })).filter((s) => s.hits.length)
}

// ── 5. render ───────────────────────────────────────────────────────────────

function render(cand, cond, ci, signals, dateStr, extraNotes) {
  const L = []
  const n = cand.commits.length
  L.push(`# Friday ship candidate — ${dateStr}`)
  L.push('')
  L.push(`**${n} commits on \`staging\` and not on \`main\`.** Tom decides GO or HOLD; nothing`)
  L.push('promotes without his word (founder ruling 2026-07-30).')
  L.push('')
  L.push(`- candidate range: \`${cand.mainSha.slice(0, 7)}..${cand.stagingSha.slice(0, 7)}\` — [compare on GitHub](https://github.com/${GH_REPO}/compare/main...staging)`)
  L.push(`- \`dev\` is ${cand.devAhead} commit(s) ahead of \`staging\` (not in this candidate)`)
  L.push(`- last production commit landed ${cand.lastPromote ? cand.lastPromote.slice(0, 10) : 'unknown'}`)
  L.push('')

  L.push('## What ships')
  L.push('')
  L.push(`${cond.substantive.length} substantive commits, ${cond.process_.length} process commits`)
  L.push('(merges, worklist claims, promote records — no user-facing change).')
  L.push('')
  // Areas with no code commits are docs/tests only — worth a count, not a heading.
  const docsOnly = cond.areas.filter((a) => a.code === 0)
  for (const a of cond.areas.filter((a) => a.code > 0)) {
    const docs = a.list.length - a.code
    L.push(`### ${a.name} — ${a.code} code${docs ? ` + ${docs} docs/tests` : ''}`)
    for (const c of a.list.filter((x) => x.kind !== 'docs' && x.kind !== 'tests').slice(0, 6)) {
      L.push(`- ${c.subject.length > 150 ? c.subject.slice(0, 149) + '…' : c.subject}`)
    }
    const rest = a.code - Math.min(a.code, 6)
    if (rest > 0) L.push(`- …and ${rest} more`)
    L.push('')
  }
  if (docsOnly.length) {
    L.push(`Docs/tests only, no code: ${docsOnly.map((a) => `${a.name} (${a.list.length})`).join(', ')}.`)
    L.push('')
  }

  L.push('## CI health')
  L.push('')
  if (ci.error) {
    L.push(`Verify-workflow history unreadable: \`${ci.error}\` — **treat CI as unknown**.`)
  } else {
    const { green, red, untested } = ci.verify
    L.push(`Verify (lint · player typecheck · api typecheck · player tests · api tests), matched per commit SHA across ${ci.verify.runsScanned} recent runs:`)
    L.push('')
    L.push(`- ✅ green: ${green.length}`)
    L.push(`- ${red.length ? '❌' : '✅'} red: ${red.length}`)
    L.push(`- ⬜ no run recorded: ${untested.length} (mostly merge commits, which CI does not run on individually)`)
    if (red.length) {
      L.push('')
      L.push('**Red commits:**')
      for (const c of red.slice(0, 10)) L.push(`- \`${c.sha.slice(0, 7)}\` ${c.conclusion} — ${c.subject.slice(0, 110)}`)
    }
  }
  L.push('')
  if (ci.stagingHead) {
    L.push(`Staging head \`${cand.stagingSha.slice(0, 7)}\` combined status: **${ci.stagingHead.state}** — ${ci.stagingHead.contexts.join('; ') || 'no contexts'}.`)
  }
  L.push('')

  L.push('## Open regressions & gates')
  L.push('')
  L.push('Heuristic (not a tracker query): open `[ ]`/`[~]`/`[!]` lines in `WORKLIST.md` on');
  L.push('`staging`, matched on the keyword sets below. Read it as a prompt to look, not a verdict.')
  L.push('')
  if (!signals || !signals.length) {
    L.push('No lines matched.')
  } else {
    for (const s of signals) {
      L.push(`### ${s.name} (${s.hits.length})`)
      for (const h of s.hits.slice(0, 8)) L.push(`- ${h}`)
      if (s.hits.length > 8) L.push(`- …and ${s.hits.length - 8} more`)
      L.push('')
    }
  }

  if (extraNotes) { L.push(extraNotes); L.push('') }

  L.push('## The decision')
  L.push('')
  L.push('**GO** → run the promote in `docs/RELEASE-TRAIN.md` (`tools/release-train/promote.sh`).')
  L.push('The deploy sentinel picks up the main push within 3 minutes and watches production for 2h.')
  L.push('')
  L.push('**HOLD** → say what to fix; the candidate rolls to next Friday and grows.')
  L.push('')
  return L.join('\n') + '\n'
}

// ── 6. publish ──────────────────────────────────────────────────────────────
// The report is committed to dev from a throwaway worktree checked out of origin/dev, so this
// never touches the live working tree (an agent may be mid-branch in it) and never needs it
// clean. Failure to push is not fatal: the card falls back to the GitHub compare link.

function publish(relPath, body) {
  const wt = join(tmpdir(), `ssi-release-train-${process.pid}`)
  try {
    sh('git', ['worktree', 'add', '--detach', wt, 'origin/dev'])
    const abs = join(wt, relPath)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, body)
    sh('git', ['add', '--', relPath], { cwd: wt })
    const staged = sh('git', ['diff', '--cached', '--name-only'], { cwd: wt })
    if (!staged) { log('report identical to the committed one — nothing to push'); return true }
    sh('git', ['commit', '-m', `release-train: Friday ship candidate report ${relPath.split('/').pop().replace('.md', '')}`], { cwd: wt })
    sh('git', ['push', 'origin', 'HEAD:dev'], { cwd: wt })
    return true
  } catch (e) {
    log(`WARN could not publish report to dev: ${String(e.message || e).slice(0, 300)}`)
    return false
  } finally {
    try { rmSync(wt, { recursive: true, force: true }) } catch { /* best effort */ }
    try { sh('git', ['worktree', 'prune']) } catch { /* best effort */ }
  }
}

async function postCard(text, url) {
  const r = await fetch(`${SURFACE}/api/needs-you`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, conv_id: CONV_ID, url }),
    signal: AbortSignal.timeout(15000),
  })
  return r.ok
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const cand = candidate()
  const n = cand.commits.length
  const dateStr = new Date().toISOString().slice(0, 10)

  if (n === 0) {
    log('nothing on staging that is not on main — no candidate, no card')
    return 0
  }

  const cond = condense(cand.commits)
  const ci = ciHealth(cand)
  const signals = worklistSignals()

  const extra = process.env.RELEASE_TRAIN_EXTRA_NOTES || ''
  const body = render(cand, cond, ci, signals, dateStr, extra)
  const relPath = `tools/release-train/reports/${dateStr}.md`

  if (DRY) { process.stdout.write(body); return 0 }

  // Always keep a local copy, whether or not the push works.
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(join(REPORTS_DIR, `${dateStr}.md`), body)

  let url = `https://github.com/${GH_REPO}/compare/main...staging`
  if (!NO_PUSH && publish(relPath, body)) {
    url = `https://github.com/${GH_REPO}/blob/dev/${relPath}`
  }

  const areaBits = cond.areas.filter((a) => a.code > 0).slice(0, 4)
    .map((a) => `${a.name.split(' ')[0].toLowerCase()} ${a.code}`).join(', ')
  const ciBit = ci.error ? 'CI unknown'
    : ci.verify.red.length ? `${ci.verify.red.length} RED in CI`
      : 'CI green'
  const riskBit = signals?.find((s) => s.name.startsWith('Named regression'))?.hits.length
  const headline = `Friday ship: ${n} commits ready — GO / HOLD. ${ciBit}. ${areaBits}.` +
    `${riskBit ? ` ${riskBit} open regression flag(s).` : ''} Tap for the candidate report.`

  log(`report ready: ${n} commits, ${ciBit}, url ${url}`)
  if (!NO_POST) {
    const ok = await postCard(headline.slice(0, 300), url)
    log(`needs-you card posted: ${ok}`)
  }
  return 0
}

main().then((c) => process.exit(c)).catch((e) => {
  log(`FATAL: ${e.stack || e}`)
  // Never fail silently on a Thursday — a broken report is itself a thing Tom must know.
  postCard(`Friday ship: candidate report FAILED to build — ${String(e.message || e).slice(0, 180)}`,
    `https://github.com/${GH_REPO}/compare/main...staging`).catch(() => {})
  setTimeout(() => process.exit(1), 2000)
})
