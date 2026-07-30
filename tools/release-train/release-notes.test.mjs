/**
 * Release-notes gate tests — `node --test tools/release-train/` (no config, no deps).
 *
 * These lock the ONE property the notes must never lose: they under-claim. Every case below is a
 * real commit subject from the 2026-07-30 candidate, so the fixtures stay honest.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNotes, finalizeBody } from './release-notes.mjs'

const commit = (subject) => ({ subject, sha: 'a'.repeat(40), date: '2026-07-30', author: 'x' })
const notesFor = (subjects) => buildNotes({
  commits: subjects.map(commit), stagingSha: 'c'.repeat(40), mainSha: 'b'.repeat(40),
  devAhead: 0, lastPromote: null,
})
const headlines = (subjects) => notesFor(subjects).areas.flatMap((a) => a.list.map((b) => b.headline))

test('a user-facing round earns a headline in user-facing language', () => {
  const h = headlines(['course-switch READY in 2-3s: kill the cinematic floor on switches'])
  assert.equal(h.length, 1)
  assert.match(h[0], /instant/i)
  assert.doesNotMatch(h[0], /cinematic floor|READY in/i)
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
  assert.deepEqual(n.areas, [])
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
  assert.deepEqual(n.areas, [])
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

test('the bullet budget holds and areas stay balanced', () => {
  const n = notesFor(Array.from({ length: 40 }, (_, i) =>
    `fix(player): the session screen shows the round number correctly, case ${i}`))
  const total = n.areas.reduce((s, a) => s + a.list.length, 0)
  assert.ok(total <= 10, `${total} bullets`)
  for (const a of n.areas) assert.ok(a.list.length <= 3, a.name)
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
