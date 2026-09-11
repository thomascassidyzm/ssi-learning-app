/**
 * The human-pass gate, pinned — `pnpm test:human-pass`.
 *
 * FOUNDER RULING (2026-09-10, "10 — gate it"): a human test pass on a fixed sheet is a REQUIRED
 * gate before staging→main. Before this change promote.sh had no such limb at all, so a ship with
 * nobody having touched the build was ordinary. The first test below IS that pre-fix code — an
 * empty limb — and it demonstrates the hole by passing straight through; the second drives the
 * limb actually shipped in promote.sh and shows it refusing the same ship.
 *
 * The rest pin the asymmetry, which is the design's whole point: every status fails towards still
 * open. `fail` blocks, `not checked` blocks, a missing run blocks, silence blocks. Only a full
 * sheet of `pass` on both runs releases.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluatePass, blankPass, SHEET_STEPS, RUNS } from './human-pass.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/** The gate limb as SHIPPED, lifted out of promote.sh so the test cannot drift from it. */
function shippedGate() {
  const sh = readFileSync(join(HERE, 'promote.sh'), 'utf8')
  const m = sh.match(/# HUMAN-PASS-GATE-BEGIN\n([\s\S]*?)# HUMAN-PASS-GATE-END/)
  assert.ok(m, 'promote.sh must mark its human-pass gate with HUMAN-PASS-GATE-BEGIN/END')
  return m[1]
}

/** The gate limb as it was BEFORE this change: there was none. */
const OLD_GATE = '\n: # no gate at all — a promote asked nobody whether a human had touched the build\n'

/** A throwaway repo carrying a real copy of the decision, and its own passes dir. */
function fakeRepo() {
  const dir = mkdtempSync(join(process.env.CS_SCRATCH || tmpdir(), 'human-pass-'))
  mkdirSync(join(dir, 'tools/release-train/passes'), { recursive: true })
  copyFileSync(join(HERE, 'human-pass.mjs'), join(dir, 'tools/release-train/human-pass.mjs'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'test')
  git(dir, 'config', 'core.hooksPath', join(dir, '.githooks-none'))
  writeFileSync(join(dir, 'README.md'), 'x\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'seed')
  return { dir, sha: git(dir, 'rev-parse', 'HEAD') }
}

/** Run a gate limb the way promote.sh runs it, and say whether the promote continued. */
function runGate(limb, { dir, sha }, acceptDrift = '') {
  const script = `set -euo pipefail
REPO="${dir}"
STAGING="${sha}"
ACCEPT_DRIFT="${acceptDrift}"
${limb}
echo PROMOTE_CONTINUED
`
  try {
    const out = execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { continued: out.includes('PROMOTE_CONTINUED'), out }
  } catch (e) {
    return { continued: false, out: `${e.stdout || ''}${e.stderr || ''}` }
  }
}

const fullPass = (sha) => {
  const p = blankPass(sha, { tester: 'Dulmini', recorded_by: 'Watson', date: '2026-09-11' })
  for (const r of RUNS) for (const s of SHEET_STEPS) p.runs[r][s] = 'pass'
  return p
}
const writePass = (dir, p) =>
  writeFileSync(join(dir, 'tools/release-train/passes', `${p.sha.slice(0, 7)}.json`), JSON.stringify(p, null, 2))

// ---------------------------------------------------------------- the fix itself

test('PRE-FIX: with no gate, a promote with no human pass recorded sails through', () => {
  const repo = fakeRepo()
  const r = runGate(OLD_GATE, repo)
  // This is the hole. The assertion the next test makes would FAIL against this code.
  assert.equal(r.continued, true)
})

test('SHIPPED: the gate REFUSES a promote with no human pass recorded', () => {
  const repo = fakeRepo()
  const r = runGate(shippedGate(), repo)
  assert.equal(r.continued, false, r.out)
  assert.match(r.out, /NO HUMAN PASS IS RECORDED/)
})

test('SHIPPED: the gate ALLOWS a promote with a full sheet of passes on the same sha', () => {
  const repo = fakeRepo()
  writePass(repo.dir, fullPass(repo.sha))
  const r = runGate(shippedGate(), repo)
  assert.equal(r.continued, true, r.out)
})

// ------------------------------------------------------- the asymmetry, in the decision

const yes = () => true
const no = () => false

test('a full sheet on both runs releases the gate', () => {
  const { ok } = evaluatePass({ passes: [fullPass('abc')], stagingSha: 'abc', isAncestor: no })
  assert.equal(ok, true)
})

test('one failed step blocks', () => {
  const p = fullPass('abc')
  p.runs.android[SHEET_STEPS[3]] = 'fail'
  const { ok, reasons } = evaluatePass({ passes: [p], stagingSha: 'abc', isAncestor: no })
  assert.equal(ok, false)
  assert.match(reasons.join('\n'), /android · settings-page: fail/)
})

test('one UNANSWERED step blocks exactly as a failure does — silence is never consent', () => {
  const p = fullPass('abc')
  p.runs.web[SHEET_STEPS[0]] = 'not checked'
  const { ok, reasons } = evaluatePass({ passes: [p], stagingSha: 'abc', isAncestor: no })
  assert.equal(ok, false)
  assert.match(reasons.join('\n'), /web · first-belt-change: not checked/)
})

test('a step deleted from the record blocks — absence is not a pass', () => {
  const p = fullPass('abc')
  delete p.runs.web[SHEET_STEPS[2]]
  const { ok } = evaluatePass({ passes: [p], stagingSha: 'abc', isAncestor: no })
  assert.equal(ok, false)
})

test('a missing Android run blocks — web alone is not the pass', () => {
  const p = fullPass('abc')
  delete p.runs.android
  const { ok, reasons } = evaluatePass({ passes: [p], stagingSha: 'abc', isAncestor: no })
  assert.equal(ok, false)
  assert.match(reasons.join('\n'), /android run is missing entirely/)
})

test('a pass taken against a DIFFERENT sheet blocks', () => {
  const p = fullPass('abc')
  p.sheet = 'some-older-sheet'
  const { ok, reasons } = evaluatePass({ passes: [p], stagingSha: 'abc', isAncestor: no })
  assert.equal(ok, false)
  assert.match(reasons.join('\n'), /sheet/)
})

// ------------------------------------------------------------------------- drift

test('a pass on an ANCESTOR of staging blocks — commits landed that nobody tested', () => {
  const { ok, reasons, drift } = evaluatePass({
    passes: [fullPass('older')], stagingSha: 'newer', isAncestor: yes,
  })
  assert.equal(drift, true)
  assert.equal(ok, false)
  assert.match(reasons.join('\n'), /staging has moved on/)
})

test('drift is released only by a written reason, and the reason is recorded on the pass', () => {
  const p = fullPass('older')
  const { ok, pass } = evaluatePass({
    passes: [p], stagingSha: 'newer', isAncestor: yes, acceptDrift: 'copy-only change to the notes',
  })
  assert.equal(ok, true)
  assert.equal(pass.drift_accepted.reason, 'copy-only change to the notes')
  assert.equal(pass.drift_accepted.staging_sha, 'newer')
})

test('a pass on a commit that is NOT an ancestor of staging does not count at all', () => {
  const { ok, reasons } = evaluatePass({
    passes: [fullPass('a-branch-nobody-shipped')], stagingSha: 'newer', isAncestor: no,
  })
  assert.equal(ok, false)
  assert.match(reasons.join('\n'), /NO HUMAN PASS IS RECORDED/)
})
