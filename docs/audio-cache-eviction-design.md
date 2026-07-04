# AudioCache eviction — design proposal (for discussion)

**Status:** proposal, not built. Raised by the 2026-07-04 code review (unbounded
IndexedDB audio growth: `evictToTarget` exists but is called nowhere). Tom's
steer: evict content well behind the learner's position, re-fetch on demand from
S3, but *never* touch audio a learner intentionally downloaded for offline.

This is deliberately **not** implemented yet — the trigger cadence and the safety
margin want a decision first (open questions at the end).

---

## What we already have (good news — the model fits the idea)

`packages/player-vue/src/cache/AudioCache.ts` already stores every clip in one
IndexedDB store keyed by audio id, with a **`lifecycle`** column that is exactly
the distinction we need:

- **`persistent`** — audio a learner *chose* to download for offline (via the
  offline-download / lease flow). Tracked in `persistentIds`, indexed
  `by-lifecycle`. **Eviction must never remove these.**
- **`ephemeral`** — audio cached as-it-played. Each ephemeral row carries an
  **`ephemeralOwnerLegoId`** (the LEGO whose playback pulled it in) and there is
  already a **`by-ephemeral-owner` index** on it.

So "evict everything owned by LEGOs more than N behind the current position" is a
cursor walk over the `by-ephemeral-owner` index — the data model is already
shaped for it. What's missing is (a) an ephemeral-eviction method and (b) a place
to call it. Today ephemeral audio accumulates for the lifetime of the device.

(`persistentEvictToTarget(targetBytes)` exists for the *persistent* tier but is
never called either — separate, lower-priority: persistent is bounded by what the
learner explicitly downloaded, so it's not the runaway.)

---

## The proposed policy (Tom's sketch, made concrete)

> "We build the scripts ahead of time, so we can — unless they've intentionally
> downloaded it for offline — evict once they get 100 ROUNDS beyond the LEGO.
> i.e. at LEGO 300, evict everything from 1–200, and just call any missing USE
> phrases from S3 as needed. Even N+55 is pretty safe."

Concretely:

1. **Never evict `persistent`.** Offline-downloaded content is sacred.
2. **Evict `ephemeral` audio whose owning LEGO is more than `KEEP_BEHIND`
   positions behind the learner's current position.** Walk the
   `by-ephemeral-owner` index; for each owner LEGO whose ordinal `< current −
   KEEP_BEHIND`, delete its rows and drop them from `ephemeralIds`.
3. **Re-fetch on demand.** Anything evicted that a later round *does* need (a
   spaced-rep review, an INF-PLAY random USE phrase) is just re-fetched through
   the existing `/api/audio/:id` proxy and re-cached ephemerally. The whole
   scheme is safe *because* re-fetch already works — eviction is a cache trim,
   never a correctness risk.

### Why a margin, and how big

The near spaced-rep window (N-1 ×3, N-2, N-3, N-5) only reaches back a handful of
rounds, so any `KEEP_BEHIND` ≥ ~10 avoids re-fetching those. Tom's **N+100** (and
even **N+55**) is comfortably above that. INF-PLAY draws random USE phrases from
the *whole* course, so it *will* occasionally re-fetch an evicted early phrase —
that's expected and cheap (one clip, cached again after). The margin isn't there
to prevent INF-PLAY re-fetches (impossible without keeping everything); it's there
to keep the *active learning window* fully local. **Proposed default:
`KEEP_BEHIND = 100` LEGOs.**

### Mapping "current position" to a LEGO ordinal

Eviction needs the learner's current LEGO ordinal. The listening/ordinal map
(`course_legos` seed/lego order) already gives ordinals; `ephemeralOwnerLegoId`
is a LEGO id. We compare ordinals, not ids. The position is already tracked for
playback, so the trigger has it to hand.

---

## Where it would trigger

Options (a decision for discussion):

- **A. On round boundary, throttled.** Every K rounds (say 25), call
  `clearEphemeralBehind(currentOrdinal − KEEP_BEHIND)`. Simple, self-healing,
  amortised. Preferred.
- **B. On session end.** Cheaper (once per sitting) but lets the cache peak
  during very long INF-PLAY sittings.
- **C. On a size threshold.** Only trim when the ephemeral tier exceeds X MB.
  Most conservative on writes, but needs a size query.

A + a size safety-valve (trim harder if ephemeral exceeds a ceiling) is probably
the sweet spot.

---

## Tangles to resolve at the same time

The review surfaced two related cache bugs worth folding into this work rather
than fixing blind:

1. **`AudioCache.clearCourse(courseCode)` can never delete anything** —
   `AudioCache.ts:218` stores every row with `courseCode: null` hardcoded, so the
   course-scoped clear matches nothing. It's currently only called from a test,
   so it's latent, but if we want per-course invalidation (below) we must first
   populate `courseCode` on write.

2. **`useScriptCache` content-version invalidation is both over-broad and
   incomplete.** On a course's `content_version` bump it does
   `caches.delete(AUDIO_CACHE_NAME)` — which (a) wipes the Cache-API audio store
   for *all* courses, not just the changed one, and (b) does **not** touch the
   authoritative IndexedDB `AudioCache` ('ssi-audio-cache-v2') at all, so stale
   audio in the real store survives a content bump. There are effectively **two
   audio caches** (the Cache-API `ssi-audio-v1` that `useScriptCache` manages, and
   the IndexedDB `AudioCache`); the invalidation only clears the first. The right
   fix is per-course invalidation of the *IndexedDB* AudioCache on
   `content_version` change — which depends on (1) (populating `courseCode`).

Both are small, but they share the "populate `courseCode`, then invalidate by
course" thread, so they belong with the eviction work.

---

## Rough shape (illustrative, not final)

```ts
// AudioCache
async clearEphemeralBehind(currentOrdinal: number, keepBehind = 100,
                           ordinalOf: (legoId: string) => number | null): Promise<number> {
  // Walk by-ephemeral-owner; delete ephemeral rows whose owner LEGO ordinal
  // < currentOrdinal - keepBehind. Never touch persistent rows. Returns count.
}
```
Trigger (throttled) from the round-advance path; `ordinalOf` from the existing
ordinal map.

---

## Open questions for Tom

1. **Trigger cadence** — A (every ~25 rounds), B (session end), or C (size
   threshold)? Recommendation: A + a size safety-valve.
2. **`KEEP_BEHIND`** — 100 LEGOs (your number), or tighter (55) to reclaim more?
3. **Persistent tier** — leave `persistentEvictToTarget` unused for now (bounded
   by explicit downloads), or also wire a generous cap?
4. **Fold in the two cache tangles** (clearCourse `courseCode`, per-course
   content-version invalidation) as part of this, or track separately?
