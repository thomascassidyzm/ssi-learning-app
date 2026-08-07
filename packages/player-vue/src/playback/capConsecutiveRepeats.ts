/**
 * capConsecutiveRepeats — the single enforcement point for Tom's A-64 design
 * law (2026-08-06):
 *
 *   "no mode should ever repeat the same prompt more than twice consecutively"
 *
 * Exactly two identical prompts back to back is legal. Three is banned —
 * everywhere, in every mode, under every configuration. This is a FLOOR, not a
 * suggestion: it runs downstream of all configuration (algorithm_config rows,
 * Easy/Fast script shapes, admin-edited pod stage playlists), so no DB value
 * and no future mode can breach it.
 *
 * The law is about CONSECUTIVENESS only. Spaced repetition is untouched — a
 * phrase may come back any number of times across a session. So the fix is to
 * RE-INTERLEAVE, not to delete: when a third consecutive identical item would
 * be emitted, we pull the next differing item forward instead, and the
 * offending item lands after it. Totals are preserved.
 *
 * A rep is only dropped when re-interleaving genuinely has nothing left to
 * interleave with — a pool of one phrase with more reps than separators can
 * carry. That is arithmetically unavoidable (n differing items can separate at
 * most 2*(n+1) copies of one identity), and every drop is reported in the
 * result so callers can log it.
 *
 * The algorithm is "earliest legal item that keeps the rest schedulable": walk
 * the queue and emit the first remaining item that neither creates a third
 * consecutive repeat nor strands the tail. Input order is preserved except
 * where the law forces a swap. The lookahead matters — plain first-legal-wins
 * emits A,B,B and then has to drop a B out of A,B,B,A,B,B,B, whereas the true
 * arithmetic capacity (2*(others+1) slots for the commonest identity) says all
 * seven fit as B,B,A,B,B,A,B. With the lookahead, a rep is dropped only when no
 * ordering whatsoever could have kept it.
 */

export interface CapConsecutiveOptions<T> {
  /** Maximum identical items allowed back to back. Default 2 (the law). */
  max?: number
  /**
   * Identities of the items that immediately PRECEDED this sequence, oldest
   * first — e.g. the tail of the previous pod lap. Lets the cap hold across a
   * boundary the caller processes in separate calls. Only the last `max` are
   * consulted.
   */
  seed?: string[]
  /**
   * Never return fewer than this many items, even if the law would empty the
   * sequence (a degenerate single-identity lap arriving on top of a seed that
   * already holds `max` of it). Keeping the session alive outranks the cap
   * here — Tom's ruling on the offline fallback, applied generally. Any item
   * kept this way is counted in `forcedKeeps`. Default 0.
   */
  minKeep?: number
}

export interface CapConsecutiveResult<T> {
  /** The re-interleaved sequence. Never contains `max + 1` equal identities in a row. */
  items: T[]
  /** Items removed because there was nothing left to interleave with. */
  dropped: T[]
  /** Identities of the last `max` emitted items — feed back in as the next call's `seed`. */
  tail: string[]
  /** True if any item was moved from its input position. */
  reordered: boolean
  /** Items emitted in breach of the cap solely to honour `minKeep`. */
  forcedKeeps: number
}

/**
 * Re-order `items` so no identity appears more than `max` times consecutively.
 *
 * Pure. No I/O, no logging, no mutation of the input array.
 */
export function capConsecutiveRepeats<T>(
  items: readonly T[],
  identityOf: (item: T) => string,
  options: CapConsecutiveOptions<T> = {},
): CapConsecutiveResult<T> {
  const max = Math.max(1, options.max ?? 2)
  const minKeep = Math.max(0, options.minKeep ?? 0)

  // Recent identities, oldest first, at most `max` long.
  const recent: string[] = (options.seed ?? []).slice(-max)

  const blocked = (): string | null => {
    if (recent.length < max) return null
    const first = recent[recent.length - max]
    for (let i = recent.length - max; i < recent.length; i++) {
      if (recent[i] !== first) return null
    }
    return first
  }

  const remaining = items.slice()
  const out: T[] = []
  const dropped: T[] = []
  let reordered = false
  let forcedKeeps = 0

  // Live tally of what is still queued, so feasibility is O(distinct) per step.
  const counts = new Map<string, number>()
  for (const item of remaining) {
    const key = identityOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  /** Length of the trailing run of `recent`, and the identity it repeats. */
  const trailingRun = (): { id: string | null; run: number } => {
    if (recent.length === 0) return { id: null, run: 0 }
    const last = recent[recent.length - 1]
    let run = 0
    for (let i = recent.length - 1; i >= 0 && recent[i] === last; i--) run++
    return { id: last, run }
  }

  /**
   * Can everything still queued be emitted without a drop? An identity with
   * `c` copies needs `others + 1` gaps to sit in, each holding `max` copies —
   * minus however many of it are already sitting at the tail.
   */
  const schedulable = (total: number): boolean => {
    const { id: tailId, run } = trailingRun()
    for (const [key, c] of counts) {
      if (c === 0) continue
      const capacity = max * (total - c + 1) - (key === tailId ? run : 0)
      if (c > capacity) return false
    }
    return true
  }

  const take = (index: number) => {
    const [chosen] = remaining.splice(index, 1)
    const key = identityOf(chosen)
    counts.set(key, (counts.get(key) ?? 1) - 1)
    out.push(chosen)
    recent.push(key)
    if (recent.length > max) recent.shift()
    return chosen
  }

  while (remaining.length > 0) {
    const bannedId = blocked()
    const total = remaining.length

    // Candidate identities, in first-appearance order, that the law allows now.
    const seen = new Set<string>()
    const candidates: Array<{ index: number; key: string }> = []
    for (let i = 0; i < remaining.length; i++) {
      const key = identityOf(remaining[i])
      if (key === bannedId || seen.has(key)) continue
      seen.add(key)
      candidates.push({ index: i, key })
    }

    if (candidates.length === 0) {
      // Nothing left but the banned identity. Keep the session alive if the
      // caller demanded a floor; otherwise the surplus reps are dropped.
      if (out.length < minKeep) {
        forcedKeeps++
        take(0)
        continue
      }
      dropped.push(...remaining)
      break
    }

    // Prefer the earliest candidate that leaves the remainder schedulable;
    // fall back to the one with the most copies left, which strands the fewest.
    let pick = -1
    for (const candidate of candidates) {
      const key = candidate.key
      counts.set(key, (counts.get(key) ?? 1) - 1)
      recent.push(key)
      const spare = recent.length > max ? recent.shift()! : null
      const ok = schedulable(total - 1)
      if (spare !== null) recent.unshift(spare)
      recent.pop()
      counts.set(key, (counts.get(key) ?? 0) + 1)
      if (ok) { pick = candidate.index; break }
    }
    if (pick === -1) {
      const best = candidates.reduce((a, b) =>
        (counts.get(b.key) ?? 0) > (counts.get(a.key) ?? 0) ? b : a)
      pick = best.index
    }

    if (pick !== 0) reordered = true
    take(pick)
  }

  return { items: out, dropped, tail: recent.slice(-max), reordered, forcedKeeps }
}

/**
 * Prompt identity for a player `Cycle` — normalised known text paired with
 * normalised target text. Falls back to the audio URLs for listening cycles,
 * whose missing side (pod sentence plays carry no known text, pod translations
 * carry no target text) would otherwise make two plays of the same clip look
 * like different prompts.
 */
export interface PromptIdentifiableCycle {
  type?: string
  known?: { text?: string; audioUrl?: string }
  target?: { text?: string; voice1Url?: string }
}

export function cyclePromptIdentity(cycle: PromptIdentifiableCycle): string {
  const norm = (text: string | null | undefined): string =>
    text ? text.toLowerCase().trim().replace(/[.,!?;:¡¿'"]+/g, '') : ''
  const known = norm(cycle.known?.text)
  const target = norm(cycle.target?.text)
  if (known || target) return `${known}|${target}`
  return `audio:${cycle.known?.audioUrl ?? ''}|${cycle.target?.voice1Url ?? ''}`
}

/**
 * Apply the A-64 cap to the cycle list of every round, in place of the round's
 * original order. Rounds are the player's unit of position, so re-interleaving
 * is confined within a round; each round is seeded with the previous round's
 * tail so the law also holds at the seam.
 *
 * This is the LAST point at which the law can be enforced for the main player:
 * both round adapters (`toSimpleRounds` for the legacy generator path,
 * `backendCyclesToRounds` / `infPlayCyclesToRounds` for the instant-playback
 * path that `INSTANT_PLAYBACK_ALL` makes the live default) hand their output
 * straight to SimplePlayer. Enforcing here rather than upstream also survives
 * the adapters' own missing-audio filtering, which can pull two previously
 * separated prompts together.
 *
 * A round's LEADING intro / component_intro / debut cycles are ANCHORED — never
 * displaced by re-interleaving. A round must open with its intro and debut;
 * that structure is asserted by validateLearningScript and assumed by the UI.
 * Without the anchor, a round whose intro identity happened to match the two
 * cycles ending the previous round would have a build phrase pulled in front of
 * its intro. That seam case needs the previous round's last two cycles to be
 * textually identical to the next LEGO's bare text, so it is not reachable with
 * real content — but the guard costs nothing and removes the class.
 */
const ANCHORED_LEADING_TYPES = new Set(['intro', 'component_intro', 'debut'])

export function capRoundCycles<C extends { type?: string }, R extends { cycles: C[] }>(
  rounds: R[],
  identityOf: (cycle: C) => string,
): { rounds: R[]; dropped: number; reorderedRounds: number } {
  let tail: string[] = []
  let dropped = 0
  let reorderedRounds = 0
  const out = rounds.map(round => {
    // Peel off the anchored opening (intro / component_intro / debut) and pass
    // it through untouched, carrying its identities into the cap as the seed.
    let anchorEnd = 0
    while (anchorEnd < round.cycles.length
      && ANCHORED_LEADING_TYPES.has(round.cycles[anchorEnd].type ?? '')) anchorEnd++
    const anchored = round.cycles.slice(0, anchorEnd)
    for (const cycle of anchored) tail = [...tail, identityOf(cycle)].slice(-2)

    const capped = capConsecutiveRepeats(round.cycles.slice(anchorEnd), identityOf, { seed: tail })
    tail = capped.tail
    dropped += capped.dropped.length
    if (capped.reordered) reorderedRounds++
    return capped.reordered || capped.dropped.length > 0
      ? { ...round, cycles: [...anchored, ...capped.items] }
      : round
  })
  return { rounds: out, dropped, reorderedRounds }
}

/**
 * Assertion helper for tests and dev-build self-checks: the index of the first
 * item that is the (max + 1)th consecutive repeat, or -1 when the sequence is
 * lawful.
 */
export function findConsecutiveBreach<T>(
  items: readonly T[],
  identityOf: (item: T) => string,
  max = 2,
): number {
  let run = 0
  let lastId: string | null = null
  for (let i = 0; i < items.length; i++) {
    const id = identityOf(items[i])
    run = id === lastId ? run + 1 : 1
    lastId = id
    if (run > max) return i
  }
  return -1
}
