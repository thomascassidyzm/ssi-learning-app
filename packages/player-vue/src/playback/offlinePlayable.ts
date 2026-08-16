/**
 * ONE definition of "can this cycle actually make a sound offline?".
 *
 * Tom, on his phone in airplane mode, 2026-08-15: "the first one didn't play.
 * It had no audio. And then this one. So the script probably had the text of
 * the first infinite play phrase on cache anyway maybe."
 *
 * He was right about the cause and half right about the mechanism. The script
 * cache and the audio cache are separate stores with independent lifetimes, so
 * the text did survive without the audio. But the gate that is supposed to
 * reconcile them had a hole, written out four times verbatim:
 *
 *     const idOf = (u) => (typeof u === 'string' ? u.match(/\/api\/audio\/([^?]+)/)?.[1] : null)
 *     const cachedId = (u) => { const id = idOf(u); return !id || audioCache.persistent.has(id) }
 *                                                   ^^^^
 * `!id` answers TRUE — "cached" — for any URL that yields no audio id. And the
 * round builders emit exactly such a URL, the empty string, whenever an audio
 * id is missing (`audioUrl = (uuid) => uuid ? \`/api/audio/${uuid}\` : ''`).
 *
 * So a cycle with a MISSING clip was not merely "uncached" to the gate — it was
 * maximally cached, the one thing guaranteed to survive the offline filter. It
 * then played through all four phases in silence with its text on screen,
 * because SimplePlayer treats a falsy URL as "nothing here, move on".
 *
 * Intros are where this bites, and why Tom's was the FIRST phrase: both round
 * builders deliberately exempt intros from the audio-completeness check every
 * other cycle type must pass, so an audio-less intro is emitted with blank
 * slots — and an intro is cycle 0 of a round, and a resume lands at a round
 * start. On ita_for_eng, Tom's course, 158 of 1,457 LEGOs (11%) have no
 * presentation audio at all.
 *
 * The rule here is FAIL CLOSED: a blank or unparseable URL is NOT PLAYABLE,
 * never "cached". The one nuance is that some blanks are deliberate — a
 * single-audio cycle (listening, pod, bookend, drained seed-sandwich) is
 * SUPPOSED to carry one clip and two empty slots. Distinguishing "deliberately
 * empty" from "missing" is the actual fix; treating them identically is the
 * bug.
 */

/** Extract the audio id from a `/api/audio/<id>` URL. Null if there isn't one. */
export const audioIdFromUrl = (u?: string | null): string | null =>
  (typeof u === 'string' ? (u.match(/\/api\/audio\/([^?]+)/)?.[1] ?? null) : null)

/** A membership test over the persistent audio cache. */
export type HasCachedAudio = (id: string) => boolean

interface PlayableCycle {
  singleAudio?: boolean
  known?: { audioUrl?: string | null } | null
  target?: { voice1Url?: string | null; voice2Url?: string | null } | null
}

/**
 * Which clips does this cycle NEED in order to make its sound?
 *
 * A single-audio cycle plays exactly one clip — whichever of its slots is
 * filled — and its empty slots are by design. Everything else, INTROS
 * INCLUDED, needs all three: the known prompt and both target voices. The old
 * builders' intro exemption is precisely what let a silent intro through, so
 * it is deliberately not honoured here.
 */
export const requiredClipUrls = (cycle: PlayableCycle | null | undefined): (string | null | undefined)[] => {
  if (!cycle) return []
  const known = cycle.known?.audioUrl
  const v1 = cycle.target?.voice1Url
  const v2 = cycle.target?.voice2Url
  if (cycle.singleAudio === true) {
    // Its one real clip is whichever slot is filled. If NONE is filled there
    // is nothing to play, and the empty array below would wrongly pass — so
    // return a single blank, which fails closed like any other missing clip.
    const only = [known, v1, v2].find((u) => typeof u === 'string' && u.length > 0)
    return [only ?? null]
  }
  return [known, v1, v2]
}

/**
 * Can this cycle be played from cache alone, right now?
 *
 * FAILS CLOSED. A blank URL, an unparseable URL, or an id that is not in the
 * persistent cache all mean NO. Callers should skip the cycle and fall through
 * to the cached-recycle pool — never to silence.
 */
export const isCyclePlayableOffline = (
  cycle: PlayableCycle | null | undefined,
  hasCachedAudio: HasCachedAudio,
): boolean => {
  const required = requiredClipUrls(cycle)
  if (required.length === 0) return false
  return required.every((u) => {
    const id = audioIdFromUrl(u)
    if (!id) return false // blank or unparseable — the hole this closes
    return hasCachedAudio(id)
  })
}
