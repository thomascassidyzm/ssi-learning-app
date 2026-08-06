/**
 * Shared release-train machinery — the pieces the Thursday candidate report and the release-notes
 * generator BOTH need, extracted so there is exactly one delta computation, one area clustering
 * and one publish path in this system rather than two that drift apart.
 *
 * Nothing here writes to any branch but `dev`, and nothing here promotes anything.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO = join(HERE, '..', '..')
export const SURFACE = 'http://localhost:4317'
// The ssi-learning-app project orchestrator channel — tapping a card opens this chat.
export const CONV_ID = '8f1c601c-51d0-4de3-8919-dc711e27fc38'
export const GH_REPO = 'thomascassidyzm/ssi-learning-app'
const LOG_FILE = process.env.RELEASE_TRAIN_LOG || '/tmp/ssi-release-train.log'

export const log = (msg) => {
  const line = `${new Date().toISOString()} ${msg}`
  console.error(line)
  try { appendFileSync(LOG_FILE, line + '\n') } catch { /* logging is best-effort */ }
}

export const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 120000, cwd: REPO, ...opts }).trim()

// ── the candidate ───────────────────────────────────────────────────────────

/**
 * The candidate range. Defaults to `origin/main..origin/staging` — the Thursday question.
 *
 * At PROMOTE time the caller passes the range that is ACTUALLY being promoted
 * ({ base: pre-merge main, head: the staging sha }), because by then staging is already merged
 * and the default range is empty. Founder ruling 2026-07-31, "accuracy over elegance": the notes
 * describe the promoted diff, not whatever Thursday guessed at.
 *
 * Note what the range gives us for free: a fix-lane commit that went straight to `main` mid-week
 * is already an ancestor of `main`, so `main..staging` excludes it — immediate-lane fixes stay out
 * of the notes by construction, exactly as the policy requires. No filter needed.
 */
export function candidate({ base = 'origin/main', head = 'origin/staging', fetch = true } = {}) {
  if (fetch) sh('git', ['fetch', 'origin', '--quiet', '--prune'])
  const raw = sh('git', [
    'log', '--format=%H\x1f%s\x1f%aI\x1f%an', `${base}..${head}`, '--',
  ])
  const commits = raw ? raw.split('\n').map((l) => {
    const [sha, subject, date, author] = l.split('\x1f')
    return { sha, subject, date, author }
  }) : []
  return {
    commits,
    base: sh('git', ['rev-parse', base]),
    head: sh('git', ['rev-parse', head]),
    stagingSha: sh('git', ['rev-parse', 'origin/staging']),
    mainSha: sh('git', ['rev-parse', 'origin/main']),
    devAhead: Number(sh('git', ['rev-list', '--count', 'origin/staging..origin/dev'])),
    lastPromote: (() => {
      const d = sh('git', ['log', '-1', '--format=%aI', 'origin/main', '--'])
      return d || null
    })(),
  }
}

// ── condensation ────────────────────────────────────────────────────────────
// Two passes. First, drop PROCESS commits — merges, worklist claim/finish lines, promote
// records, deploy retriggers — which are ~40% of any range here and say nothing about what a
// user gets. Then cluster what's left by AREA, taken from the conventional-commit scope
// (`feat(walkthrough):`) when there is one, else matched off the subject text. Area names are
// the ones this repo actually uses, so the bullets read like the worklist Tom already knows.

export const PROCESS_RE = [
  /^Merge (remote-tracking )?branch/i,
  /^Merge pull request/i,
  /^worklist:/i,
  /^promote:/i,
  /^chore: retrigger/i,
  /^decisions?:/i,
]

export const isProcess = (subject) => PROCESS_RE.some((re) => re.test(subject))

export const AREAS = [
  ['Schools & teachers', /\b(schools?|teacher|classes?|classroom|roster|pupil|student|govt|leader|invite|join code|setup)\b/i],
  ['Player & playback', /\b(player|playback|cycle|audio|round|belt|session|transport|listening|pronunciation|cold[- ]start|swr|course[- ]switch|interlude|typewriter|awakening)\b/i],
  ['Walkthrough & onboarding', /\b(walkthrough|onboard|explainer|how[- ]this[- ]works|guided)\b/i],
  ['Family plan & billing', /\b(family|paddle|billing|subscription|paywall|entitlement|price)\b/i],
  ['Insights & metrics', /\b(insight|metric|analytics|lens|rate[- ]compare|prosody|vad|adaptation|telemetry|player_events)\b/i],
  ['Admin & internal tools', /\b(admin|sentinel|danger[- ]verb|codes|tooling)\b/i],
  ['Infra, cache & offline', /\b(infra|cache|offline|service worker|\bsw\b|vercel|deploy|lockfile|migration|rls|grant)\b/i],
]

export function areaOf(subject) {
  const scope = subject.match(/^[a-z]+\(([^)]+)\):/i)?.[1] || ''
  const hay = `${scope} ${subject}`
  for (const [name, re] of AREAS) if (re.test(hay)) return name
  return 'Other'
}

export const kindOf = (s) =>
  /^(docs?|apml)[:(]/i.test(s) ? 'docs'
    : /^(test|e2e)[:(]/i.test(s) ? 'tests'
      : /^fix[:(]/i.test(s) ? 'fix'
        : 'change'

export function condense(commits) {
  const process_ = commits.filter((c) => isProcess(c.subject))
  const substantive = commits.filter((c) => !isProcess(c.subject))
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

// ── publish ─────────────────────────────────────────────────────────────────
// Files are committed to dev from a throwaway worktree checked out of origin/dev, so this never
// touches the live working tree (an agent may be mid-branch in it) and never needs it clean.
// Failure to push is not fatal to a caller — reports and notes always keep a local copy too.
//
// Takes a LIST of files so the Thursday run lands its report and its draft notes in one commit.

export function publish(files, message) {
  const wt = join(tmpdir(), `ssi-release-train-${process.pid}`)
  try {
    sh('git', ['worktree', 'add', '--detach', wt, 'origin/dev'])
    for (const { relPath, body } of files) {
      const abs = join(wt, relPath)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, body)
      sh('git', ['add', '--', relPath], { cwd: wt })
    }
    const staged = sh('git', ['diff', '--cached', '--name-only'], { cwd: wt })
    if (!staged) { log('files identical to the committed ones — nothing to push'); return true }
    sh('git', ['commit', '-m', message], { cwd: wt })
    sh('git', ['push', 'origin', 'HEAD:dev'], { cwd: wt })
    return true
  } catch (e) {
    log(`WARN could not publish to dev: ${String(e.message || e).slice(0, 300)}`)
    return false
  } finally {
    try { rmSync(wt, { recursive: true, force: true }) } catch { /* best effort */ }
    try { sh('git', ['worktree', 'prune']) } catch { /* best effort */ }
  }
}

// Read a file as it exists on origin/dev (the branch reports and notes live on), or null.
export function readOnDev(relPath) {
  // stderr silenced: a missing file is an expected answer here, not a problem to print.
  try {
    return sh('git', ['show', `origin/dev:${relPath}`], { stdio: ['ignore', 'pipe', 'ignore'] })
  } catch { return null }
}

export async function postCard(text, url, board = 'needs-you') {
  const r = await fetch(`${SURFACE}/api/${board}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, conv_id: CONV_ID, url }),
    signal: AbortSignal.timeout(15000),
  })
  return r.ok
}
