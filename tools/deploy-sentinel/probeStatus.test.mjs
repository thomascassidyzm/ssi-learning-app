/**
 * probeStatus tests — `pnpm test:deploy-sentinel` (node's built-in runner, no config, no deps).
 *
 * The real incident this guards: the player-events reachability probe sends
 * OPTIONS and the route answers with a documented 204 (see api/_utils/cors.ts),
 * which the old `status === 200` condition always failed. Proves the OLD
 * condition fails on that 204 and the NEW one (isProbeHealthy) passes it,
 * without ever making a network call.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isProbeHealthy } from './probeStatus.mjs'

// The old, defective condition — kept here only so the fix can be proven against it.
function oldOk(probe, response) {
  return response.status === 200 && (!probe.expectBody || response.body.includes(probe.expectBody))
}

test('OLD condition: 204 from a bare reachability probe is wrongly treated as failure', () => {
  const probe = { name: 'player-events reachability', method: 'OPTIONS' }
  const response = { status: 204, body: '' }
  assert.equal(oldOk(probe, response), false)
})

test('NEW condition: 204 from a bare reachability probe (no expectBody) is healthy', () => {
  const probe = { name: 'player-events reachability', method: 'OPTIONS' }
  const response = { status: 204, body: '' }
  assert.equal(isProbeHealthy(probe, response), true)
})

test('any 2xx is healthy for a bare reachability probe', () => {
  const probe = { name: 'reachability' }
  for (const status of [200, 201, 204, 299]) {
    assert.equal(isProbeHealthy(probe, { status, body: '' }), true, `status ${status} should be healthy`)
  }
})

test('non-2xx is unhealthy for a bare reachability probe', () => {
  const probe = { name: 'reachability' }
  for (const status of [0, 301, 400, 403, 404, 500]) {
    assert.equal(isProbeHealthy(probe, { status, body: '' }), false, `status ${status} should be unhealthy`)
  }
})

test('a content probe (expectBody) still requires exactly 200 and a body match', () => {
  const probe = { name: 'app shell', expectBody: '<div id="app"' }
  assert.equal(isProbeHealthy(probe, { status: 200, body: '<div id="app">' }), true)
  assert.equal(isProbeHealthy(probe, { status: 200, body: 'something else' }), false, 'body mismatch must still fail')
  assert.equal(isProbeHealthy(probe, { status: 204, body: '' }), false, 'a content probe cannot be satisfied by a bodyless 204')
  assert.equal(isProbeHealthy(probe, { status: 500, body: '<div id="app">' }), false)
})
