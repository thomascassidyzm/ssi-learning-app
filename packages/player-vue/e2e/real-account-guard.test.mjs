// Guards every account-signing probe against defaulting to, or accepting, a
// real human's account (2026-09-07). Companion to journeys/run.guard.test.mjs,
// which covers the harness this pattern was lifted from.
//
// Run directly:  node --test e2e/real-account-guard.test.mjs
//
// Each probe is spawned with the env it would refuse on. We assert only the
// refusal — non-zero exit and the reason on stderr — so the test never needs
// Supabase keys, a browser, or the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const E2E = dirname(fileURLToPath(import.meta.url))

// script → the env var it reads for the account it signs in as
const GUARDED = {
  'csp-audit-probe.mjs': 'TESTER_EMAIL',
  'ime-vad-topup-probe.mjs': 'ADMIN_EMAIL',
  'vad-empty-state-ui-probe.mjs': 'ADMIN_EMAIL',
  'returning-learner-latency-probe.mjs': 'TESTER_EMAIL',
  'org-hierarchy/verify-org-tree.mjs': 'ADMIN_EMAIL',
  'org-hierarchy/verify-neutral-dressing.mjs': 'ADMIN_EMAIL',
  'demo-schools/verify-demo-schools.mjs': 'ADMIN_EMAIL',
  'resolved-session-audit/mint-sessions.mjs': 'ADMIN_EMAIL',
  'journeys/run.mjs': 'TESTER_EMAIL',
}

const REAL = ['thomas.cassidy+ssi@gmail.com', 'thomas.cassidy@gmail.com', 'tomcassidy@mac.com']

const run = (script, extra) => {
  const env = { ...process.env }
  for (const k of ['TESTER_EMAIL', 'ADMIN_EMAIL', 'TEACHER_EMAIL', 'LEADER_EMAIL']) delete env[k]
  Object.assign(env, extra)
  return spawnSync('node', [join(E2E, script)], { env, encoding: 'utf8', timeout: 30000 })
}

for (const [script, varName] of Object.entries(GUARDED)) {
  test(`${script} refuses with no account set`, () => {
    const r = run(script, {})
    assert.notEqual(r.status, 0, r.stdout)
    assert.match(r.stderr, new RegExp(`${varName} is required`))
  })

  for (const real of REAL) {
    test(`${script} refuses ${varName}=${real}`, () => {
      const r = run(script, { [varName]: real })
      assert.notEqual(r.status, 0, r.stdout)
      assert.match(r.stderr, /real human account/)
    })
  }

  // A real address smuggled in through a var this script does not itself read
  // is still a refusal — no back door.
  test(`${script} refuses a real address in any account env var`, () => {
    const r = run(script, { [varName]: 'thomas.cassidy+bumface@gmail.com', TEACHER_EMAIL: 'tomcassidy@mac.com' })
    assert.notEqual(r.status, 0, r.stdout)
    assert.match(r.stderr, /real human account/)
  })
}
