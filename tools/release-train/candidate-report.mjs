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
 *   3. CI health: builds a headSha -> verdict map from the watson-1 nightly's own history file
 *      (ops/ci-history.tsv on the command surface — SHA-keyed, so a verdict follows a commit
 *      through a merge and a promote), plus whatever that nightly knows about the staging head.
 *      Coverage is HEAD-OF-BRANCH NIGHTLY, not per-commit: most candidates are legitimately
 *      untested and the report says so rather than rounding them green.
 *   4. Open regressions / ship-gates read out of WORKLIST.md by keyword heuristic — see
 *      SIGNALS below; the report always states the heuristic it used.
 *   5. Drafts the RELEASE NOTES for this candidate (release-notes.mjs — headlines only, in
 *      user-facing language, under-claiming by construction) so Tom can eyeball and tweak them
 *      before he says GO. Friday's promote stamps that same file final.
 *   6. Writes the full report to tools/release-train/reports/<date>.md AND the draft notes to
 *      tools/release-train/notes/<date>.md, committed and pushed to dev in ONE commit from a
 *      THROWAWAY GIT WORKTREE (so a cron run can never touch whatever the live working tree is
 *      doing), and posts a needs-you card whose 🔗 opens that report.
 *
 * The delta computation, area clustering and publish path live in lib.mjs and are shared with the
 * notes generator — one pipeline, two renderings.
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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  REPO, GH_REPO, log, sh, candidate, condense, publish, postCard,
} from './lib.mjs'
import { buildNotes, render as renderNotes, NOTES_REL } from './release-notes.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPORTS_DIR = join(HERE, 'reports')
const WORKLIST = join(REPO, 'WORKLIST.md')

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const NO_POST = DRY || argv.includes('--no-post')
const NO_PUSH = DRY || argv.includes('--no-push')

// ── 3. CI health ────────────────────────────────────────────────────────────
// WHERE THE VERDICTS COME FROM (rewired 2026-08-29). GitHub Actions has been dormant on this
// repo since 2026-08-14 — verify.yml and auto-merge-claude.yml have not run since, so the old
// `gh run list` map came back EMPTY and every candidate commit read UNTESTED. The gate now is the
// nightly CI on watson-1 (03:00, ssi-ci.timer), which runs the checks out of this repo's own
// workflow file and appends one row per target per run to:
//
//     /home/tomcassidy/command-surface/ops/ci-history.tsv
//     # ts  target  sha  verdict  run          — tab-separated, append-only, FULL sha in col 3
//
// It is SHA-keyed exactly as the check-run history was, so a verdict still follows a commit
// across a merge into dev and a promote to staging.
//
// AND IT IS SPARSE, WHICH IS THE WHOLE HONESTY PROBLEM HERE. The nightly records the head SHA of
// four refs (dashboard@main, learning-app@dev/staging/main) on the nights it ran — NOT every
// commit that was ever pushed, which is what the per-push check runs used to give. So most
// candidate commits will legitimately have no verdict, and "untested" has to stay a first-class
// third answer rather than being rounded to green or to red. Present with `green` is green;
// present with `red` is red; ABSENT IS UNTESTED, and so is a SHA the runner could only ever
// record as `cannot-run` — a check that could not run is never a pass (Tom, 2026-08-28).
//
// Rows are newest-LAST in this file (the inverse of `gh run list`, which was newest-first), so a
// repeated SHA takes its LAST row. One refinement: a definitive verdict is never overwritten by a
// later `cannot-run`. A green or red is a fact about that tree; a night the runner itself broke
// says nothing about it, and must not erase what we already knew.
//
// auto-merge-claude.yml is dead too and was not replaced, so commits that were only ever tested
// on a claude/** branch have no verdict at all here. They are untested, and that is the truth.

const CI_HISTORY = process.env.CI_HISTORY_TSV
  || '/home/tomcassidy/command-surface/ops/ci-history.tsv'

/** the SHA -> verdict map, built from the nightly's own history file */
export function ciVerdictMap(file = CI_HISTORY) {
  const raw = readFileSync(file, 'utf8')
  const verdict = new Map()
  let rows = 0, first = null, last = null
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const [ts, target, sha, v] = line.split('\t')
    if (!sha || !v) continue
    rows++
    if (!first) first = ts
    last = ts
    // last row wins, EXCEPT that cannot-run never displaces a definitive verdict
    if (v === 'cannot-run' && verdict.has(sha) && verdict.get(sha).verdict !== 'cannot-run') continue
    verdict.set(sha, { verdict: v, target, ts })
  }
  return { verdict, rows, first, last }
}

function ciHealth(cand) {
  const out = { verify: null, stagingHead: null, error: null }
  let map
  try {
    map = ciVerdictMap()
  } catch (e) {
    // A missing or unreadable history file is an ERROR, never an empty map: an empty map would
    // read as "everything untested", which is indistinguishable from a healthy sparse night.
    out.error = `${CI_HISTORY}: ${String(e.message || e).slice(0, 160)}`
    return out
  }
  const { verdict, rows, first, last } = map
  const green = [], red = [], untested = []
  for (const c of cand.commits) {
    const v = verdict.get(c.sha)
    if (v && v.verdict === 'green') green.push(c)
    else if (v && v.verdict === 'red') red.push({ ...c, conclusion: 'red' })
    else untested.push(c)
  }
  out.verify = {
    green,
    red,
    untested,
    rowsScanned: rows,
    shasKnown: verdict.size,
    since: (first || '').slice(0, 10),
    until: (last || '').slice(0, 10),
  }
  // The staging head used to be read with `gh api repos/<r>/commits/<sha>/status` — the combined
  // commit status. That call is on the same dead signal as the rest of this function, so rather
  // than leave it failing silently into an "unreadable" string every week it is answered from the
  // SAME history file: the nightly tests learning-app@staging by name, so where it has a verdict
  // for this exact SHA we can state it, and where it has none we say so plainly.
  const st = verdict.get(cand.stagingSha)
  out.stagingHead = st
    ? { state: st.verdict, source: `watson-1 nightly (${st.target}, ${st.ts.slice(0, 16)}Z)` }
    : { state: 'not tested at this SHA', source: 'watson-1 nightly — no row for this commit' }
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

function render(cand, cond, ci, signals, dateStr, extraNotes, notes) {
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

  // The founder-readable half first: the draft release notes for this exact candidate. The full
  // notes file is committed alongside this report and is what Friday's promote stamps final.
  if (notes) {
    L.push('## Release notes (draft)')
    L.push('')
    if (!notes.features.length && !notes.fixes.length) {
      L.push('Nothing in this candidate translated confidently into a user-facing headline.')
    } else {
      // Up to 3 features then the fixes — the founder-ruled shape (2026-07-30).
      if (notes.features.length) {
        L.push("**What's new**")
        for (const b of notes.features) L.push(`- ${b.headline}`)
        L.push('')
      }
      if (notes.fixes.length) {
        L.push('**Fixes**')
        for (const b of notes.fixes) L.push(`- ${b.headline}`)
        L.push('')
      }
      L.push(`Draft: [\`${NOTES_REL(dateStr)}\`](../notes/${dateStr}.md) — edit the bullets there before GO;`)
      L.push('`promote.sh --go` stamps that file with the ship date and the promoted sha, keeping your edits.')
    }
    L.push('')
  }

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
    L.push(`Nightly CI history unreadable: \`${ci.error}\` — **treat CI as unknown**. Nothing here has been tested as far as this report can tell.`)
  } else {
    const { green, red, untested } = ci.verify
    L.push(`Source: the **watson-1 nightly** (03:00, \`ssi-ci.timer\`) — lint · player typecheck · api typecheck · player tests · api tests, out of this repo's own workflow file. GitHub Actions has been dormant since 2026-08-14 and is not consulted.`)
    L.push('')
    L.push(`Matched per commit SHA against ${ci.verify.rowsScanned} rows covering ${ci.verify.shasKnown} distinct commits, ${ci.verify.since} → ${ci.verify.until}. **Coverage is head-of-branch nightly, not per-commit**: the nightly tests the head of dev, staging and main on the nights it runs, so a commit in the middle of a batch has no verdict of its own. A large "no verdict" count is normal and does NOT mean anything broke.`)
    L.push('')
    L.push(`- ✅ green: ${green.length}`)
    L.push(`- ${red.length ? '❌' : '✅'} red: ${red.length}`)
    L.push(`- ⬜ no verdict recorded: ${untested.length} (never the head of a branch on a night the nightly ran — untested, which is not the same as failing)`)
    if (red.length) {
      L.push('')
      L.push('**Red commits:**')
      for (const c of red.slice(0, 10)) L.push(`- \`${c.sha.slice(0, 7)}\` ${c.conclusion} — ${c.subject.slice(0, 110)}`)
    }
  }
  L.push('')
  if (ci.stagingHead) {
    L.push(`Staging head \`${cand.stagingSha.slice(0, 7)}\`: **${ci.stagingHead.state}** — ${ci.stagingHead.source}.`)
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

  // Draft the release notes off the SAME candidate and condensation — one delta computation,
  // two renderings. A notes failure must never cost Tom the report, so it is caught.
  let notes = null, notesBody = null
  try {
    notes = buildNotes(cand)
    notesBody = renderNotes(cand, notes, { draftDate: dateStr })
  } catch (e) {
    log(`WARN could not draft release notes: ${String(e.message || e).slice(0, 200)}`)
  }

  const extra = process.env.RELEASE_TRAIN_EXTRA_NOTES || ''
  const body = render(cand, cond, ci, signals, dateStr, extra, notes)
  const relPath = `tools/release-train/reports/${dateStr}.md`

  if (DRY) {
    process.stdout.write(body)
    if (notesBody) process.stdout.write(`\n${'='.repeat(78)}\n${NOTES_REL(dateStr)}\n${'='.repeat(78)}\n\n${notesBody}`)
    return 0
  }

  // Always keep local copies, whether or not the push works.
  mkdirSync(REPORTS_DIR, { recursive: true })
  writeFileSync(join(REPORTS_DIR, `${dateStr}.md`), body)
  if (notesBody) {
    mkdirSync(join(HERE, 'notes'), { recursive: true })
    writeFileSync(join(HERE, 'notes', `${dateStr}.md`), notesBody)
  }

  const files = [{ relPath, body }]
  if (notesBody) files.push({ relPath: NOTES_REL(dateStr), body: notesBody })
  let url = `https://github.com/${GH_REPO}/compare/main...staging`
  if (!NO_PUSH && publish(files, `release-train: Friday ship candidate report ${dateStr}` +
    (notesBody ? ' + draft release notes' : ''))) {
    url = `https://github.com/${GH_REPO}/blob/dev/${relPath}`
  }

  const areaBits = cond.areas.filter((a) => a.code > 0).slice(0, 4)
    .map((a) => `${a.name.split(' ')[0].toLowerCase()} ${a.code}`).join(', ')
  const ciBit = ci.error ? 'CI unknown'
    : ci.verify.red.length ? `${ci.verify.red.length} RED in nightly CI`
      : ci.verify.green.length ? 'nightly CI green'
        : 'nightly CI has no verdict on this candidate'
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
