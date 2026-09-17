/**
 * THE CLASS'S BRAIN — the chunks a class has met, joined where they were said
 * together, derived from the class's own diary.
 *
 * This is the app implementation of the rules the replaying-brain specimen
 * settled (docs/specimens/replaying-brain/, jobs #95 and #104). Everything
 * here is PURE so it can be tested without a database; the reads live in
 * api/classes/[id]/brain.ts.
 *
 * What the brain is, in one line: the chunks of the course stand on a line in
 * the order the course introduces them, a dot lights when the class has heard
 * that chunk, and an arc joins two chunks the class has said together inside
 * one phrase. How far right the ink reaches is how far into the course the
 * class is — the Course journey bar drawn honestly.
 *
 * THE UNIT IS THE CLASS. A class plays on its own learner account; no pupil is
 * behind any of this, and nothing here is ever drawn per pupil or compared
 * against another class.
 *
 * THE FIRST-LIGHT RULE. A chunk lights on INTRODUCTION — the first cycle the
 * class heard its target — not on some later mastery threshold.
 *
 * THE ABANDONED-DETOUR RULE (findAbandonedDetours below). A chunk counts as
 * introduced only once the class STAYED with it: plays the class was promptly
 * skipped BACK from never happened, as far as the brain is concerned.
 */

/** Max gap between consecutive plays in a run for it to still count as "abandoned". */
export const DETOUR_WINDOW_MS = 60_000
/** Max span from a detour run's first play to the skip; a longer run is real practice, kept. */
export const DETOUR_MAX_MS = 90_000

export interface SkipRow {
  occurred_at: string
  /** The seed the class jumped TO. Null when it cannot be derived — such a jump is ignored. */
  target_seed: number | null
}

export interface PlayRow {
  occurred_at: string
  lego_id: string | null
  cycle_id: string | null
  role: string | null
  event_type: string
}

/**
 * The subset of `plays` that were an abandoned detour (a Set, by identity).
 *
 * The signal is the class's own skip log: a belt_skip or lego_skip carrying a
 * destination seed EARLIER than the chunk that was playing. Walking back from
 * that skip, every consecutive play ahead of the destination, each within
 * `windowMs` of the next thing the class did, is part of the abandoned detour
 * — UNLESS the whole run, from its first play to the skip, took `maxDetourMs`
 * or more: that is real practice the class stuck with, so it lights normally.
 *
 * @param plays  target1 plays, ascending by occurred_at
 * @param jumps  skip rows with occurred_at and the seed jumped TO
 * @param seedOf lego_id -> seed number
 */
export function findAbandonedDetours<T extends { occurred_at: string; lego_id: string | null }>(
  plays: T[],
  jumps: SkipRow[],
  seedOf: (legoId: string) => number | undefined,
  windowMs: number = DETOUR_WINDOW_MS,
  maxDetourMs: number = DETOUR_MAX_MS,
): Set<T> {
  const ms = (t: string): number => new Date(t).getTime()
  const detoured = new Set<T>()
  for (const j of jumps) {
    if (j.target_seed == null) continue
    const tJ = ms(j.occurred_at)
    let i = plays.length - 1
    while (i >= 0 && ms(plays[i].occurred_at) >= tJ) i--
    const run: T[] = []
    let next = tJ
    for (; i >= 0; i--) {
      const ev = plays[i]
      const seed = ev.lego_id ? seedOf(ev.lego_id) : undefined
      if (seed === undefined || seed <= j.target_seed) break   // already at or behind the destination
      if (next - ms(ev.occurred_at) > windowMs) break          // it stuck: not promptly abandoned
      run.push(ev)
      next = ms(ev.occurred_at)
    }
    if (run.length === 0) continue
    if (tJ - ms(run[run.length - 1].occurred_at) > maxDetourMs) continue  // ran too long: real practice
    for (const ev of run) detoured.add(ev)
  }
  return detoured
}

/**
 * A lego_skip never carries where it landed — the player logs only fromLegoId
 * and a direction. Its destination is DERIVED: the seed of the next target1
 * play after the skip. A skip the class never played on from derives nothing
 * and is ignored, exactly like any other jump with a null destination.
 */
export function deriveSkipDestinations(
  skips: { occurred_at: string; event_type: string; target_seed: number | null }[],
  target1Plays: PlayRow[],
  seedOf: (legoId: string) => number | undefined,
): SkipRow[] {
  return skips
    .slice()
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1))
    .map((j) => {
      if (j.event_type === 'belt_skip') return { occurred_at: j.occurred_at, target_seed: j.target_seed }
      const next = target1Plays.find((p) => p.occurred_at > j.occurred_at)
      const seed = next?.lego_id ? seedOf(next.lego_id) : undefined
      return { occurred_at: j.occurred_at, target_seed: seed ?? null }
    })
}

export type CycleKind = 'intro' | 'debut' | 'build' | 'use' | 'component' | 'practice' | 'eternal_eligible' | 'legacy' | 'unresolved'

export interface BrainPhrase {
  /** target text */
  t: string
  /** known text */
  k: string
  /** ordinal of the phrase's own LEGO on the axis */
  lego: number
  role: string
  pos: number
}

export interface BrainEvent {
  /** occurred_at, ISO */
  t: string
  /** ordinal of the LEGO the cycle belongs to */
  lego: number
  /** the phrase id, when the cycle was a phrase rather than an intro/debut */
  phrase: string | null
  /** ordinals of every LEGO said inside this cycle — the arc's endpoints */
  fires: number[]
  kind: CycleKind
  /** 1 or 2: a cycle plays the target twice, and a clip that never sounded counts 0 */
  hearings: number
  /** index of the sitting (the day the class played) this cycle belongs to */
  s: number
}

export interface BrainTally {
  /** counted cycles (target1 plays that were not an abandoned detour) */
  total: number
  /** target clips that actually sounded */
  hearings: number
  /** cycles set aside by the abandoned-detour rule */
  detoured: number
  intro: number
  debut: number
  build: number
  use: number
  other: number
}

export interface PhraseRow {
  id: string
  target_text: string
  known_text: string | null
  phrase_role: string
  position: number
  lego_id: string | null
  decomposition: unknown
}

export interface BuildBrainInput {
  courseCode: string
  /** every diary row for the class, any order */
  rows: PlayRow[]
  /** skip rows (belt_skip carries target_seed; lego_skip does not) */
  skips: { occurred_at: string; event_type: string; target_seed: number | null }[]
  /** lego_id -> axis ordinal (0-based), in course order */
  ordinalOf: Map<string, number>
  /** lego_id -> seed number */
  seedOf: Map<string, number>
  /** phrase id -> row */
  phrases: Map<string, PhraseRow>
}

export interface BuiltBrain {
  events: BrainEvent[]
  tally: BrainTally
  /** days the class played, ascending */
  sittings: string[]
  /** distinct chunks the class has MET for the first time — NEW PHRASES */
  introducedCount: number
  /** distinct phrases practised */
  distinctPhrases: number
  /** phrase id -> its text and axis position, for every phrase that appears in `events` */
  phraseText: Record<string, BrainPhrase>
}

/** `S0042L03_use_05_something` -> `<course>:S0042L03U05`. Null when the cycle id is not a phrase. */
export function phraseIdFromCycleId(cycleId: string | null, courseCode: string): string | null {
  if (!cycleId) return null
  const m = /^(S\d{4}L\d{2})_(build|use)_(\d{2})/.exec(cycleId)
  return m ? `${courseCode}:${m[1]}${m[2] === 'use' ? 'U' : 'B'}${m[3]}` : null
}

function legoIdsOfDecomposition(decomposition: unknown): string[] {
  if (!Array.isArray(decomposition)) return []
  const out: string[] = []
  for (const d of decomposition) {
    const id = d && typeof d === 'object' ? (d as Record<string, unknown>).legoId : null
    if (typeof id === 'string' && id) out.push(id)
  }
  return out
}

/**
 * The brain, built from one class's diary. Only target1 plays are counted as
 * cycles — a cycle exists once the class HEARD the target — and each carries a
 * `hearings` count of 1 or 2 from its own target1/target2 clips, excluding any
 * clip immediately (<50ms) followed by an audio_failed row for the same clip:
 * that play never sounded.
 */
export function buildBrain(input: BuildBrainInput): BuiltBrain {
  const { courseCode, rows, skips, ordinalOf, seedOf, phrases } = input
  const asc = (a: { occurred_at: string }, b: { occurred_at: string }): number => (a.occurred_at < b.occurred_at ? -1 : 1)
  const targets = rows
    .filter((r) => r.event_type === 'audio_play' && (r.role === 'target1' || r.role === 'target2'))
    .sort(asc)
  const target1 = targets.filter((r) => r.role === 'target1')

  // Clips that never sounded: an audio_play with an audio_failed for the same
  // clip within 50ms.
  const failures = new Map<string, number[]>()
  for (const r of rows) {
    if (r.event_type !== 'audio_failed') continue
    const key = `${r.role}|${r.lego_id}|${r.cycle_id}`
    const at = new Date(r.occurred_at).getTime()
    const list = failures.get(key)
    if (list) list.push(at)
    else failures.set(key, [at])
  }
  const sounded = (r: PlayRow): boolean => {
    const fails = failures.get(`${r.role}|${r.lego_id}|${r.cycle_id}`)
    if (!fails) return true
    const at = new Date(r.occurred_at).getTime()
    return !fails.some((f) => Math.abs(f - at) < 50)
  }

  const seedLookup = (legoId: string): number | undefined => seedOf.get(legoId)
  const detoured = findAbandonedDetours(target1, deriveSkipDestinations(skips, target1, seedLookup), seedLookup)

  const tally: BrainTally = { total: 0, hearings: 0, detoured: 0, intro: 0, debut: 0, build: 0, use: 0, other: 0 }
  const events: BrainEvent[] = []
  const phraseText: Record<string, BrainPhrase> = {}
  const introduced = new Set<number>()
  const distinct = new Set<string>()

  for (let i = 0; i < targets.length; i++) {
    const p = targets[i]
    if (p.role !== 'target1') continue
    if (detoured.has(p)) { tally.detoured++; continue }
    tally.total++
    const lego = p.lego_id ? ordinalOf.get(p.lego_id) : undefined
    if (lego === undefined) continue

    // Hearings: this target1 clip plus its own target2 clip, if the second
    // voice played before the next cycle began.
    let hearings = sounded(p) ? 1 : 0
    for (let j = i + 1; j < targets.length; j++) {
      const r2 = targets[j]
      if (r2.role === 'target1') break
      if (r2.cycle_id === p.cycle_id && r2.lego_id === p.lego_id) { if (sounded(r2)) hearings += 1; break }
    }

    let kind: CycleKind
    let phrase: string | null = null
    let fires = [lego]
    if (/_intro/.test(p.cycle_id || '')) kind = 'intro'
    else if (/_debut/.test(p.cycle_id || '')) kind = 'debut'
    else {
      const id = phraseIdFromCycleId(p.cycle_id, courseCode)
      const row = id ? phrases.get(id) : undefined
      if (id && row) {
        kind = row.phrase_role as CycleKind
        phrase = id
        const parts = legoIdsOfDecomposition(row.decomposition)
          .map((l) => ordinalOf.get(l))
          .filter((x): x is number => x !== undefined)
        fires = [...new Set(parts)]
        if (!fires.includes(lego)) fires.push(lego)
        if (!phraseText[id]) {
          phraseText[id] = {
            t: row.target_text,
            k: row.known_text || '',
            lego: row.lego_id ? (ordinalOf.get(row.lego_id) ?? lego) : lego,
            role: row.phrase_role,
            pos: row.position,
          }
        }
        distinct.add(id)
      } else if (/^S\d{4}L\d{2}_(build|use)_\d+$/.test(p.cycle_id || '')) kind = 'legacy'
      else kind = 'unresolved'
    }
    if (kind === 'intro') introduced.add(lego)
    if (kind === 'intro' || kind === 'debut' || kind === 'build' || kind === 'use') tally[kind]++
    else tally.other++
    tally.hearings += hearings
    events.push({ t: p.occurred_at, lego, phrase, fires, kind, hearings, s: 0 })
  }

  events.sort((a, b) => (a.t < b.t ? -1 : 1))
  const sittings = [...new Set(events.map((e) => e.t.slice(0, 10)))].sort()
  for (const e of events) e.s = sittings.indexOf(e.t.slice(0, 10))

  return { events, tally, sittings, introducedCount: introduced.size, distinctPhrases: distinct.size, phraseText }
}
