# Audio revision cache-bust — learner-side contract

**Branch:** `feat/audio-revision-cache-bust-2026-08-05` (off `chore/schema-snapshot-db-perf-2026-08-04`). Not merged, not deployed.
**Date:** 2026-08-05

## The problem this solves

Repaired audio is swapped **in place at the same `course_audio.id`**. The id must not change — a new one CASCADEs into `lego_introductions` and destroys authored intro scripts.

But `/api/audio/:id` is served `Cache-Control: public, max-age=31536000, immutable`, with a service-worker CacheFirst layer over it and an IndexedDB blob cache keyed on the bare id. A device that already played the damaged clip holds those bytes for a **year**. Under that header a same-id byte swap never reaches it.

## The fix

The **URL** carries the revision, so the URL becomes the cache key:

```
/api/audio/<id>            unrepaired  (revision 1 — unchanged from today)
/api/audio/<id>?v=<rev>    repaired
```

`immutable` **stays**, and is now strictly true: a given id+revision names bytes that never change. A repair simply produces a URL no cache has ever seen. The fast path is untouched.

## What the dashboard side must provide

```sql
course_audio.audio_revision  integer NOT NULL DEFAULT 1
```

Bumped by 1 **every time** a clip's bytes are replaced in place. The id never changes.

Until that column exists, the lookup fails, logs a warning, caches an empty map and the app serves bare URLs — i.e. exactly today's behaviour. Nothing breaks while the two halves land out of step.

## The wire contract (design call — this is the bit to match)

Routes attach **one top-level field**, not a `*AudioRev` sibling next to each audio id:

```jsonc
{
  "course_code": "deu_for_eng",
  "cycles": [ /* ... */ ],
  "audioRevisions": { "<audio-uuid>": 2, "<audio-uuid>": 5 }
}
```

- **Repaired clips only** (`audio_revision > 1`). Revision 1 is the implicit default for every clip; recording it would emit `?v=1` course-wide and invalidate every cache on the planet to serve identical audio.
- The field is **absent** when nothing has been repaired — the normal case.
- Emitted by `/api/courses/:code/cycles`, `/infplay-cycles` and `/bundle`.

**Why one map rather than per-id fields:** same information, one field instead of ~8 per row, no per-row assembly changes anywhere, and it stays a near-empty object in the normal case. Audio ids are UUIDs, so a revision means the same thing regardless of which payload carried it.

**Why a separate lookup rather than widened SELECTs:** `cycles.ts` gets its audio ids from the `get_course_cycles_window` RPC, not a SELECT; and the routes that do SELECT read the denormalised `*_audio_id` columns on `course_legos` / `course_practice_phrases`, which carry the id but not the revision. The revision lives on `course_audio`. Every route needed a `course_audio` lookup regardless of its shape.

**Why it costs nothing:** the lookup keys on `course_code`, not on the ids, so it rides each route's **existing `Promise.all` batch** — no extra round-trip on the instant-playback critical path. It queries only repaired clips (usually zero rows) and is memoised per course for 60s.

## Backward compatibility

An id with no known revision emits the bare URL. That is the **correct answer, not a fallback**: an unrepaired clip's bare URL is what every existing cache already holds, and re-fetching it would be pure churn.

- old cached payloads (no field) → bare URL, cache hit
- a route not yet widened → bare URL, cache hit
- a clip never repaired → bare URL, cache hit
- a clip repaired since the device last played → `?v=2`, cache miss, heals

## IndexedDB admission rules

The `?v=` URL busts HTTP and SW caches, but `AudioCache` keys IndexedDB on the bare id. Rules:

| wanted (from backend) | stored | verdict | why |
|---|---|---|---|
| same | same | **hit** | no pointless refetch |
| higher | lower | **miss** → refetch, overwrite | the repair lands |
| known | **unknown** | **miss** | cached before revisions existed, so it may *be* the repaired clip |
| **unknown** | any | **hit** | offline / pre-revision payload. Never invalidate on ignorance |
| lower | higher | **hit** | never downgrade |

Supporting behaviour:
- A stale row is **overwritten, never pre-deleted** — a failed refetch (offline) still leaves `getBlobUrl` serving the old bytes. Clipped audio beats silence.
- The decoded-WAV cache is keyed by id too and is **revoked on overwrite**, else offline keeps playing the repaired-away audio.
- In-flight de-dupe is keyed by **id + revision**, so a fetch started before the repair can't satisfy a request made after it.
- **No `DB_VERSION` bump** — `audioRevision` is an optional field on the existing store, so no migration is needed, and bumping would force an upgrade transaction on every device for nothing.

## Known caveat worth a decision

`/api/courses/:code/bundle` is served `s-maxage=86400`, so a repaired revision could sit behind the shared Vercel edge cache for up to a day before reaching new callers. `/cycles` is `private, max-age=60` and unaffected. `/bundle` has **no client consumer yet** (pre-cutover), so this is not live today — but it's the one place where the repair could lag by a day once the cutover happens. Left as-is rather than silently weakening a caching decision someone made deliberately.

## Verification

| Gate | Result |
|---|---|
| `@ssi/core` tests | 618 pass, 9 skipped |
| `player-vue` tests | 1316 pass, 3 skipped |
| API tests | 774 pass |
| `player-vue typecheck` | clean |
| `typecheck:api` | clean |
| `player-vue lint` | 0 errors (147 pre-existing warnings — the documented baseline) |

Nothing is deployed. No live-DB verification was possible: `audio_revision` does not exist yet.
