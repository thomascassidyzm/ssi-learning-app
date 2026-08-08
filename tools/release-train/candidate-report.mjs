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
import { mkdirSync, writeFileSync } from 'node:fs'
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
