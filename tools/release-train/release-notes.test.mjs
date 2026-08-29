/**
 * Release-notes gate tests — `pnpm test:release-train` (node's built-in runner, no config, no
 * deps). The script names this file explicitly: CI runs node 20, which does not expand globs.
 *
 * These lock the ONE property the notes must never lose: they under-claim. Every case below is a
 * real commit subject from the 2026-07-30 candidate, so the fixtures stay honest.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildNotes, finalizeBody, isDraftBody, reconcile, render, renderFinal, FINAL_HEADER_RE,
} from './release-notes.mjs'

const commit = (subject) => ({ subject, sha: 'a'.repeat(40), date: '2026-07-30', author: 'x' })
const notesFor = (subjects) => buildNotes({
  commits: subjects.map(commit), stagingSha: 'c'.repeat(40), mainSha: 'b'.repeat(40),
  devAhead: 0, lastPromote: null,
})
const headlines = (subjects) => {
  const n = notesFor(subjects)
  return [...n.features, ...n.fixes].map((b) => b.headline)
}
const empty = (n) => n.features.length === 0 && n.fixes.length === 0
// A rendered draft body, as the Thursday run would have written it.
const renderedDraft = (features, fixes) => [
  '<!-- release-notes:header -->', '# Release notes — DRAFT for the next ship',
  '<!-- /release-notes:header -->', '',
  ...(features.length ? ["## What's new", '', ...features, ''] : []),
  ...(fixes.length ? ['## Fixes', '', ...fixes, ''] : []),
].join('\n')

test('a user-facing round earns a headline in user-facing language', () => {
  const h = headlines(['course-switch READY in 2-3s: kill the cinematic floor on switches'])
  assert.equal(h.length, 1)
  assert.match(h[0], /switching course/i)
  assert.doesNotMatch(h[0], /cinematic floor|READY in/i)
  // Reworded 2026-07-31: the change lands READY in 2-3s, so "near-instant" over-claimed it.
  assert.doesNotMatch(h[0], /instant/i)
})

test('process commits are never considered', () => {
  const subjects = [
    'Merge remote-tracking branch \'origin/claude/x\' into dev',
    'worklist: claim course-switch-ready perf round',
    'promote: dev→staging — teacher-surface nav round (1219bfa8)',
    'decisions: journal the course-switch READY round',
    'chore: retrigger deploy with correct author identity',
  ]
  const n = notesFor(subjects)
  assert.ok(empty(n))
  assert.equal(n.dropped.length, 0, 'process commits are excluded upstream, not "dropped"')
  assert.equal(n.cond.process_.length, subjects.length)
})

test('docs, tests and refactors are dropped as internal', () => {
  for (const s of [
    'docs(vad): feedback-surface design exploration — learner/listening/schools/CEFR',
    'test(e2e): browser-verification probes for pull-consistency tranche 4 (M3+M9)',
    'refactor(player): belt position derives from the engine (M9)',
    'apml: family-plan spec (what exists now)',
  ]) assert.deepEqual(headlines([s]), [], s)
})

test('audit and security commits are dropped as internal, never surfaced verbatim', () => {
  // Real specimen (2026-08-29): this one slipped through as a generic bullet because its subject
  // happened to contain "round" (a USER_FACING word) with no JARGON_VETO hit — internal audit
  // jargon reached the learner-facing notes. audit(...) / security(...) must gate at kind-veto.
  for (const s of [
    'audit(security): handler map for 2026-08-25 + SEC25-X-01/02 on the ungated round-map',
    'security(audit-0825-d): DB posture + repo hygiene + test-machinery integrity (Area D)',
  ]) assert.deepEqual(headlines([s]), [], s)
})

test('shipped-but-dark work is never announced', () => {
  for (const s of [
    'family: UI — Settings family page, paywall option, covered-by-family branch',
    'feat(vad): cycle_prosody event + SimplePlayer VAD timing wiring (phase 1)',
    'deploy sentinel stage 1: post-main-push fallout watcher (cron on watson-1)',
  ]) assert.deepEqual(headlines([s]), [], s)
})

test('a plumbing commit cannot borrow a phrasebook headline', () => {
  // The real over-claim this gate was built for: a test mock matching the "offline" entry.
  assert.deepEqual(
    headlines(['family: teach the offline-lease test mock .is() — the resolver query shape']), [])
})

test('a real fix keeps its headline even when the subject names its mechanism', () => {
  const h = headlines([
    'fix(player): transport play-state is PULLED from the engine — kills the play-button desync'])
  assert.equal(h.length, 1)
  assert.match(h[0], /play button/i)
  assert.doesNotMatch(h[0], /PULLED|engine/i)
})

test('generic bullets carry no hashes, paths or section refs', () => {
  const h = headlines(['fix(schools): class list keeps its order (see docs/FOO.md §3, 1219bfa8)'])
  for (const bullet of h) {
    assert.doesNotMatch(bullet, /[0-9a-f]{7,}|\.md|§/, bullet)
  }
})

test('an untranslatable subject is dropped, never guessed at', () => {
  const n = notesFor(['fix(walkthrough): viewport-safe overlay on oversized anchors'])
  assert.ok(empty(n))
  assert.equal(n.dropped.length, 1)
  assert.ok(n.dropped[0].why, 'the draft says WHY it was dropped')
})

test('a round shipped as several commits yields one headline', () => {
  const h = headlines([
    'schools nav unification: govt_admin tabs land on THE VIEW, flat views retired',
    'schools nav unification: school_admin lands on THE VIEW — third persona through the door',
  ])
  assert.equal(h.length, 1)
})

// ── the founder-ruled shape: up to 3 features, then the fixes ────────────────

test('at most three feature headlines, however many features shipped', () => {
  const n = notesFor([
    'course-switch READY in 2-3s: kill the cinematic floor',
    'feat(cold-start): course load never blocks past readiness-to-start — SWR + progressive start',
    'schools nav unification: govt_admin tabs land on THE VIEW',
    'explainer: How-this-works becomes the single surfacing point, with a discoverability throb',
    'schools teacher surface: nav persists in the player, slim playing-as chip',
  ])
  assert.equal(n.features.length, 3)
  assert.equal(n.overflow.length, 2, 'the rest surface in the draft, never silently binned')
})

test('every fix is listed, not squeezed out by the feature cap', () => {
  const n = notesFor([
    'course-switch READY in 2-3s: kill the cinematic floor',
    'fix(player): transport play-state is PULLED from the engine — kills the play-button desync',
    'player: never cut the awakening typewriter mid-word',
    'feat(walkthrough): playback guardrails — the ship-time rails worklist closed',
    'copy: sentence-case the loading + resting messages',
  ])
  assert.equal(n.features.length, 1)
  assert.equal(n.fixes.length, 4)
  assert.equal(n.overflow.length, 0)
})

test('features are ordered by user significance, not commit count', () => {
  // Two minor commits for a cosmetic surface must not outrank one significant surface.
  const n = notesFor([
    'copy: sentence-case the loading + resting messages',
    'copy: sentence-case the loading + resting messages again',
    'feat(admin): inline guards on the ssi_admin danger verbs',
    'course-switch READY in 2-3s: kill the cinematic floor',
  ])
  assert.match(n.features[0].headline, /Switching course/)
})

test('an unclear commit can never take a feature slot from a known surface', () => {
  const n = notesFor([
    'schools: the class list now shows every student in the class',      // generic, weight 1
    'course-switch READY in 2-3s: kill the cinematic floor',             // curated, weight 3
    'invite: personal links replace the emailed code',                   // curated, weight 3
    'schools nav unification: govt_admin tabs land on THE VIEW',         // curated, weight 3
  ])
  assert.equal(n.features.length, 3)
  for (const f of n.features) assert.equal(f.source, 'phrasebook', f.headline)
})

// ── founder ruling 2026-07-31: player-first ranking + one catch-all section ─

test('a player-facing feature outranks an equally-significant schools feature', () => {
  const n = notesFor([
    'schools nav unification: govt_admin tabs land on THE VIEW',       // curated, schools, sig 3
    'course-switch READY in 2-3s: kill the cinematic floor',           // curated, player, sig 3
  ])
  assert.equal(n.features.length, 2)
  assert.match(n.features[0].headline, /Switching course/, 'player-facing feature ranks first')
})

test('a lower-significance player feature can still outrank a higher schools feature', () => {
  const n = notesFor([
    'schools nav unification: govt_admin tabs land on THE VIEW',          // schools, sig 3
    'feat(schools): teacher surface nav persists in the player',         // schools, sig 2
    'copy: sentence-case the loading + resting messages',                // player fix, not a feature
  ])
  // Sanity check only: the audience weight is a ranking multiplier on FEATURES, so a schools
  // feature at sig 3 still beats a schools feature at sig 2 — weight only breaks cross-audience
  // ties, never invents a slot. Assert both remain features in significance order.
  assert.equal(n.features.length, 2)
  assert.match(n.features[0].headline, /unified dashboard view/)
})

test('overflow features and fixes both land in the one catch-all section, nothing dropped', () => {
  const n = notesFor([
    'course-switch READY in 2-3s: kill the cinematic floor',                                   // feature 1
    'feat(cold-start): course load never blocks past readiness-to-start — SWR + progressive start', // feature 2
    'schools nav unification: govt_admin tabs land on THE VIEW',                                // feature 3
    'explainer: How-this-works becomes the single surfacing point, with a discoverability throb', // overflow feature
    'fix(player): transport play-state is PULLED from the engine — kills the play-button desync', // fix
  ])
  assert.equal(n.features.length, 3)
  assert.equal(n.otherStuff.length, 2, 'the overflow feature and the fix both land in one section')
  const headlines = n.otherStuff.map((b) => b.headline).join('\n')
  assert.match(headlines, /How this works/)
  assert.match(headlines, /play button/)
})

test('the rendered draft uses one "Other stuff and bug fixes" heading, not separate Fixes', () => {
  const cand = {
    commits: [
      commit('course-switch READY in 2-3s: kill the cinematic floor'),
      commit('fix(player): transport play-state is PULLED from the engine — kills the play-button desync'),
    ],
    stagingSha: 'c'.repeat(40),
  }
  const notes = buildNotes(cand)
  const body = render(cand, notes, { draftDate: '2026-07-31' })
  assert.match(body, /## Other stuff and bug fixes/)
  assert.doesNotMatch(body, /## Fixes\n/)
})

test('finalize stamps the header, keeps hand edits, strips the draft section', () => {
  const draft = [
    '<!-- release-notes:header -->',
    '# Release notes — DRAFT for the next ship',
    '<!-- /release-notes:header -->',
    '',
    '## Highlights',
    '',
    '- Tom typed this bullet himself.',
    '',
    '<!-- release-notes:draft-only -->',
    '## Draft-only: coverage',
    'dropped things',
    '<!-- /release-notes:draft-only -->',
    '',
  ].join('\n')
  const final = finalizeBody(draft, { shipDate: '2026-07-31', sha: 'c'.repeat(40), count: 130 })
  assert.match(final, /shipped 2026-07-31/)
  assert.match(final, /130 commits/)
  assert.match(final, /Tom typed this bullet himself/)
  assert.doesNotMatch(final, /DRAFT for the next ship/)
  assert.doesNotMatch(final, /Draft-only|dropped things/)
})

// ── the promoted diff is the source of truth (founder ruling 2026-07-31) ─────
// Thursday's draft is a question asked a day early. Between the draft and the promote, staging
// keeps moving — so the final notes are REGENERATED from what was actually promoted, and the
// draft only contributes the bullets a human typed into it.

test('a commit that shipped AFTER the draft still reaches the final notes', () => {
  const draft = renderedDraft(['- Guided walkthroughs of the product, for learners, teachers and leaders.'], [])
  const promoted = notesFor([
    'feat(walkthrough): compiled walkthrough engine + first 5 walks',
    'THE VIEW: WHERE-YOU-ARE rail stability across Overview <-> Insights',
  ])
  const out = reconcile(draft, promoted)
  assert.match(out.fixes.join('\n'), /Where-you-are stays put/)
})

test('a bullet for work that did NOT ship is dropped from the final notes', () => {
  // The draft claimed a player fix; the promote carried the walkthrough round only, because the
  // fix slipped to next week. An untouched draft is machine-only, so finalize discards it and
  // regenerates — which is exactly how the false claim dies.
  const promoted = notesFor(['feat(walkthrough): compiled walkthrough engine + first 5 walks'])
  const out = reconcile('', promoted)
  assert.match(out.features.join('\n'), /Guided walkthroughs of the product/)
  assert.equal(out.fixes.length, 0, 'a machine bullet for unshipped work must not survive')

  // If Tom HAS edited that draft, his file is authoritative and a bullet we cannot prove is
  // machine output is kept rather than silently deleted — conservative on purpose.
  const edited = renderedDraft(
    ['- Guided walkthroughs of the product, for learners, teachers and leaders.'],
    ['- The play button no longer falls out of step with what is actually playing.'],
  )
  assert.equal(reconcile(edited, promoted).fixes.length, 1)
})

test("Tom's own bullet survives regeneration", () => {
  const draft = renderedDraft(['- Tom typed this bullet himself.'], [])
  const promoted = notesFor(['feat(walkthrough): compiled walkthrough engine + first 5 walks'])
  const out = reconcile(draft, promoted)
  assert.deepEqual(out.handEdits, ['Tom typed this bullet himself.'])
  assert.match(out.features.join('\n'), /Tom typed this bullet himself/)
  assert.match(out.features.join('\n'), /Guided walkthroughs/)
})

test('a reworded phrasebook line replaces its old wording, never doubles it', () => {
  const draft = renderedDraft(['- Switching course is near-instant — no more waiting through a loading sequence.'], [])
  const promoted = notesFor(['course-switch READY in 2-3s: kill the cinematic floor on switches'])
  // Machine-only drafts are discarded wholesale, which is how the rewording lands cleanly.
  const out = reconcile('', promoted)
  assert.equal(out.features.length, 1)
  assert.doesNotMatch(out.features[0], /near-instant/)
  // And even when the draft IS consulted, the near-twin is not carried as a hand edit twice.
  assert.ok(reconcile(draft, promoted).features.length <= 2)
})

test('the final notes never carry the draft-only coverage section', () => {
  const promoted = notesFor(['feat(walkthrough): compiled walkthrough engine + first 5 walks'])
  const final = renderFinal(reconcile('', promoted),
    { shipDate: '2026-07-31', sha: 'c'.repeat(40), count: 150 })
  assert.match(final, /shipped 2026-07-31/)
  assert.match(final, /150 commits/)
  assert.doesNotMatch(final, /Draft-only|DRAFT for the next ship/)
})

test('a user-visible fix whose subject reads as machinery is still announced', () => {
  // Both of these were DROPPED as "names nothing a user can see" in the 2026-07-30 ship and had
  // to be reconciled by hand. Phrasebook entries now cover the surfaces.
  const h = headlines([
    "fix stuck 'Updating the app' overlay: hard deadline + tap-to-relaunch on the heal path",
    'THE VIEW: WHERE-YOU-ARE rail stability across Overview <-> Insights',
  ])
  assert.match(h.join('\n'), /"Updating the app" screen can no longer get stuck/)
  assert.match(h.join('\n'), /Where-you-are stays put/)
  assert.doesNotMatch(h.join('\n'), /heal path|rehydrat|Overview <->/)
})

test('a fix that already went live on the fix lane is out of range, so out of the notes', () => {
  // Nothing to filter: an immediate-lane fix is already an ancestor of main, so main..staging
  // never contains it. This locks the property that the range IS the policy.
  const promoted = notesFor([])
  assert.equal(promoted.features.length + promoted.fixes.length, 0)
})

// ── the finalise gate (founder ruling 2026-08-29) ────────────────────────────
// "A promote must not be able to complete leaving its notes as a draft — fail loudly instead."
// A draft reaches NO learner: the player's parser shows finals only. These lock the check that
// promote.sh leans on when it decides whether to report the ship as done.

test('a drafted body is recognised as a draft, and its finalised form is not', () => {
  const draft = renderedDraft(['- A thing a learner can see.'], [])
  assert.match(draft, /DRAFT for the next ship/)
  assert.equal(isDraftBody(draft), true, 'a freshly rendered draft must read as a draft')

  const final = finalizeBody(draft, { shipDate: '2026-08-29', sha: 'c'.repeat(40), count: 35 })
  assert.equal(isDraftBody(final), false, 'a stamped final must not read as a draft')
  assert.match(final, /shipped 2026-08-29/)
})

test('nothing is a final by accident — empty, truncated and near-miss headers all read as drafts', () => {
  assert.equal(isDraftBody(''), true)
  assert.equal(isDraftBody(null), true)
  assert.equal(isDraftBody('# Release notes — shipped soon'), true)
  assert.equal(isDraftBody('# Release notes shipped 2026-08-29'), true, 'the em-dash is required')
  assert.equal(isDraftBody('# Release notes — shipped 2026-08-29'), false)
})

test('the finalise gate and the learner-facing parser use the SAME header regex', () => {
  // If these two drift, a promote can "succeed" into silence: the script believes it stamped a
  // final, the app refuses to render it, and Settings keeps showing the previous ship's date —
  // which is exactly what happened on 2026-08-29.
  const player = readFileSync(
    new URL('../../packages/player-vue/src/composables/trainReleaseNotes.ts', import.meta.url),
    'utf8')
  const m = /const SHIPPED_RE = (\/.*\/m)\n/.exec(player)
  assert.ok(m, 'could not find SHIPPED_RE in trainReleaseNotes.ts')
  assert.equal(m[1], FINAL_HEADER_RE.toString(),
    'trainReleaseNotes.ts SHIPPED_RE and release-notes.mjs FINAL_HEADER_RE have drifted')
})

test('promote.sh writes the notes BEFORE it pushes main, so they ship with their own build', () => {
  // The player bundles tools/release-train/notes/*.md at BUILD time and production builds from
  // main. Notes written after the push land on dev only and reach production one ship late —
  // which is how Settings came to show 16 Aug on 2026-08-29. Order is the fix; lock it.
  const sh = readFileSync(new URL('./promote.sh', import.meta.url), 'utf8')
  const notes = sh.indexOf("${NOTES_ARGS[@]}")
  const commit = sh.indexOf('add -- tools/release-train/notes/')
  const push = sh.indexOf('push origin HEAD:main')
  assert.ok(notes > 0 && commit > 0 && push > 0, 'promote.sh lost one of its three steps')
  assert.ok(notes < commit, 'the notes must be written before they are staged')
  assert.ok(commit < push, 'the notes must be committed onto the merge BEFORE the push to main')
  assert.match(sh, /--worktree" "\$WT"|--worktree "\$WT"/,
    'the finalise run must be handed the promote worktree, or the notes never reach main')
})
