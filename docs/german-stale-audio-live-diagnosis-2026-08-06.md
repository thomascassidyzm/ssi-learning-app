# German stale audio — live browser diagnosis, production

**Date:** 2026-08-06 · **Target:** `https://saysomethingin.app` (production) · **Course:** `deu_for_eng`
**Method:** real Chromium (Playwright) driving the live app, recording every `/api/audio/` request, every
IndexedDB read of the audio cache store, and every `<audio>` src, then classifying each ref against
`course_audio.audio_revision`.
**Probe:** `packages/player-vue/e2e/german-stale-audio-probe.mjs`
**Raw data:** `/tmp/german-stale-audio/refs.json`

The server chain was proven correct before this run and was NOT re-checked.

---

## Verdict

**Bucket (b) is not empty — it is the whole session.** Of 317 distinct audio refs the app requested
during a real German session, **zero carried a `.vN` suffix**. 56 of them are clips whose
`course_audio.audio_revision > 1` — revised clips being fetched, cached and keyed under a **bare uuid**.

| Bucket | Network `/api/audio/` | IndexedDB reads | IndexedDB rows written |
|---|---|---|---|
| **(a) versioned ref for a revised clip — correct** | **0** | **0** | **0** |
| **(b) BARE ref for a REVISED clip — the bug** | **56** | **7** | **34** |
| (c) bare ref for an unrevised clip — fine | 259 | 19 | 237 |
| (?) id not in `course_audio` at all | 2 | 1 | 0 |
| total distinct | 317 | 27 | 271 |

Both passes agree: PASS A (clean profile, cold caches) 246 requests, 0 versioned. PASS B (reload,
warm caches — Tom's device state) 105 requests, 0 versioned; **25/25 IndexedDB reads were hits, every
one under a bare uuid.**

For scale: `deu_for_eng` has 978 clips with `audio_revision > 1`. A 75-second session touched 56 of them.

Sample of (b) — bare ref, revised clip, repaired bytes sitting in S3 under a new key:

```
225c3047-ed25-4e2e-8bb3-05dcfc45d54b  rev=2  role=known        s3=repair-candidates/5F417854-…mp3
d3d12aa8-c4ad-49d7-9fad-c234972c24c4  rev=2  role=target1      s3=repair-candidates/71170895-…mp3
f0404e5d-4a38-4707-9ed4-5665b378b6f8  rev=3  role=known        s3=repair-candidates/0CED12D2-…mp3
b73047e9-770c-41b6-827e-b3fc4967377f  rev=2  role=presentation s3=repair-candidates/787B6A18-…mp3
```

---

## The code path that builds the bare refs

**The playing script is generated in the browser, not served by the versioned endpoints.**

Console output from the live session is the direct evidence:

```
[generateLearningScript] Skipped 11 practice phrases for "deu_for_eng" (missing audio IDs)
```

`packages/player-vue/src/providers/generateLearningScript.ts` queries Supabase from the browser and
reads the audio ids straight off the content tables:

- `course_practice_phrases` — `known_audio_id, target1_audio_id, target2_audio_id, presentation_audio_id` (line 229)
- `course_legos` — same four columns (line 392)
- `course_seeds` — `known_audio_id, target1_audio_id, target2_audio_id` (line 405)
- `listening_pod_sentences` — `target_audio_id, known_audio_id` (line 426)
- `course_audio` / `lego_introductions` presentation backfill (lines 795–822)

Those columns hold **bare uuids**. `buildAudioRef()` in `api/_utils/audioAccess.ts` — the only thing
that ever appends `.vN` — lives server-side and is applied only by `/api/courses/:code/bundle`,
`/cycles` and `/infplay-cycles`. The client script never passes through it. The bare id then becomes
the URL (`/api/audio/<uuid>`, `audioConfig.proxyEndpoint`) **and** the IndexedDB primary key
(`ssi-audio-cache-v2`, store `audio`, `keyPath: 'id'`).

**Proof the suffix is being lost rather than never existing:** the live
`/api/courses/deu_for_eng/cycles?from=S0001L01&limit=15` response returns
`225c3047-ed25-4e2e-8bb3-05dcfc45d54b.v2` — and the browser requested that exact clip
**bare**, as the 8th audio request of PASS A. 8 of the 15 instant-playback cycles carry versioned
refs; not one reached the audio layer.

### Why this defeats every layer that was supposed to save it

1. **Server correctness is irrelevant to Tom's device.** `/api/audio/<bare-uuid>` does serve repaired
   bytes — but Tom's browser never asks. The response was cached under that bare URL with
   `max-age=31536000, immutable`, so the HTTP/service-worker cache answers locally, and the IndexedDB
   row under the same bare id answers before that. Both predate the repair.
2. **The `audio_stamp` hard-drop lane works, and cannot help.** The probe confirms it fired:
   `ssi-audio-stamp-deu_for_eng = 2026-08-06T08:32:25.233215+00:00` was written. But its comment in
   `useScriptCache.ts:440-450` states it deliberately leaves the audio store alone, *because* "with
   per-clip versioned refs the repaired clips miss on their new ids and re-download by themselves".
   That premise is false on this path: the regenerated script contains the **same bare ids**, so the
   dropped-and-refetched script re-hits the identical stale IndexedDB rows and the identical
   immutable HTTP cache entries. The drop costs a JSON refetch and changes nothing audible.
3. The revised-clip miss that the whole versioned-ref design depends on **never happens** for the
   main 4-phase cycle.

This is a complete explanation of Tom's symptom, and it predicts exactly what he reports: repaired
German clips still playing old audio on a device that has played German before, indefinitely, with no
error anywhere.

---

## Second live bug found (unrelated to versioning): German halts on cycle 1

`deu_for_eng` seed 1 / lego 1, component **"I" / "Ich"**, has
`presentation_audio_id = b4cff435-0e57-4973-b319-f218d1906a33` — **that row does not exist in
`course_audio`**. `/api/audio/b4cff435-…` returns **404**.

Live console, PASS A:

```
[SimplePlayer] audio error (code=4) on phase=prompt
[SimplePlayer] Retrying audio (attempt 2/2): /api/audio/b4cff435-0e57-4973-b319-f218d1906a33
[SimplePlayer] Audio playback failed after retry — halting session
```

A cold German session **halted at the first LEGO**. A second dangling id,
`306642d0-fc02-437f-abb5-9f2077c0ca51`, also 404s but is not referenced by any
`course_legos`/`course_practice_phrases` audio column in `deu_for_eng` — source unattributed.

---

## Recommendation

The fix is to stop having two id-minting authorities. Options, in the order I'd take them:

1. **Purge, then converge.** Immediately: extend the `audio_stamp` lane to also delete the
   IndexedDB audio rows for that course (and its Cache-API `/api/audio/` entries) when the stamp
   moves. That is the only thing that heals already-poisoned devices like Tom's, and it is small.
2. **Converge the id source.** Make the browser script path apply the same revision map as the
   server — either by having `generateLearningScript` fetch the course's id→`.vN` map once (the
   query already exists, `audioAccess.ts:310-336`) and stamp its ids, or by retiring the client-side
   script generation in favour of `/api/courses/:code/bundle`, which already emits 366 versioned refs
   for German.
3. Add a guard/test that fails if any id reaching `AudioCache` for a revised clip lacks its suffix —
   otherwise this reopens silently.

Not actioned here: this report is diagnosis only, and (2) is a real architectural fork worth one
sentence from Tom before it is built.

## Explicit gaps

- Ran as a **guest** (no sign-in). Guest reached German and played, so the main cycle path is covered;
  an entitled signed-in learner may additionally exercise `/infplay-cycles`, not observed here.
- Headless Chromium, not iOS Safari. The bare-id mechanism is platform-independent, but iOS-specific
  cache behaviour was not exercised.
- Attribution of `306642d0-…` to a content row: not found.
