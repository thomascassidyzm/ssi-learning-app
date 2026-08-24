/**
 * learnerThrob — seen-state for the learner-side explainer sections
 * ("How this works" and "Why this works" on the profile).
 *
 * Same persistence idiom as howThisWorksThrob.ts, which serves the admin /
 * schools / orgs surfaces: one JSON map under one key, pruned as we write,
 * entries keyed `${viewerId}:${sectionId}`. viewerId is the auth uid where the
 * mount knows it, 'anon' otherwise — localStorage is per-device, the accepted
 * idiom here.
 *
 * Deliberately a sibling module rather than a generalisation of the admin one:
 * the admin throb re-arms off a live invitation set, and the learner sections
 * are static repo-authored prose with nothing to re-arm on. The rule here is
 * simply: throb until this section has been opened once, then never again.
 * Each section has its own independent seen-state.
 */

export const LEARNER_EXPLAINER_SEEN_KEY = 'ssi-learner-explainer-seen'

const PRUNE_DAYS = 180

/**
 * The learner-side explainer sections, each with its own seen-state.
 * 'library-how-this-works' (A-159) is the Library's own section — the one that
 * leads with the practical walkthroughs; it throbs independently of the two
 * profile sections, so opening one on the profile leaves the Library's armed.
 */
export type LearnerExplainerId = 'how-this-works' | 'why-this-works' | 'library-how-this-works'

interface SeenEntry {
  seenAt: number
}

function readSeen(): Record<string, SeenEntry> {
  try {
    const raw = JSON.parse(localStorage.getItem(LEARNER_EXPLAINER_SEEN_KEY) || '{}')
    return raw && typeof raw === 'object' ? (raw as Record<string, SeenEntry>) : {}
  } catch {
    return {}
  }
}

const entryKey = (viewerId: string, sectionId: LearnerExplainerId): string => `${viewerId}:${sectionId}`

/** Should this section's link carry its pulsing dot right now? */
export function shouldThrob(viewerId: string, sectionId: LearnerExplainerId): boolean {
  const map = readSeen()
  return !map[entryKey(viewerId, sectionId)]
}

/** The section was opened: record it, and the pulse stops for good. */
export function markSeen(viewerId: string, sectionId: LearnerExplainerId): void {
  const map = readSeen()
  map[entryKey(viewerId, sectionId)] = { seenAt: Date.now() }
  // Prune stale entries while we're here so the map never grows unbounded.
  const cutoff = Date.now() - PRUNE_DAYS * 86400000
  for (const k of Object.keys(map)) {
    if (!(map[k]?.seenAt >= cutoff)) delete map[k]
  }
  try {
    localStorage.setItem(LEARNER_EXPLAINER_SEEN_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable — the pulse just stays armed, never breaks the page */
  }
}
