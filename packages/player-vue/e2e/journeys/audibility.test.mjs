// THE PROVING TEST for the audible detector (2026-09-10).
//
// Seen failing on the pre-fix code and passing on the post-fix code: with the
// old currentTime-based instrument the browser controls below reported BOTH
// one second of zero PCM and a 95%-silent clip as "lesson audible".
//
// Run directly: node --test e2e/journeys/audibility.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { AUDIBILITY, rmsDbfs, peakDbfs, audibleVerdict } from './audibility.mjs'

const CFG = AUDIBILITY
const here = dirname(fileURLToPath(import.meta.url))

// ── the pure predicate ──────────────────────────────────────────────────────
test('digital silence measures as the reported floor, not as a small number', () => {
  const zeros = new Float32Array(2048)
  assert.equal(rmsDbfs(zeros, CFG.dbMin), CFG.dbMin)
  assert.equal(peakDbfs(zeros, CFG.dbMin), CFG.dbMin)
})

test('a full-scale tone measures near 0 dBFS peak', () => {
  const tone = Float32Array.from({ length: 2048 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 44100))
  assert.ok(peakDbfs(tone, CFG.dbMin) > -1, 'peak should be within 1 dB of full scale')
  assert.ok(rmsDbfs(tone, CFG.dbMin) > -4, 'sine RMS is about -3 dBFS')
  assert.ok(rmsDbfs(tone, CFG.dbMin) > CFG.floorDbfs)
})

test('a signal at the floor is not counted as heard', () => {
  const quiet = Float32Array.from({ length: 2048 }, (_, i) => 0.002 * Math.sin(i))
  assert.ok(rmsDbfs(quiet, CFG.dbMin) < CFG.floorDbfs, 'below -45 dBFS is noise floor, not a word')
})

test('energy at a single instant is refused: one click in a silent clip', () => {
  // 100ms above the floor inside 2000ms of playback = 5%.
  assert.equal(audibleVerdict({ aboveFloorMs: 100, elapsedMs: 2000 }, CFG).audible, false)
})

test('the first two ticks of a clip cannot claim 100%', () => {
  assert.equal(audibleVerdict({ aboveFloorMs: 40, elapsedMs: 40 }, CFG).audible, false)
})

test('continuous speech is heard', () => {
  assert.equal(audibleVerdict({ aboveFloorMs: 240, elapsedMs: 300 }, CFG).audible, true)
})

test('natural leading silence does not fail a real clip', () => {
  // 400ms of room tone, then 200ms of speech: 33% above floor.
  assert.equal(audibleVerdict({ aboveFloorMs: 200, elapsedMs: 600 }, CFG).audible, true)
})

test('nothing played at all is not audible', () => {
  assert.equal(audibleVerdict({ aboveFloorMs: 0, elapsedMs: 0 }, CFG).audible, false)
})

// ── the browser controls ────────────────────────────────────────────────────
// Slow (three headless page loads) but it is the only thing that proves the
// instrument as it is actually serialised into a page.
test('browser controls: silence refused, click-at-end refused, real clip heard', { timeout: 180000 }, () => {
  const r = spawnSync('node', [join(here, '..', 'release-audible-control.mjs')], {
    encoding: 'utf8', timeout: 170000,
    env: { ...process.env, CS_SCRATCH: process.env.CS_SCRATCH || process.env.TMPDIR || '/tmp' },
  })
  assert.equal(r.status, 0, `controls did not all pass:\n${r.stdout}\n${r.stderr}`)
})
