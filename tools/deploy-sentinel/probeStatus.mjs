/**
 * Probe health verdict — shared by sentinel.mjs and its tests.
 *
 * A probe with `expectBody` is asserting real page/response CONTENT, and only
 * a 200 can carry that. A bare reachability probe (no `expectBody`) is
 * asserting the ROUTE IS THERE, not what it says — so any 2xx is the route
 * saying so. A 204 from an `OPTIONS` preflight (`applyCors`'s
 * `res.status(204).end()`, see api/_utils/cors.ts) is exactly that: a
 * healthy, documented answer for that method, not a failure. Hardcoding
 * `status === 200` as the one acceptable status made the player-events
 * reachability probe (which sends OPTIONS and can never receive 200) fail
 * every single tick — a defective probe, not a broken deploy.
 */
export function isProbeHealthy(probe, response) {
  if (probe.expectBody) {
    return response.status === 200 && response.body.includes(probe.expectBody)
  }
  return response.status >= 200 && response.status < 300
}
