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

// ─────────────────────────────────────────────────────────────────────────────
// LISTENING LAPS (pods + Layer-1 cups)
//
// Tom, iPhone, airplane mode, Spanish, 2026-08-31: "it should probably NOT try
// and play the listening exercises - its doing that now and its got stuck in a
// loop" ... "play what you have means play whatever cycles you have COMPLETELY
// and not keep fucking well trying to play listening exercises you havent got"
// ... "its stuck in a listening exercise loop of death now".
//
// The main cycle walker has fed through `isCyclePlayableOffline` since
// 2026-08-15, but listening laps never went near it. A lap was assembled from
// POSITION alone — which cup the wheel is on, which pod the ratchet is at — and
// handed straight to playPodSegment, which builds `/api/audio/<id>` and plays
// it. Offline, that request fails; the audio element's `error` event routes
// through `_notifyEnded`, which the lap reads as a NATURAL end. So every play
// "succeeded" instantly, in silence, the lap "completed", the round resumed,
// and the next boundary fired the next cup. Forever. Nothing sounds, nothing
// advances, nothing can be escaped — a loop whose retried condition (the clip
// arriving over a network that isn't there) can never become satisfiable.
//
// The rule is the same one the cycle gate already obeys, applied one level up:
// SELECTION IS WHERE AVAILABILITY IS DECIDED. A sentence whose audio is not on
// this device is not "a sentence that will fail" — it is not a candidate.
//
// The unit is the SENTENCE, not the individual play. A pod sentence sounds as
// a four-slot sandwich (target · known · target · target) and a half-cached
// sandwich is a broken exercise, not a degraded one — so a sentence survives
// only if EVERY one of its plays is on the device. That is "play whatever
// cycles you have COMPLETELY".
// ─────────────────────────────────────────────────────────────────────────────

interface LapPlayLike {
  /** Which sentence this play belongs to — the completeness unit. */
  sentenceIdx?: number | null
  audioId?: string | null
}

interface LapLike {
  intro?: { id?: string | null } | null
  outro?: { id?: string | null } | null
  plays: LapPlayLike[]
}

/** Is this clip actually on the device? Blank/absent ids fail closed. */
const clipOnDevice = (id: string | null | undefined, hasCachedAudio: HasCachedAudio): boolean =>
  typeof id === 'string' && id.length > 0 && hasCachedAudio(id)

/**
 * Reduce a listening lap to the sentences this device can sound COMPLETELY.
 *
 * Returns null when nothing survives — which means the lap must not be fired
 * at all. A null here is the difference between "skip this listening exercise
 * and carry on with the course" and the loop of death.
 *
 * Bookends (intro/outro) are dropped individually when their clip is missing:
 * a cup with its sentences on the device is still worth playing without its
 * "now just listen for a while…" wrapper, and the wrapper alone never was the
 * exercise.
 */
export const filterLapToDeviceAudio = <T extends LapLike>(
  lap: T | null | undefined,
  hasCachedAudio: HasCachedAudio,
): T | null => {
  if (!lap) return null
  const plays = Array.isArray(lap.plays) ? lap.plays : []
  if (plays.length === 0) return null

  // A play with no sentenceIdx is its own unit — it can't be grouped with
  // anything, and grouping every such play together would let one missing clip
  // delete unrelated material.
  const keyOf = (p: LapPlayLike, i: number) =>
    p?.sentenceIdx == null ? `solo:${i}` : `s:${p.sentenceIdx}`

  const complete = new Map<string, boolean>()
  plays.forEach((p, i) => {
    const key = keyOf(p, i)
    const ok = clipOnDevice(p?.audioId, hasCachedAudio)
    complete.set(key, (complete.get(key) ?? true) && ok)
  })

  const kept = plays.filter((p, i) => complete.get(keyOf(p, i)) === true)
  if (kept.length === 0) return null

  return {
    ...lap,
    intro: clipOnDevice(lap.intro?.id, hasCachedAudio) ? lap.intro : null,
    outro: clipOnDevice(lap.outro?.id, hasCachedAudio) ? lap.outro : null,
    plays: kept,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BELT AVAILABILITY OFFLINE
//
// Tom, 2026-08-31, after belt-skipping to Blue in airplane mode and landing in
// the loop: "perhaps belt skip should NOT work when unexpected offline and no
// new LEGOS are available".
//
// His Blue-belt landing round is S0084L01 — "dijo", he said — and the old test
// was `cycles.some(playable)`: ONE cached cycle anywhere in that round marked
// the whole belt available. Its spaced-repetition cycles draw on older
// material that WAS on his phone, so the belt read green while the LEGO it
// exists to teach was not there at all. He tapped it, and the app spent
// thirteen minutes parked on a phrase it could not sound.
//
// So the question is asked about the cycles that TEACH the new LEGO, and it is
// asked of ALL of them: a half-cached debut is a LEGO you cannot be taught.
// ─────────────────────────────────────────────────────────────────────────────

/** Cycle types that teach a round's own new LEGO, rather than recycling older
 *  material. `spaced_rep`, `use`, `listening`, `pod` and the listen bookends
 *  are deliberately absent — reaching only those is reaching no new LEGOs. */
export const NEW_LEGO_CYCLE_TYPES: ReadonlySet<string> = new Set([
  'intro', 'debut', 'build', 'component_intro', 'component_practice',
])

interface TypedCycle extends PlayableCycle {
  type?: string | null
}

/**
 * Can a learner actually be taught this round's new LEGO from what is on the
 * device? FAILS CLOSED: no teaching cycles at all (round absent, or nothing
 * but review) is NO, exactly like a missing clip.
 */
export const roundTeachesOffline = (
  cycles: readonly (TypedCycle | null | undefined)[] | null | undefined,
  hasCachedAudio: HasCachedAudio,
): boolean => {
  const teaching = (cycles ?? []).filter(
    (c): c is TypedCycle => !!c && NEW_LEGO_CYCLE_TYPES.has(String(c.type)),
  )
  if (teaching.length === 0) return false
  return teaching.every((c) => isCyclePlayableOffline(c, hasCachedAudio))
}
