/**
 * Offline Mode fetch ORDER — an explicit priority, not a scheduler.
 *
 * The downloader walks its id array in order, so ordering the array IS the
 * priority. `orderOfflineDownloadTiers` states the tiers by name at the call
 * site instead of leaving the order to however two spreads happened to be
 * written, and dedupes to the EARLIEST position so an id that appears in more
 * than one tier keeps its highest priority.
 *
 * Why it matters: a full-course Offline Mode download is ~1.86 GB (spa_for_eng,
 * measured 2026-09-01) and takes real minutes. Whatever landed before the
 * learner loses signal, closes the app or walks away is what they actually
 * have — so the order decides what a partial download IS.
 *
 * Tom's ruling, 2026-09-01: "I would like the listening pod dialogues to also
 * be prioritised in the Offline Mode. So that, once Offline Mode is selected,
 * the PODS are all downloaded." Hence: a few rounds to start practising, then
 * the WHOLE pod, then everything else.
 *
 * "The whole pod" is deliberately more than the pod's spoken turns. The
 * Listening overlay's own pod surfaces play fine-known gloss clips (2,027 for
 * spa_for_eng, measured live 2026-09-01) and Take-G fusion slices (42) that the
 * main-flow scheduler's row shape does not carry at all — they reach the
 * download only through the persisted listening metadata. Before this they sat
 * in the LAST tier, behind every round of the course: a learner who chose
 * Offline Mode and disconnected part-way through had pod dialogue that stopped
 * dead the moment they opened a fusion rung.
 */
export function orderOfflineDownloadTiers(...tiers: ReadonlyArray<readonly string[]>): string[] {
  return [...new Set(tiers.flat())]
}
