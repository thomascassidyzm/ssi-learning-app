#!/usr/bin/env node
/**
 * Release notes — headlines only, generated from the same candidate the Thursday report reads.
 *
 * FOUNDER BRIEF (2026-07-30): "Tom never writes release notes separately." So the notes are a
 * by-product of the release train, at the two moments that already exist:
 *
 *   Thursday  the candidate report run drafts the notes alongside it (same commit, same push),
 *             so Tom eyeballs and tweaks them before he says GO.
 *   Friday    promote.sh --go stamps the SAME file final with the ship date and the promoted sha.
 *             Hand edits are preserved — finalize rewrites only the header block.
 *
 * WHAT THESE ARE NOT. Not a changelog. `CHANGELOG.md` is Tom's own prose, per promotion, and
 * stays hand-written; these notes are its headline skeleton and a shippable summary in their own
 * right.
 *
 * SHAPE — FOUNDER RULING (2026-07-30), amended (2026-07-31): UP TO 3 most significant features
 * FOR THE USERS, then ONE catch-all section — "Other stuff and bug fixes" — that absorbs both the
 * overflow features (one short line each, same under-claim rule) and the bug fixes. Nothing
 * shipped goes unmentioned; it is just compact below the fold. Verbatim: "Keep to 3 biggest and
 * then other stuff and bug fixes."
 *
 * RANKING — FOUNDER RULING (2026-07-31): when picking the 3 biggest, player/learner-facing items
 * outrank schools/teacher/leader items — most users are learners, not teachers or school leaders.
 * Verbatim: "focus on the player stuff - most people are not teachers/school leaders." Each
 * phrasebook entry carries an AUDIENCE ('player' | 'general' | 'schools'); feature ranking sorts
 * on significance × AUDIENCE_WEIGHT before commit count, so a schools item never edges out an
 * equally-significant player item for one of the 3 headline slots.
 *
 * Significance itself is a per-surface judgement carried as a weight on each phrasebook entry, NOT
 * commit count. All of it in user/teacher-facing language — no commit hashes, no refactors, no
 * process commits.
 *
 * THE HONESTY RULE (the whole design, really): a commit earns a bullet only if it can be
 * translated CONFIDENTLY. Everything else is dropped, never guessed at. Three gates in order:
 *   1. kind veto      — docs, tests, chores and refactors are internal by construction.
 *   2. not-live veto  — "stage 1", "phase 1", "shadow", "behind flag", "groundwork": shipped
 *                       code that no user can see yet must not be announced.
 *   3. translate      — a PHRASEBOOK of durable product surfaces gives polished wording; a
 *                       commit that matches nothing must still clear a user-facing-noun
 *                       requirement AND an internal-jargon veto to get a generic bullet.
 * The draft lists what was dropped so the coverage is visible and Tom can add a bullet by hand.
 * Notes under-claim by construction. That is the point.
 *
 * Usage:
 *   node tools/release-train/release-notes.mjs                     # draft: write + push to dev
 *   node tools/release-train/release-notes.mjs --dry-run           # print, touch nothing
 *   node tools/release-train/release-notes.mjs --no-push           # local file only
 *   node tools/release-train/release-notes.mjs --finalize --sha X   # Friday stamp (promote.sh)
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  candidate, condense, areaOf, publish, readOnDev, log, sh, GH_REPO,
} from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const NOTES_DIR = join(HERE, 'notes')
export const NOTES_REL = (date) => `tools/release-train/notes/${date}.md`

const HEADER_OPEN = '<!-- release-notes:header -->'
const HEADER_CLOSE = '<!-- /release-notes:header -->'
const DRAFT_OPEN = '<!-- release-notes:draft-only -->'
const DRAFT_CLOSE = '<!-- /release-notes:draft-only -->'

// ── gate 1: kinds that are internal by construction ─────────────────────────

const KIND_VETO = /^(docs?|apml|test|e2e|chore|build|ci|refactor|style|audit|security)[:(]/i

// ── gate 2: shipped-but-not-switched-on ─────────────────────────────────────
// Code can be on main and invisible: dark behind a flag, stage/phase 1 of a series, shadow-mode
// observers, spec-only work. Announcing those is over-claiming, which is the one failure mode
// these notes may not have.

const NOT_LIVE_VETO = /\b(stage \d|phase \d|shadow|behind (a )?flag|dark|groundwork|scaffold(ing)?|spec(-only)?|design (doc|pack|exploration)|proposal|retroactive|do not re-?apply|forward-pointing|preparation)\b/i

// ── gate 3a: the phrasebook — durable product surfaces, polished wording ─────
// Keyed on SURFACES (course switching, invite links, the schools nav), not on individual
// commits, so entries keep earning their keep week after week. Add an entry when a new
// user-facing surface appears; never add one to force a bullet for a single commit.

// AUDIENCE_WEIGHT — founder ruling 2026-07-31: player/learner-facing items outrank
// schools/teacher/leader items when picking the 3 headline features. 'general' (both, or neither
// specifically) sits between the two. This is a ranking multiplier only — it never changes which
// section a bullet lands in or its displayed wording.
export const AUDIENCE_WEIGHT = { player: 1.2, general: 1, schools: 0.8 }

const PHRASEBOOK = [
  // [surface, qualifier, headline, kind, significance, area?, audience?]
  //   kind         'feature' (competes for the 3 headline slots) or 'fix' (the catch-all section)
  //   significance 3 = a user would notice and care · 2 = notable · 1 = minor/cosmetic
  //   audience     'player' (learners) · 'schools' (teachers/leaders/admins) · 'general' (default)
  // Wording corrected 2026-07-31 in the reconciliation pass: the change killed the cinematic
  // floor and lands READY in 2-3s. "Near-instant" over-claimed that, and over-claiming is the one
  // failure mode these notes may not have.
  [/course[- ]switch/i, /ready|instant|floor|\d ?s\b/i,
    'Switching course is quicker — it no longer waits through the full loading sequence.',
    'feature', 3, undefined, 'player'],
  [/cold[- ]start|course load/i, /never blocks|swr|progressive|readiness/i,
    'The app starts as soon as it is ready to play, instead of waiting for a whole course to load.',
    'feature', 3, undefined, 'player'],
  [/invite/i, /link|personal|capture|code/i,
    'Invitations work as links, with a short code kept as the fallback.',
    'feature', 3, undefined, 'schools'],
  [/walkthrough/i, /engine|walks/i,
    'Guided walkthroughs of the product, for learners, teachers and leaders.',
    'feature', 3, 'Walkthrough & onboarding', 'general'],
  [/schools nav|nav unification/i, /view|unif|tabs|redirect/i,
    'School leaders and admins land on the unified dashboard view, with the same navigation everywhere.',
    'feature', 3, undefined, 'schools'],
  [/teacher surface|nav persists/i, /player|chip|exits|nav/i,
    'Teachers keep their navigation inside the player, and finishing a session returns them to the schools home.',
    'feature', 2, undefined, 'schools'],
  [/how[- ]this[- ]works|explainer/i, /surfacing|discoverab|throb|single/i,
    '"How this works" now has one home, with a gentle nudge so it is easy to find.',
    'feature', 2, undefined, 'general'],
  [/insight|analytics/i, /faster|cold|lens|wave/i,
    'Insights load faster at every level of an organisation.', 'feature', 2, undefined, 'schools'],
  [/danger[- ]verb/i, /guard/i,
    'Destructive admin actions now confirm before they act.', 'feature', 1, undefined, 'schools'],
  [/transport|play[- ]state|play[- ]button/i, /desync|pull|sync/i,
    'The play button no longer falls out of step with what is actually playing.',
    'fix', 2, undefined, 'player'],
  [/walkthrough/i, /guardrail|rails/i,
    'Guided walkthroughs no longer collide with playback.', 'fix', 2,
    'Walkthrough & onboarding', 'general'],
  [/offline/i, /download(s|ing)?\b|for the plane|pack/i,
    'Offline downloads are more reliable.', 'fix', 2, undefined, 'player'],
  // Both added 2026-07-31 by the reconciliation of the 2026-07-30 ship: each names a real
  // user-visible surface whose commit subject reads as machinery, so the generic path dropped it
  // ("names nothing a user can see") and a true fix went unannounced. Surfaces, not one-offs:
  // the update/relaunch screen and the where-you-are rail both recur.
  [/updating the app|update overlay|relaunch/i, /stuck|deadline|heal|tap/i,
    'The "Updating the app" screen can no longer get stuck — it gives up and offers a tap to relaunch.',
    'fix', 3, undefined, 'player'],
  [/where[- ]you[- ]are|rail/i, /stab(le|ility)|surviv|flash|rehydrat|persist/i,
    'Where-you-are stays put when you move between Overview and Insights.',
    'fix', 2, undefined, 'schools'],
  [/typewriter|awakening/i, /mid-word|never cut/i,
    'Opening text is no longer cut off mid-word.', 'fix', 1, undefined, 'player'],
  [/loading|resting/i, /sentence[- ]cas|copy/i,
    'Loading and resting messages read like sentences rather than labels.',
    'fix', 1, undefined, 'player'],
  [/teacher home|classes-first/i, /pac|primary|stats|class/i,
    'The teacher home now leads with your classes, with a bigger Play-as-Class button.',
    'feature', 2, undefined, 'schools'],
]

// ── gate 3b: the generic path ───────────────────────────────────────────────
// A commit that matches no phrasebook entry can still earn a bullet, but only if its subject
// names something a user can see AND carries no internal-machinery vocabulary. Both lists are
// deliberately strict: a dropped real feature costs one hand-typed bullet, an invented one costs
// trust.

const USER_FACING = /\b(course|courses|player|playback|audio|voice|session|belt|round|skip|pause|listening|pronunciation|teacher|teachers|school|schools|class|classes|student|students|leader|learner|invite|dashboard|settings|sign[- ]?in|login|offline|download|progress|walkthrough|explainer|family|subscription|paywall|price|reminder|notification|screen|button|nav|navigation|message|copy|text)\b/i

const PLUMBING_VETO = /\b(mock|stub|fixture|lockfile|re-?generate|re-?gen\b|re-?anchor|typecheck|lint|env var|secret|test|tests|probe|harness)\b/i

const JARGON_VETO = /\b(refactor|mirror|mirrored|emit|event contract|derives? from the engine|pulled from the engine|schema|wiring|lockfile|migration|typecheck|composable|regex|worktree|cron|dedupe|null|endpoint|resolver|webhook|payload|column|table|index|sha|revert|rebase|lint|bundle|import|re-?export|probe|harness|mock|stub|env var|secret|token minting|grant|rls|policy|audit map|inventory|sweep|tranche|\bM\d+\b|§)\b/i

// ── translation ─────────────────────────────────────────────────────────────

// Strip the machinery a founder should never read: conventional-commit prefixes, commit shas,
// file paths, spec section refs, parenthetical work-item codes, trailing rationale after an
// em dash (the claim is what precedes it).
function claimOf(subject) {
  let s = subject
    .replace(/^[a-z]+(\([^)]*\))?:\s*/i, '')
    .split(/\s+[—–]\s+/)[0]
    .replace(/\([^)]*\b[0-9a-f]{7,40}\b[^)]*\)/g, '')
    .replace(/\b[0-9a-f]{7,40}\b/g, '')
    .replace(/\([^)]*\bM\d+[^)]*\)/g, '')
    .replace(/\b[A-Z][A-Z-]+\.md\b|\b[\w/.-]+\.(md|ts|mjs|vue|sql|json)\b/g, '')
    .replace(/§[\d.–-]+/g, '')
    .replace(/`/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s,:;(]+$/, '')
    .trim()
  if (s) s = s[0].toUpperCase() + s.slice(1)
  return s
}

function translate(commit) {
  const s = commit.subject
  if (KIND_VETO.test(s)) return { drop: 'internal kind (docs/tests/chore/refactor)' }
  if (NOT_LIVE_VETO.test(s)) return { drop: 'shipped but not switched on for users' }

  // A polished phrasebook line applied to a test-mock or note-tidying commit is exactly the
  // over-claim these notes may not make — a family offline-lease TEST MOCK really did match the
  // "offline downloads" entry. So the phrasebook is gated by a narrow PLUMBING veto first. It is
  // narrower than the generic path's jargon veto on purpose: a real user-facing fix often
  // describes its mechanism in the subject ("play-state is PULLED from the engine — kills the
  // recurring play-button desync"), and the phrasebook exists precisely to translate those.
  if (PLUMBING_VETO.test(s)) return { drop: 'plumbing commit (tests, mocks, notes, lockfiles)' }

  for (const [surfaceRe, qualifierRe, headline, kind, significance, area, audience] of PHRASEBOOK) {
    if (surfaceRe.test(s) && qualifierRe.test(s)) {
      return { headline, kind, significance, area, audience: audience || 'general', source: 'phrasebook' }
    }
  }

  const claim = claimOf(s)
  if (!claim || claim.length < 12) return { drop: 'nothing left after stripping jargon' }
  if (!USER_FACING.test(claim)) return { drop: 'names nothing a user can see' }
  if (JARGON_VETO.test(claim)) return { drop: 'internal machinery in the claim' }
  return {
    headline: (claim.length > 130 ? claim.slice(0, 129).replace(/[\s,]+$/, '') + '…' : claim) +
      (/[.!?]$/.test(claim) ? '' : '.'),
    // Corrective language in the subject is the only fix/feature signal a generic commit gives.
    kind: FIX_SHAPE.test(s) ? 'fix' : 'feature',
    // Significance 1: we could not translate this confidently, so it must never outrank a curated
    // surface for one of the three feature slots. It still shows up in the catch-all section in full.
    significance: 1,
    // Unclassified audience: neither player nor schools vocabulary confidently established, so it
    // gets the middle weight rather than a guess in either direction.
    audience: 'general',
    source: 'generic',
  }
}

// A commit is corrective if it says so. `fix:` prefix, or the verbs this repo actually uses when
// something was broken.
const FIX_SHAPE = /^fix[:(]|\b(fix|fixes|fixed|fixing|kills?|killed|no longer|never again|stops?|repair|broken|desync|regression|stall|wedged|dead)\b/i

// Rounds land as several commits; a phrasebook entry matched by three of them is one headline.
// For generic bullets, collapse on significant-token overlap so near-duplicate subjects from the
// same round do not each get a line.
const tokens = (h) => new Set(
  h.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3))

function dedupe(bullets) {
  const kept = []
  for (const b of bullets) {
    const t = tokens(b.headline)
    const twin = kept.find((k) => {
      if (k.headline === b.headline) return true
      const kt = tokens(k.headline)
      const shared = [...t].filter((w) => kt.has(w)).length
      return shared / Math.max(1, Math.min(t.size, kt.size)) >= 0.7
    })
    if (twin) { twin.commits += b.commits; continue }
    kept.push({ ...b })
  }
  return kept
}

// FOUNDER RULING (2026-07-30), supersedes "a handful of bullets": include UP TO 3 most
// significant features FOR THE USERS, plus the bug fixes. So the shape is fixed — three feature
// slots and a fixes list — and the only real question is what "most significant" means.
//
// It is NOT commit count. Significance is a per-SURFACE judgement, so it lives as a weight on the
// phrasebook entry (3 = a user would notice and care, 1 = cosmetic) where it is made once and
// reused every week. Generic bullets — the ones we could not translate confidently — always weigh
// 1, so an unclear commit can never take a feature slot from a known surface. Features that miss
// the cut are listed in the draft's coverage section, never silently binned.
const MAX_FEATURES = 3
const MAX_FIXES = 12

export function buildNotes(cand) {
  const cond = condense(cand.commits)
  const bullets = [], dropped = []
  for (const c of cond.substantive) {
    const r = translate(c)
    if (r.drop) { dropped.push({ ...c, why: r.drop }); continue }
    bullets.push({
      headline: r.headline, source: r.source, kind: r.kind,
      significance: r.significance, area: r.area || areaOf(c.subject),
      audience: r.audience || 'general', commits: 1, subject: c.subject,
    })
  }
  // Phrasebook wording beats generic wording when both describe the same round, so it dedupes
  // first — the survivor keeps the curated kind, significance, audience and wording.
  const ranked = [...bullets].sort((a, b) =>
    (a.source === 'phrasebook' ? 0 : 1) - (b.source === 'phrasebook' ? 0 : 1))
  const unique = dedupe(ranked)

  // Founder ruling 2026-07-31: player/learner-facing items outrank schools/teacher/leader items
  // for the 3 headline feature slots. Rank on significance × audience weight first, commit count
  // only breaks remaining ties.
  const featureRank = (b) => b.significance * AUDIENCE_WEIGHT[b.audience || 'general']
  const byFeatureRank = (a, b) => featureRank(b) - featureRank(a) || b.commits - a.commits
  const bySignificance = (a, b) => b.significance - a.significance || b.commits - a.commits
  const allFeatures = unique.filter((b) => b.kind === 'feature').sort(byFeatureRank)
  const allFixes = unique.filter((b) => b.kind === 'fix').sort(bySignificance)
  return {
    features: allFeatures.slice(0, MAX_FEATURES),
    fixes: allFixes.slice(0, MAX_FIXES),
    // Founder ruling 2026-07-31: overflow features join the fixes in ONE catch-all section rather
    // than being draft-only coverage — nothing shipped goes unannounced, just compact below the
    // fold. Overflow features first (still "stuff"), then fixes.
    overflow: [...allFeatures.slice(MAX_FEATURES), ...allFixes.slice(MAX_FIXES)],
    otherStuff: [...allFeatures.slice(MAX_FEATURES), ...allFixes],
    bullets: unique, dropped, cond,
  }
}

// ── render ──────────────────────────────────────────────────────────────────

function header({ final, draftDate, shipDate, sha, count }) {
  const L = [HEADER_OPEN]
  if (final) {
    L.push(`# Release notes — shipped ${shipDate}`)
    L.push('')
    L.push(`Live on [saysomethingin.app](https://saysomethingin.app) since ${shipDate}. ` +
      `${count} commits, promoted from \`staging\` at \`${sha.slice(0, 7)}\`.`)
  } else {
    L.push(`# Release notes — DRAFT for the next ship`)
    L.push('')
    L.push(`Drafted ${draftDate} alongside [the candidate report](./../reports/${draftDate}.md) — ` +
      `${count} commits, candidate head \`${sha.slice(0, 7)}\`. **Edit these bullets freely**; ` +
      'Friday\'s promote stamps the header and leaves the text alone.')
  }
  L.push('')
  L.push('Up to three headline features — player/learner-facing surfaces weighted first — then one')
  L.push('catch-all section for everything else that shipped. Deliberately under-claiming: a commit')
  L.push('that cannot be translated confidently into user-facing language is dropped rather than')
  L.push('guessed at. Generated by `tools/release-train/release-notes.mjs`.')
  L.push(HEADER_CLOSE)
  return L.join('\n')
}

export function render(cand, notes, { draftDate }) {
  const L = [header({
    final: false, draftDate, sha: cand.stagingSha, count: cand.commits.length,
  }), '']

  if (!notes.features.length && !notes.fixes.length) {
    L.push('## What\'s new')
    L.push('')
    L.push('Nothing in this candidate translated confidently into a user-facing headline —')
    L.push('it reads as an internal-only week. Write a bullet by hand if that is wrong.')
    L.push('')
  }
  if (notes.features.length) {
    L.push('## What\'s new')
    L.push('')
    for (const b of notes.features) L.push(`- ${b.headline}`)
    L.push('')
  }
  // Founder ruling 2026-07-31: one catch-all section absorbs the overflow features (bumped from
  // the 3 headline slots — still under-claimed, same phrasebook wording) AND the bug fixes. Ships
  // compact, below the fold, rather than silently dropped or buried in draft-only coverage.
  if (notes.otherStuff.length) {
    L.push('## Other stuff and bug fixes')
    L.push('')
    for (const b of notes.otherStuff) L.push(`- ${b.headline}`)
    L.push('')
  }

  L.push(DRAFT_OPEN)
  L.push('## Draft-only: coverage')
  L.push('')
  L.push(`${notes.features.length} feature headline(s) + ${notes.otherStuff.length} other-stuff ` +
    `line(s) from ${notes.cond.substantive.length} substantive commits ` +
    `(${notes.cond.process_.length} process commits never considered).`)
  L.push('This section is stripped when the notes are finalised.')
  L.push('')
  const byWhy = new Map()
  for (const d of notes.dropped) {
    if (!byWhy.has(d.why)) byWhy.set(d.why, [])
    byWhy.get(d.why).push(d.subject)
  }
  for (const [why, subs] of [...byWhy.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`**Dropped — ${why} (${subs.length}):**`)
    for (const sub of subs.slice(0, 8)) L.push(`- ${sub.length > 120 ? sub.slice(0, 119) + '…' : sub}`)
    if (subs.length > 8) L.push(`- …and ${subs.length - 8} more`)
    L.push('')
  }
  L.push(DRAFT_CLOSE)
  L.push('')
  return L.join('\n')
}

// ── finalize ────────────────────────────────────────────────────────────────
// FOUNDER RULING 2026-07-31, "accuracy over elegance": the final notes are REGENERATED from the
// commits actually being promoted, not merely stamped from Thursday's draft. Thursday's draft is
// a question asked a day early — staging keeps moving after it, so a stamped draft can describe a
// ship that never happened and miss one that did. The promoted diff is the source of truth.
//
// Tom's hand-edited bullets still survive: a draft bullet the machine did not produce for the
// promoted range is, by definition, one a human wrote, and it is carried into the final notes
// after the machine's own. (A bullet the machine DID produce but budget-cut is recognised as
// machine output and drops, so the founder's three-feature cap still holds.)

/** Pull the `- ` bullets out of one `## ` section of a rendered notes body. */
export function bulletsUnder(body, heading) {
  const lines = (body || '').split('\n')
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase())
  if (start === -1) return []
  const out = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    const m = /^\s*-\s+(.*\S)\s*$/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

/**
 * Did a HUMAN touch this notes file, or only the machine? Every machine commit to a notes file is
 * prefixed `release-train:` (both the drafting run and the finalising one), so anything else in
 * the file's history is Tom editing bullets.
 *
 * This is the exact answer to "which bullets are hand-written", and it makes the common case
 * clean: an untouched draft is discarded wholesale in favour of the promoted range, so a REWORDED
 * phrasebook line replaces its predecessor instead of shipping alongside it.
 */
export function draftWasHandEdited(relPath) {
  try {
    const subjects = sh('git', ['log', '--format=%s', 'origin/dev', '--', relPath])
    if (!subjects) return false
    return subjects.split('\n').some((s) => !/^release[- ]train:/i.test(s.trim()))
  } catch {
    return true // can't tell → assume a human did, and keep their words
  }
}

/**
 * Machine bullets for the promoted range, plus any bullet in the draft the machine never wrote.
 * Returns plain headline strings, features and fixes kept apart.
 */
export function reconcile(draftBody, notes) {
  const machineVocabulary = (notes.bullets || []).map((b) => b.headline)
  // Exact match is not enough: when a phrasebook line is REWORDED (the 2026-07-31 pass corrected
  // "near-instant" to something the change actually delivered), the draft's old wording would
  // otherwise read as hand-written and both would ship. Same near-twin test the bullet dedupe
  // already uses, so a reworded line replaces its predecessor instead of doubling it.
  const isMachine = (h) => machineVocabulary.some((m) => {
    if (m === h) return true
    const a = tokens(m), b = tokens(h)
    const shared = [...b].filter((w) => a.has(w)).length
    return shared / Math.max(1, Math.min(a.size, b.size)) >= 0.7
  })
  const handOnly = (heading) =>
    bulletsUnder(draftBody, heading).filter((h) => !isMachine(h))
  const merge = (machine, hand) => [...new Set([...machine.map((b) => b.headline), ...hand])]
  // The draft (pre-2026-07-31 shape) may still carry a "## Fixes" heading rather than "## Other
  // stuff and bug fixes" — read both so an old draft's hand edits are not silently dropped.
  const otherHand = [...handOnly('Other stuff and bug fixes'), ...handOnly('Fixes')]
  return {
    features: merge(notes.features, handOnly("What's new")),
    fixes: merge(notes.otherStuff, otherHand),
    handEdits: [...handOnly("What's new"), ...otherHand],
  }
}

/** Render the finalised file from reconciled bullets — no draft-only block, ever. */
export function renderFinal({ features, fixes }, { shipDate, sha, count }) {
  const L = [header({ final: true, shipDate, sha, count }), '']
  if (features.length) {
    L.push('## What\'s new', '')
    for (const h of features) L.push(`- ${h}`)
    L.push('')
  }
  // Founder ruling 2026-07-31: overflow features and fixes ship together, one catch-all section,
  // so nothing shipped goes unannounced — just compact below the fold.
  if (fixes.length) {
    L.push('## Other stuff and bug fixes', '')
    for (const h of fixes) L.push(`- ${h}`)
    L.push('')
  }
  if (!features.length && !fixes.length) {
    L.push('## What\'s new', '')
    L.push('Nothing in this ship translated confidently into a user-facing headline.', '')
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'
}

// Legacy stamp-only path — kept for the case where the promoted range cannot be determined
// (a hand-run finalize with no merge commit to read). Replaces the header block, strips the
// draft-only block, keeps the body verbatim.

export function finalizeBody(body, { shipDate, sha, count }) {
  const h = header({ final: true, shipDate, sha, count })
  let out = body
  const hi = out.indexOf(HEADER_OPEN), hj = out.indexOf(HEADER_CLOSE)
  out = (hi >= 0 && hj > hi)
    ? out.slice(0, hi) + h + out.slice(hj + HEADER_CLOSE.length)
    : h + '\n\n' + out
  const di = out.indexOf(DRAFT_OPEN), dj = out.indexOf(DRAFT_CLOSE)
  if (di >= 0 && dj > di) out = out.slice(0, di).replace(/\s+$/, '\n') + out.slice(dj + DRAFT_CLOSE.length)
  return out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'
}

// ── main ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry-run')
const NO_PUSH = DRY || argv.includes('--no-push')
const FINALIZE = argv.includes('--finalize')
const argOf = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

function today() { return new Date().toISOString().slice(0, 10) }

// Which draft does today's ship belong to? The newest notes file at or before today — the
// Thursday draft for a Friday ship, without needing the two dates to match.
function latestDraftOnDev(upto) {
  let names
  try {
    names = sh('git', ['ls-tree', '--name-only', 'origin/dev', 'tools/release-train/notes/'])
      .split('\n').filter(Boolean).map((p) => p.split('/').pop().replace('.md', '')).sort()
  } catch { return null }
  const candidates = names.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= upto)
  return candidates.length ? candidates[candidates.length - 1] : null
}

/**
 * The range that was actually promoted. promote.sh passes it explicitly (it knows main's sha
 * before the merge); a hand-run finalize reads it off the promote merge commit at main's tip —
 * first parent = main before the ship, second parent = the staging sha that was merged in.
 */
function promotedRange() {
  const base = argOf('--base'), head = argOf('--head')
  if (base && head) return { base, head }
  try {
    const parents = sh('git', ['rev-list', '--parents', '-n', '1', 'origin/main']).split(/\s+/)
    if (parents.length === 3) return { base: parents[1], head: parents[2] }
  } catch { /* fall through — stamp-only */ }
  return null
}

async function main() {
  if (FINALIZE) {
    // At finalize time staging is already merged into main, so `origin/main..origin/staging` is
    // empty. The notes are regenerated from the range that was actually promoted (founder ruling
    // 2026-07-31), with the sha and count from the caller — promote.sh knows both.
    const range = promotedRange()
    const cand = range
      ? candidate(range)
      : { commits: [], stagingSha: sh('git', ['rev-parse', 'origin/staging']) }
    const sha = argOf('--sha') || (range ? cand.head : cand.stagingSha)
    const count = Number(argOf('--count') || 0) || cand.commits.length || undefined
    const shipDate = argOf('--date') || today()
    const draftDate = argOf('--draft') || latestDraftOnDev(shipDate) || shipDate
    const rel = NOTES_REL(draftDate)
    let body = readOnDev(rel)
    if (!body && existsSync(join(NOTES_DIR, `${draftDate}.md`))) {
      body = readFileSync(join(NOTES_DIR, `${draftDate}.md`), 'utf8')
    }
    let final
    if (range && cand.commits.length) {
      const notes = buildNotes(cand)
      const handEdited = draftWasHandEdited(rel)
      if (!handEdited) log('finalize: draft is machine-only — regenerating it wholesale')
      const bullets = reconcile(handEdited ? body : '', notes)
      if (bullets.handEdits.length) {
        log(`finalize: ${bullets.handEdits.length} hand-edited bullet(s) carried through`)
      }
      log(`finalize: regenerated from the promoted range ` +
        `${cand.base.slice(0, 7)}..${cand.head.slice(0, 7)} (${cand.commits.length} commits)`)
      final = renderFinal(bullets, { shipDate, sha, count })
    } else {
      // No determinable promoted range: stamp the draft rather than ship no notes at all.
      log('finalize: promoted range unavailable — stamping the draft as-is')
      if (!body) return log('no draft notes and no promoted range — nothing to finalise'), 0
      final = finalizeBody(body, { shipDate, sha, count })
    }
    if (DRY) { process.stdout.write(final); return 0 }
    mkdirSync(NOTES_DIR, { recursive: true })
    writeFileSync(join(NOTES_DIR, `${draftDate}.md`), final)
    if (!NO_PUSH) {
      publish([{ relPath: rel, body: final }],
        `release-train: release notes final — shipped ${shipDate} (${sha.slice(0, 7)})`)
    }
    log(`release notes finalised: ${rel} (ship ${shipDate}, ${sha.slice(0, 7)})`)
    console.log(`Release notes: https://github.com/${GH_REPO}/blob/dev/${rel}`)
    return 0
  }

  // Thursday's draft: the open candidate, origin/main..origin/staging.
  const cand = candidate()
  if (!cand.commits.length) { log('no candidate — no notes'); return 0 }
  const draftDate = argOf('--date') || today()
  const notes = buildNotes(cand)
  const body = render(cand, notes, { draftDate })
  if (DRY) { process.stdout.write(body); return 0 }
  mkdirSync(NOTES_DIR, { recursive: true })
  writeFileSync(join(NOTES_DIR, `${draftDate}.md`), body)
  if (!NO_PUSH) {
    publish([{ relPath: NOTES_REL(draftDate), body }],
      `release-train: draft release notes ${draftDate}`)
  }
  log(`draft release notes: ${notes.features.length} features + ${notes.fixes.length} fixes, ` +
    `${notes.overflow.length} over budget, ${notes.dropped.length} dropped`)
  return 0
}

// Only run as a CLI; the Thursday report imports buildNotes/render instead of shelling out.
if (process.argv[1] && process.argv[1].endsWith('release-notes.mjs')) {
  main().then((c) => process.exit(c)).catch((e) => {
    log(`FATAL release-notes: ${e.stack || e}`)
    process.exit(1)
  })
}
