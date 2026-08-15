/**
 * offlineUrn — the weighted urn that drives offline INFINITE PLAY.
 *
 * Tom's ruling, 2026-08-15. The offline model in his words: the deliberate
 * offline toggle is for downloading un-played content IN ADVANCE; absent that,
 * offline playback draws only on what is already cached. When the learner is
 * offline — deliberately or accidentally — the app enters infinite play and
 * cycles through cached content, mostly at random.
 *
 * The approved algorithm, and why each part is the way it is:
 *
 * 1. MEASURE THE CACHE. Inventory what is actually fetchable right now; that
 *    list IS the session syllabus. Never assume coverage. (This module takes
 *    the measured inventory as its input — the measuring itself belongs to the
 *    caller, which is the only party that can ask the audio cache.)
 *
 * 2. WEIGHTED URN, SAMPLED WITHOUT REPLACEMENT. Each phrase gets
 *    `1 + length_bonus + recency_bonus` tickets, capped. Every ticket goes in
 *    the urn; we draw without replacement until it is empty, then refill.
 *    Without-replacement is MANDATORY and is the whole point: it guarantees
 *    full coverage of the cached syllabus every pass, and the weights then
 *    control only how OFTEN within a pass — not whether. A with-replacement
 *    sampler would let a phrase go missing for an arbitrarily long time, which
 *    is exactly what spaced repetition must not do.
 *
 * 3. LENGTH BONUS. The top third by clip duration gets extra tickets: longest
 *    is hardest, and hardest decays fastest.
 *
 * 4. RECENCY BONUS. By POSITION IN THE COURSE — introduction order — not clock
 *    time. The newest-introduced material is the least consolidated.
 *
 * The floor of one ticket each is deliberate and load-bearing: early short
 * phrases must keep resurfacing, because they are the skeleton inside the long
 * ones. Spaced repetition falls out of the urn structure itself — there is no
 * learner model, no per-item state, no scheduler. The only inputs are what is
 * in the cache and where each item sits in the course.
 *
 * The two bonus weights are TASTE KNOBS. They are named constants below, they
 * are the only numbers worth arguing about, and Tom tunes them by ear.
 */

// ── Taste knobs ─────────────────────────────────────────────────────────────

/**
 * Extra tickets for the top third by clip duration. Default 2 → a long phrase
 * carries 3 base tickets against a short phrase's 1, so it comes round about
 * three times as often within a pass while still never crowding anything out.
 */
export const URN_LENGTH_BONUS_TICKETS = 2

/**
 * Extra tickets for the top third by course position (most recently
 * introduced). Default 1 — deliberately gentler than the length bonus, because
 * recency already correlates with "not yet consolidated" and stacking both at
 * full strength would starve the early skeleton phrases the floor exists to
 * protect.
 */
export const URN_RECENCY_BONUS_TICKETS = 1

/**
 * Hard cap on tickets per phrase — "capped at ~4x". With the defaults above a
 * long, newly-introduced phrase lands exactly on 4 (1 + 2 + 1), so the cap is
 * not currently binding; it is the guard that keeps it sane if the knobs are
 * turned up.
 */
export const URN_MAX_TICKETS = 4

/** "Top third" for both bonuses. */
export const URN_TOP_FRACTION = 1 / 3

/**
 * How many recently-drawn phrases a draw must avoid repeating. Applies WITHIN
 * a pass (a 4-ticket phrase must not clump) and ACROSS the pass boundary (the
 * refill must not open with what the previous pass just closed on) — the
 * "reshuffle avoiding back-to-back repeats of the last few items" rule.
 */
export const URN_MIN_GAP = 3

// ── Types ───────────────────────────────────────────────────────────────────

export interface UrnCandidate {
  /** Stable identity of the phrase. Two candidates with the same key are the
   *  same phrase and share one ticket allocation. */
  key: string
  /** Clip duration in ms. Drives the length bonus. 0 is fine — it just never
   *  reaches the top third. */
  durationMs: number
  /** Position in the course, in introduction order (round number works).
   *  Higher = introduced later = less consolidated. */
  position: number
}

/** Injectable for tests; defaults to Math.random. */
export type Rng = () => number

export interface UrnOptions {
  lengthBonus?: number
  recencyBonus?: number
  maxTickets?: number
  topFraction?: number
  minGap?: number
  rng?: Rng
}

// ── Ticket allocation ───────────────────────────────────────────────────────

/**
 * Threshold value at or above which a candidate is in the top `fraction`.
 *
 * Computed by sorting and indexing rather than by (max - range * fraction), so
 * it is robust to the skewed, clumpy distributions real course audio actually
 * has — a handful of very long clips would otherwise drag a range-based
 * threshold above almost everything and hand the bonus to nobody.
 */
function topFractionThreshold(values: number[], fraction: number): number {
  if (values.length === 0) return Infinity
  const sorted = [...values].sort((a, b) => b - a)
  const count = Math.max(1, Math.floor(sorted.length * fraction))
  return sorted[count - 1]
}

/**
 * Tickets per phrase: `1 + length_bonus + recency_bonus`, capped.
 *
 * Returns a Map keyed by candidate key. Duplicate keys collapse to one entry
 * (the first wins) — a phrase is one phrase however many rounds reference it.
 */
export function assignTickets(
  candidates: UrnCandidate[],
  options: UrnOptions = {},
): Map<string, number> {
  const lengthBonus = options.lengthBonus ?? URN_LENGTH_BONUS_TICKETS
  const recencyBonus = options.recencyBonus ?? URN_RECENCY_BONUS_TICKETS
  const maxTickets = options.maxTickets ?? URN_MAX_TICKETS
  const topFraction = options.topFraction ?? URN_TOP_FRACTION

  const unique = new Map<string, UrnCandidate>()
  for (const c of candidates) if (!unique.has(c.key)) unique.set(c.key, c)
  const items = [...unique.values()]

  const durationFloor = topFractionThreshold(items.map((c) => c.durationMs), topFraction)
  const positionFloor = topFractionThreshold(items.map((c) => c.position), topFraction)

  // The cap is damped by how much material there actually is. A phrase holding
  // c tickets needs at least 2c-1 slots to be laid out without ever touching
  // itself; with `d` distinct phrases each holding their floor of 1, a pass is
  // about d + extras long, so c above roughly d-1 cannot be spaced at ALL —
  // the arrangement is impossible, not merely unlucky. Concretely: three
  // cached phrases with one on 4 tickets needs 7 slots in a 6-slot pass, and
  // one back-to-back repeat is then forced no matter how it is ordered.
  //
  // So on a thin cache the bonuses damp themselves. This matters exactly when
  // a learner has very little downloaded — which is precisely when they would
  // most notice the same phrase twice in a row.
  const effectiveCap = Math.max(1, Math.min(maxTickets, items.length - 1))

  const tickets = new Map<string, number>()
  for (const c of items) {
    // The floor of 1 is the skeleton guarantee — every cached phrase is in the
    // urn, always, whatever its length or age.
    let n = 1
    if (c.durationMs >= durationFloor) n += lengthBonus
    if (c.position >= positionFloor) n += recencyBonus
    tickets.set(c.key, Math.max(1, Math.min(effectiveCap, n)))
  }
  return tickets
}

// ── Pass construction ───────────────────────────────────────────────────────

/**
 * Build ONE full pass: every ticket, ordered so no key recurs within `minGap`.
 * Length is the sum of all tickets, so every phrase appears at least once and
 * a 4-ticket phrase appears four times.
 *
 * `tail` is the end of the previous pass, so a refill does not repeat what the
 * last pass just closed on.
 *
 * Construction is greedy weighted selection, NOT shuffle-then-repair. The
 * repair approach — walk a shuffled multiset and swap forward out of any
 * clash — starves near the end of a pass, because by then the only elements
 * left to swap with are the very keys that are clashing. That is not a rare
 * roll: it is structural, and it reliably produced a back-to-back repeat in
 * the closing few draws of every pass.
 *
 * Instead: at each step, consider the keys that still have tickets left and
 * have not played within the last `minGap`, and pick one with probability
 * proportional to its REMAINING tickets. Weighting by what is left (rather
 * than by the original allocation) is what spreads a 4-ticket phrase evenly
 * across the pass instead of clumping it early.
 *
 * If nothing is eligible — a pool so small the gap cannot be honoured, e.g. a
 * single cached phrase — the gap relaxes a step at a time until something is.
 * Never stalling matters more than perfect spacing.
 */
export function buildPass(
  candidates: UrnCandidate[],
  options: UrnOptions = {},
  tail: string[] = [],
): string[] {
  const rng = options.rng ?? Math.random
  const minGap = options.minGap ?? URN_MIN_GAP
  const tickets = assignTickets(candidates, options)
  if (tickets.size === 0) return []

  // Keys BUCKETED by how many tickets they have left. Selection then costs
  // O(cap) per draw instead of O(distinct): the naive version rescanned every
  // remaining key on every step to find the max and to build the eligible set,
  // which on a fully-downloaded course (~2000 cached phrases) was ~470ms of
  // synchronous work — a freeze long enough to hear, on the playback path.
  const remaining = new Map(tickets)
  const buckets = new Map<number, string[]>() // count → keys
  const slot = new Map<string, number>() // key → index in its bucket
  let total = 0

  const addTo = (count: number, key: string): void => {
    let b = buckets.get(count)
    if (!b) { b = []; buckets.set(count, b) }
    slot.set(key, b.length)
    b.push(key)
  }
  const removeFrom = (count: number, key: string): void => {
    const b = buckets.get(count)!
    const i = slot.get(key)!
    const lastKey = b[b.length - 1]
    b[i] = lastKey
    slot.set(lastKey, i)
    b.pop()
    slot.delete(key)
  }

  for (const [key, n] of remaining) { addTo(n, key); total += n }

  const out: string[] = []
  const recent = [...tail]

  while (total > 0) {
    // A key with c tickets needs at least 2c-1 remaining slots to be laid out
    // without ever touching itself. When the largest count is at that limit,
    // the pass is TIGHT: emitting anything else now strands it and forces a
    // repeat in the closing draws. That — not an unlucky shuffle — is what
    // produced back-to-back clashes at the end of every pass.
    //
    // So while there is slack, choose at random ("mostly at random", per the
    // ruling). The moment it goes tight, fall back to the classic greedy —
    // always emit a most-numerous key — which is provably able to finish
    // whenever a valid arrangement exists at all. (The ticket cap in
    // assignTickets is what guarantees one does.)
    let maxN = 0
    for (const [count, b] of buckets) if (b.length && count > maxN) maxN = count

    const blockedCount = Math.min(recent.length, minGap)
    let picked: string | null = null

    for (let gap = maxN * 2 - 1 >= total ? 1 : blockedCount; gap >= 1 && picked === null; gap--) {
      const blocked = recent.slice(-gap)
      // When tight, restrict to the hottest bucket; otherwise all of them.
      const lo = maxN * 2 - 1 >= total ? maxN : 1

      let weight = 0
      for (let c = lo; c <= maxN; c++) weight += c * (buckets.get(c)?.length ?? 0)
      for (const k of blocked) {
        const c = remaining.get(k)
        if (c !== undefined && c >= lo) weight -= c
      }
      if (weight <= 0) continue

      let roll = rng() * weight
      for (let c = maxN; c >= lo && picked === null; c--) {
        const b = buckets.get(c)
        if (!b || b.length === 0) continue
        let blockedHere = 0
        for (const k of blocked) if (remaining.get(k) === c) blockedHere++
        const eff = c * (b.length - blockedHere)
        if (eff <= 0) continue
        if (roll >= eff) { roll -= eff; continue }
        // Pick uniformly within the bucket, skipping the ≤minGap blocked keys.
        // Bounded retries then a linear scan, so this is O(1) in practice and
        // O(bucket) in the pathological case.
        for (let attempt = 0; attempt < 8 && picked === null; attempt++) {
          const cand = b[Math.floor(rng() * b.length)]
          if (!blocked.includes(cand)) picked = cand
        }
        if (picked === null) for (const k of b) if (!blocked.includes(k)) { picked = k; break }
      }
      // Float slack: the roll landed past the far edge. Take any eligible key
      // rather than emitting nothing this step.
      if (picked === null) {
        for (let c = maxN; c >= lo && picked === null; c--) {
          for (const k of buckets.get(c) ?? []) if (!blocked.includes(k)) { picked = k; break }
        }
      }
    }

    if (picked === null) {
      // Nothing eligible even at gap 1: the pool is a single phrase. Play it
      // rather than stall — never stalling matters more than perfect spacing.
      for (let c = maxN; c >= 1 && picked === null; c--) {
        const b = buckets.get(c)
        if (b && b.length) picked = b[0]
      }
      if (picked === null) break
    }

    const was = remaining.get(picked)!
    removeFrom(was, picked)
    if (was - 1 > 0) { remaining.set(picked, was - 1); addTo(was - 1, picked) }
    else remaining.delete(picked)

    out.push(picked)
    total--
    recent.push(picked)
    if (recent.length > minGap) recent.splice(0, recent.length - minGap)
  }

  return out
}

// ── The urn ─────────────────────────────────────────────────────────────────

export interface OfflineUrn {
  /** Draw the next key, refilling the urn when it empties. Null only when the
   *  measured cache was genuinely empty — there is then nothing to play, and
   *  that is the one honest failure. */
  next(): string | null
  /** Draw up to `n` keys. Refills as needed, so this crosses pass boundaries
   *  correctly rather than truncating at the end of a pass. */
  take(n: number): string[]
  /** Tickets actually allocated — for logging and for tests. */
  tickets(): Map<string, number>
  /** How many draws remain before the next refill. */
  remaining(): number
}

/**
 * A refilling weighted urn over the measured cache.
 *
 * Stateless with respect to the learner: it holds only the current pass and a
 * short tail of what it just handed out. Nothing is persisted, nothing is
 * learned. Re-measure the cache and build a new urn whenever the cache
 * changes — that is cheaper and more honest than trying to mutate one.
 */
export function createOfflineUrn(
  candidates: UrnCandidate[],
  options: UrnOptions = {},
): OfflineUrn {
  const minGap = options.minGap ?? URN_MIN_GAP
  const ticketMap = assignTickets(candidates, options)
  let pass: string[] = []
  let cursor = 0
  let tail: string[] = []

  const refill = (): void => {
    pass = buildPass(candidates, options, tail)
    cursor = 0
  }

  const next = (): string | null => {
    if (cursor >= pass.length) refill()
    if (pass.length === 0) return null
    const key = pass[cursor++]
    tail.push(key)
    if (tail.length > minGap) tail = tail.slice(-minGap)
    return key
  }

  return {
    next,
    take(n: number): string[] {
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const k = next()
        if (k === null) break
        out.push(k)
      }
      return out
    },
    tickets: () => new Map(ticketMap),
    remaining: () => Math.max(0, pass.length - cursor),
  }
}
