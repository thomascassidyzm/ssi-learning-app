/**
 * howThisWorksThrob — seen/re-arm state for the How-this-works button's
 * discoverability throb (founder ruling 2026-07-29: the button is THE single
 * surfacing point for walks + invitations, so it glows subtly on first visit
 * and re-arms when the noticing rules surface something not yet seen).
 *
 * Pure localStorage state, same persistence idiom as NoticingInvitations'
 * dismissal map: one JSON map under one key, pruned as we write. Entries are
 * keyed `${viewerId}:node-home:${nodeId}` — viewerId is the auth uid where
 * the mount knows it ('anon' otherwise; localStorage is per-device, the
 * accepted idiom here).
 *
 * The rules:
 * · first visit  = the viewer has NO seen entry for the surface at all → throb.
 * · re-arm       = the current (undismissed, visible) invitation set contains
 *   a key not recorded at the viewer's last open of THIS node's panel → throb.
 * · opening the panel = markSeen(current keys) → throb stops until the
 *   invitation set changes again.
 */

export const HTW_SEEN_KEY = 'ssi-htw-seen'

const SURFACE = 'node-home'
const PRUNE_DAYS = 180

interface SeenEntry {
  seenAt: number
  invKeys: string[]
}

function readSeen(): Record<string, SeenEntry> {
  try {
    return JSON.parse(localStorage.getItem(HTW_SEEN_KEY) || '{}')
  } catch {
    return {}
  }
}

const entryKey = (viewerId: string, nodeId: string): string => `${viewerId}:${SURFACE}:${nodeId}`

/** Should the How-this-works button throb right now? */
export function shouldThrob(viewerId: string, nodeId: string, currentInvKeys: string[]): boolean {
  const map = readSeen()
  const surfaceSeen = Object.keys(map).some((k) => k.startsWith(`${viewerId}:${SURFACE}:`))
  if (!surfaceSeen) return true
  const entry = map[entryKey(viewerId, nodeId)]
  const seenKeys = entry?.invKeys ?? []
  return currentInvKeys.some((k) => !seenKeys.includes(k))
}

/** The panel was opened: record it (with the invitation set it surfaced). */
export function markSeen(viewerId: string, nodeId: string, currentInvKeys: string[]): void {
  const map = readSeen()
  map[entryKey(viewerId, nodeId)] = { seenAt: Date.now(), invKeys: currentInvKeys }
  // Prune stale entries while we're here so the map never grows unbounded.
  const cutoff = Date.now() - PRUNE_DAYS * 86400000
  for (const k of Object.keys(map)) if (map[k].seenAt < cutoff) delete map[k]
  try {
    localStorage.setItem(HTW_SEEN_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable — the throb just stays armed, never breaks the page */
  }
}
