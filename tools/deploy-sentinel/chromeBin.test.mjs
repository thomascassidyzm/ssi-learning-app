/**
 * chromeBin tests — `pnpm test:deploy-sentinel` (node's built-in runner, no deps).
 *
 * The real incident this guards (2026-09-11 13:12): the play probe reported
 * "no headless browser on this machine" because the sentinel named three
 * chromium build numbers and the installed one was a fourth. Proves the OLD
 * lookup misses the machine's real cache listing and the NEW one finds it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { chromeCandidates, findChrome } from './chromeBin.mjs'

const PW = '/home/x/.cache/ms-playwright'
// watson-1's actual listing on 2026-09-11, the morning the alarm fired.
const listing = ['.links', 'chromium-1243', 'chromium_headless_shell-1228', 'chromium_headless_shell-1243', 'ffmpeg-1011']
const installed = new Set([join(PW, 'chromium-1243/chrome-linux64/chrome')])
const exists = (p) => installed.has(p)

// The old, defective lookup — kept here only so the fix can be proven against it.
function oldFindChrome() {
  return ['chromium-1234', 'chromium-1228', 'chromium-1208']
    .map((d) => join(PW, d, 'chrome-linux64/chrome'))
    .find(exists)
}

test('OLD lookup: the installed chromium-1243 is not found, so the probe is switched off', () => {
  assert.equal(oldFindChrome(), undefined)
})

test('NEW lookup: finds chromium-1243 from the real cache listing', () => {
  assert.equal(findChrome(PW, { list: () => listing, exists }), join(PW, 'chromium-1243/chrome-linux64/chrome'))
})

test('candidates are newest build first and ignore headless-shell and ffmpeg dirs', () => {
  const c = chromeCandidates(PW, () => ['chromium-1208', 'ffmpeg-1011', 'chromium-1243', 'chromium_headless_shell-1243', 'chromium-1234'])
  assert.deepEqual(c.map((p) => p.split('/')[5]), ['chromium-1243', 'chromium-1234', 'chromium-1208'])
})

test('no cache dir at all: undefined, never a throw', () => {
  assert.equal(findChrome('/nowhere', { exists: () => false }), undefined)
})
