// The abandoned-detour rule, on its own so it can be tested and reused.
//
// A chunk counts as INTRODUCED only once the class STAYED with it. Plays the class was promptly
// skipped BACK from never happened, as far as the brain is concerned: they light no chunk, draw
// no arc and count in no tally. Wall-clock in-app minutes are left alone — the class really was
// in the app for them.
//
// The signal is the class's own skip log: a belt_skip or lego_skip carrying a destination seed
// EARLIER than the chunk that was playing. Walking back from that skip, every consecutive play
// ahead of the destination, each within `windowMs` of the next thing the class did, is part of
// the abandoned detour — UNLESS the whole run, from its first play to the skip, took `maxDetourMs`
// or more: that's real practice the class stuck with for a while, not something abandoned within
// about a minute, so it lights normally and nothing in it is excluded. Nothing here is keyed to a
// class, a date or an event id.
export const DETOUR_WINDOW_MS = 60_000
export const DETOUR_MAX_MS = 90_000

/**
 * @param plays       target1 plays, ascending by `occurred_at`, each with a `lego_id`
 * @param jumps       skip rows with `occurred_at` and a `target_seed` (the seed jumped TO)
 * @param seedOf      lego_id -> seed number
 * @param windowMs    max gap between consecutive plays in the run for it to still be "abandoned"
 * @param maxDetourMs max span from the run's first play to the skip; a longer run is kept
 * @returns the subset of `plays` that were an abandoned detour (a Set, by identity)
 */
export function findAbandonedDetours(plays, jumps, seedOf, windowMs = DETOUR_WINDOW_MS, maxDetourMs = DETOUR_MAX_MS) {
  const ms = t => new Date(t).getTime()
  const detoured = new Set()
  for (const j of jumps) {
    if (j.target_seed == null) continue
    const tJ = ms(j.occurred_at)
    let i = plays.length - 1
    while (i >= 0 && ms(plays[i].occurred_at) >= tJ) i--
    const run = []
    let next = tJ
    for (; i >= 0; i--) {
      const ev = plays[i], seed = seedOf(ev.lego_id)
      if (seed === undefined || seed <= j.target_seed) break        // already at or behind the destination
      if (next - ms(ev.occurred_at) > windowMs) break               // it stuck: not promptly abandoned
      run.push(ev)
      next = ms(ev.occurred_at)
    }
    if (run.length === 0) continue
    if (tJ - ms(run[run.length - 1].occurred_at) > maxDetourMs) continue  // ran too long: real practice, keep lit
    for (const ev of run) detoured.add(ev)
  }
  return detoured
}
