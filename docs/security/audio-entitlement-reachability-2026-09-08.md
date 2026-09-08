# Is paid audio actually reachable without paying?

**Job #487. Probed live against production (`saysomethingin.app`) on 2026-09-08. Read-only.**

## Verdict in one line

Yes — and the audio proxy's fail-open entitlement gate is the *least* of the three
reasons why. **Arming `ENTITLEMENT_ENFORCE=strict` today would break playback for
paying subscribers and would still leave 96% of the course open.** Do not arm it.

---

## Step 1 — is the lead real? Yes, proven against production

The per-clip proxy `GET /api/audio/:id` serves premium, past-preview audio to a request
carrying no credentials of any kind.

```
$ curl -D- https://saysomethingin.app/api/audio/58f88665-cf6d-4a46-b49d-c21d3344e644
HTTP/2 200
content-type: audio/mpeg
x-ssi-entitlement: no-token-open      <-- the fail-open tag, from the code itself
content-length: 23904
```

That clip is `spa_for_eng`, `lego_id = S0100L03`, role `target1`, text "parecido" — seed 100,
five belts past the free cap of seed 19, in a Big-10 premium course. The body is a real
MP3 (`ff fb` MPEG frame sync, 23,904 bytes). No cookie, no bearer, no `?et=` token, no
session. The `x-ssi-entitlement: no-token-open` header is the server telling us, in its own
words, that it classified the clip as gated and served it anyway.

Mechanism, confirmed in code: `api/_utils/audioAccess.ts:429` reads `ENTITLEMENT_ENFORCE`,
which is absent in production, so `resolveAudioEntitlement` returns
`{ allowed: true, gated: true, tag: 'no-token-open' }` and `api/audio/[audioId].ts` streams
the bytes.

## Step 2 — how much does it matter? World (b), decisively, and worse than the brief assumed

The brief asked whether an attacker must already know a UUID (theoretical) or whether UUIDs
are discoverable (serious). They are not merely discoverable — **the entire course catalogue,
text and audio ids and S3 keys, is readable anonymously with the publishable key that ships
in the production JavaScript bundle.**

**The key is public by construction.** `https://saysomethingin.app/assets/index-CRhyZblb.js`
contains the Supabase publishable key. That is normal for a Vite app; what matters is what
the key can read.

**It reads the whole course.** With that key alone, unauthenticated:

```
GET /rest/v1/course_legos?select=lego_id,known_text,target_text,known_audio_id,target1_audio_id&lego_id=like.S0300*
→ every course in the estate, seed 300, with known text, target text and audio UUIDs
```

`course_seeds` (85,110 rows), `course_legos` (97,566 rows), `course_practice_phrases` and
`course_audio` are all anon-readable with no belt cap. `course_audio` rows carry `text`,
`role`, `lego_id` **and `s3_key`**.

**And the S3 bucket is public.** Given an `s3_key` from that table, the bytes come straight
from AWS with no application in the path at all:

```
$ curl https://ssi-audio-stage.s3.eu-west-1.amazonaws.com/mastered/8B7D54E6-....mp3
200, 23904 bytes, md5 ddcff4108b2660a6804736b6eaf1ba1c
```

— byte-identical to what the proxy served. Bucket *listing* is denied (`AccessDenied`), which
is the one mercy, but listing is unnecessary when the keys are handed out by PostgREST.

So there are three doors, not one:

| | Door | Status | Load-bearing for real learners? |
|---|---|---|---|
| D1 | Anon PostgREST read of `course_seeds` / `course_legos` / `course_practice_phrases` / `course_audio` | wide open, no belt cap | **Yes** — `CourseDataProvider` and the client script generator read these directly with the anon key. The gated `/api/courses/:code/bundle` replacement exists but `useCourseBundle.ts` says it is **DARK**: "nothing here changes what any learner hears." |
| D2 | Public-read S3 bucket `ssi-audio-stage` | wide open | **Yes** — `LearningPlayer.vue:4064`, `CourseExplorer.vue:133`, `useScriptCache.ts:877` build direct S3 URLs as a live fallback path |
| D3 | `/api/audio/:id` fail-open entitlement gate | wide open | this is the one the lead found |

**Closing D3 alone buys nothing.** D1 gives the ids *and* the s3_keys; D2 gives the bytes.
A scraper that never touches our API at all gets the same course.

## Step 3 — the fix, and why the obvious one is the wrong one

### Arming `ENTITLEMENT_ENFORCE=strict` would break paying customers

There is still **no subscriber token mint**. The only site that mints an entitlement token is
`api/try-link/validate.ts` (the demo/sales link flow). The client builds every per-clip URL as
`apiUrl('/api/audio/' + id)` (`cache/AudioCache.ts:107`) and **never appends `?et=`** — the
try-link token is attached only on the bulk-download call (`bulkAudioDownload.ts:364`).

So under strict mode, for premium content past seed 19:

- **every paying subscriber** gets `403 Premium content requires an active subscription` on
  any clip not already in their device cache;
- **try-link demo visitors** break too, because the per-clip URL carries no token either;
- breakage is *creeping and hard to spot in testing* — service-worker CacheFirst and the
  IndexedDB WAV cache keep already-heard clips playing, so a tester's device looks fine while
  a new learner's does not;
- offline bulk download degrades rather than breaks: `batch-urls` denials already fall back to
  the per-clip proxy — but that fallback is exactly what would now 403.

The free belts (seeds 1–19), community courses and all shared/meta audio are never `gated`,
so they would be unaffected. That is the only good news in the paragraph.

### And it would not even work

The gate can only classify a clip when `course_audio.lego_id` is populated. On `spa_for_eng`
it usually is not:

| `course_audio` rows, `spa_for_eng` | count |
|---|---|
| total | ~79,950 |
| carrying a `lego_id` | **2,788** (3.5%) |
| carrying a `lego_id` past seed 19 | **2,641** |

`seedFromLegoId(null)` returns null, `pastPreview` is false, and the gate fails open *by
design* ("never lock out on ambiguity"). Confirmed live: the clip
`2d41f118-d40c-42b3-849b-62828c82f7b0` (`spa_for_eng`, "parecer", reached from a seed-300
lego row) has `lego_id: null`, and the proxy served it with **no** `x-ssi-entitlement` header
at all — it was never even classified as gated.

**So arming the flag would 403 those 2,641 clips for real payers while leaving the other
~96% of the course anonymously readable.** Worst of both worlds. That is why no code change
lands in this job: there is no small change to the proxy that closes anything.

### The safe sequence, cheapest-first

1. **Backfill `course_audio.lego_id`.** Until the gate can classify a clip it cannot decide
   about it, in either direction. This is content-side work in the Dashboard repo and is a
   precondition for every later step. Harmless on its own.
2. **Privatise the S3 bucket (D2).** `batch-urls` already presigns and the proxy already uses
   credentials, so the server paths are unaffected — but the three client files above build
   raw public URLs and must be repointed at `/api/audio/:id` first. Cheap, and it closes the
   door that bypasses our application entirely.
3. **Land the bundle cutover and close anon reads (D1).** `useCourseBundle` is built and dark
   precisely for this. Until the client stops reading `course_legos` with the anon key, the
   belt cap is client-side decoration. This is the step that actually protects the content.
4. **Mint subscriber entitlement tokens** — server-side, resolving through
   `familyAccess.resolveEffectiveSubscription` like every other entitlement reader — and have
   the client append `?et=` to per-clip URLs. Ship it while the flag is still off: it is inert
   under fail-open, so it can soak.
5. **Only then arm `ENTITLEMENT_ENFORCE=strict`**, after watching `x-ssi-entitlement` tags in
   logs fall to near-zero on real traffic. The tag exists to answer exactly this question.

### How much does the leak cost, honestly

Not nothing, and not a five-alarm fire. Nobody's account, payment or personal data is exposed
here — the blast radius is course content: MP3s and their text. The realistic loss is a
competitor or a non-payer scraping a full course in an afternoon with a shell script, which
is a commercial harm, not a safety one. It should be fixed in the order above, on the normal
train, not by an emergency flag flip that breaks the people who *are* paying.

## Explicit gaps

- I did **not** read the Vercel production env directly (four prior audits have wanted this).
  I did not need to: the live `x-ssi-entitlement: no-token-open` response header is emitted
  only on the fail-open branch, which proves `ENTITLEMENT_ENFORCE` is not `strict` in
  production more directly than an env listing would.
- Row counts above are `Prefer: count=exact` on `spa_for_eng`; the "~79,950 total" is exact for
  that course only. I did not census other courses.
- Credential borrowing, declared: I used the Supabase **publishable/anon** key from
  `.env.local`, read-only, and verified it matches the key in the deployed production bundle.
  No writes of any kind were made, and no privileged credential was used.
