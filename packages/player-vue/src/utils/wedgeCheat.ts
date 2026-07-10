/**
 * `?wedge=1` dev cheat (docs/pwa-lifecycle-design.md §3, T6/T7) — lets a
 * tester deliberately corrupt two precached JS chunks so they can watch the
 * boot watchdog (utils/bootHeal.ts) recover without waiting for a real
 * browser-update wedge. "An escape hatch nobody can rehearse is an escape
 * hatch nobody trusts."
 *
 * Selection logic only — pure and testable. The actual Cache Storage I/O
 * lives in main.js next to the rest of the boot wiring.
 */

/**
 * Prefer chunks that are actually referenced by the currently-loaded page
 * (the entry graph) — poisoning a chunk nothing on this boot touches (e.g.
 * a lazy /admin route) wouldn't reproduce a wedge at all. Falls back to any
 * other precached .js entry if the entry graph doesn't supply enough.
 */
export function selectPrecacheEntriesToPoison(
  cachedUrls: string[],
  entryGraphUrls: string[],
  count = 2,
): string[] {
  const entrySet = new Set(entryGraphUrls)
  const cachedJs = cachedUrls.filter((url) => url.endsWith('.js'))
  const inEntryGraph = cachedJs.filter((url) => entrySet.has(url))
  const rest = cachedJs.filter((url) => !entrySet.has(url))
  return [...inEntryGraph, ...rest].slice(0, count)
}
