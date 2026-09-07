// Guards run.mjs against defaulting to a real human's account (2026-09-07).
// Run directly: node --test e2e/journeys/run.guard.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RUN = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs')

test('refuses to run with no TESTER_EMAIL set', () => {
  const env = { ...process.env }
  delete env.TESTER_EMAIL
  const r = spawnSync('node', [RUN], { env, encoding: 'utf8', timeout: 15000 })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /TESTER_EMAIL is required/)
})

test('refuses a known real human account even when passed explicitly', () => {
  const env = { ...process.env, TESTER_EMAIL: 'thomas.cassidy+ssi@gmail.com' }
  const r = spawnSync('node', [RUN], { env, encoding: 'utf8', timeout: 15000 })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /real human account/)
})
