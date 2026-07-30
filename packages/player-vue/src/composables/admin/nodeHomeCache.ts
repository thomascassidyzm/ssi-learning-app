// nodeHomeCache — WHERE-YOU-ARE stability between sibling views of the SAME
// node (founder finding 2026-07-30: hopping Overview <-> Insights faked a
// full screen load — the rail column vanished and re-fetched on every hop).
//
// Two tiers, one honesty rule (never show the WRONG node's data; a cached
// value is always reconciled silently against the fresh fetch that follows):
// · in-memory: the full /api/groups/:id/home payload, keyed by node id +
//   lens — the sibling view seeded it seconds ago, so the next view renders
//   it synchronously on first paint and the remount is invisible.
// · sessionStorage: just the RAIL subset (ancestors/node/siblings/children/
//   kind — immutable-in-practice within a session), so a full page reload
//   rehydrates the tree without an identity flash. Never stats or rollups:
//   those must come fresh or show a loading state.
//
// Entitlement note: the cache only ever holds what THIS session already
// fetched through the authorized endpoint — it widens nothing. If a fetch
// for a node comes back non-OK, the views drop that node's entry so a stale
// rail can't outlive lost access.

export interface RailSnapshot {
  ancestors: unknown[]
  node: { id: string; name: string; label: string }
  siblings: unknown[]
  children: unknown[]
  kind?: 'node' | 'class'
}

const mem = new Map<string, unknown>()
const SS_PREFIX = 'ssi-node-rail:'

function fullKey(id: string, lens?: string): string {
  return `${id}::${lens && lens !== 'children' ? lens : ''}`
}

function railSubset(payload: any): RailSnapshot | null {
  if (!payload?.node?.id) return null
  return {
    ancestors: payload.ancestors || [],
    node: payload.node,
    siblings: payload.siblings || [],
    children: payload.children || [],
    kind: payload.kind,
  }
}

export function cacheNodeHome(id: string, payload: unknown, lens?: string): void {
  if (!id || !payload) return
  mem.set(fullKey(id, lens), payload)
  const rail = railSubset(payload)
  if (!rail) return
  try {
    sessionStorage.setItem(SS_PREFIX + id, JSON.stringify(rail))
  } catch {
    // storage full/unavailable — the in-memory tier still covers view hops
  }
}

/** Full payload from THIS page lifetime, exact node+lens — safe to seed a view with. */
export function cachedNodeHome(id: string, lens?: string): any | null {
  return mem.get(fullKey(id, lens)) ?? null
}

/** Rail-only snapshot (lens-agnostic; survives reload via sessionStorage). */
export function cachedRail(id: string): RailSnapshot | null {
  if (!id) return null
  for (const [key, payload] of mem) {
    if (key.startsWith(`${id}::`)) {
      const rail = railSubset(payload)
      if (rail) return rail
    }
  }
  try {
    const raw = sessionStorage.getItem(SS_PREFIX + id)
    return raw ? (JSON.parse(raw) as RailSnapshot) : null
  } catch {
    return null
  }
}

/** Drop a node's entries — called when a fetch for it comes back non-OK. */
export function dropCachedNode(id: string): void {
  for (const key of mem.keys()) if (key.startsWith(`${id}::`)) mem.delete(key)
  try {
    sessionStorage.removeItem(SS_PREFIX + id)
  } catch {
    // nothing to drop
  }
}

/** Test hook. */
export function clearNodeHomeCache(): void {
  mem.clear()
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i)
      if (k?.startsWith(SS_PREFIX)) sessionStorage.removeItem(k)
    }
  } catch {
    // storage unavailable
  }
}
