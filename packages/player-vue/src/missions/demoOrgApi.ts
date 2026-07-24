/**
 * Mission demo org API — a mission-scoped fetch interceptor.
 *
 * The canon node surface (NodeHomeView / NodeInsightsView / NodeRateEngine /
 * WaysInLedger) is server-backed only: it reads /api/groups/:id/home and
 * friends. A mission's world is in-memory, so instead of teaching those views
 * about demo mode (view instrumentation — exactly what the mission engine
 * avoids), the mission serves the SAME endpoints client-side: while a mission
 * is active, requests for its demo-mission-* node ids get synthetic JSON in
 * the server's exact shapes; every other request passes straight through.
 * Exit is a full reload (useMission.exitMission), which discards the wrapper.
 */

interface MissionOrgWorld {
  /** node id → response for GET /api/groups/:id/home (all lens payloads inlined). */
  homes: Record<string, Record<string, unknown>>
  /** node id → response for GET /api/groups/:id/rate-compare. */
  rateCompares: Record<string, Record<string, unknown>>
}

let installed = false

export function installMissionOrgApi(world: MissionOrgWorld): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const realFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const m = url.match(/^\/api\/groups\/(demo-mission-[\w-]+)\/(home|rate-compare|invites)(?:\?|$)/)
    if (!m) return realFetch(input, init)

    const [, nodeId, endpoint] = m
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

    if (method !== 'GET') return json({ error: 'Not available in this demo — end the mission to work with real data.' }, 400)
    if (endpoint === 'home' && world.homes[nodeId]) return json(world.homes[nodeId])
    if (endpoint === 'rate-compare' && world.rateCompares[nodeId]) return json(world.rateCompares[nodeId])
    if (endpoint === 'invites') return json({ links: [] })
    return json({ error: 'Not found' }, 404)
  }
}
