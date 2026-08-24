# Versioned clip swap — does it reach a real learner?

**Date:** 2026-08-07 · **Build under test:** `ssi-learning-app-git-dev-zenjin.vercel.app` (dev, HEAD at time of run) · **Course:** `fra_for_eng` · **Method:** headless Chromium against the live dev deployment, read-only on data.

---

## Verdict

**Yes — cold and warm.** A swapped clip reaches a real learner in the app. On a cold profile, **43 of 43** revised-clip requests carried their `.vN` suffix and **none** was bare. On a deliberately poisoned warm cache — a bogus 4,242-byte blob planted in IndexedDB `ssi-audio-cache-v2` under the **bare uuid**, plus the bare-uuid URL primed into the HTTP cache — the learner still fetched `02cb6246-….v2` fresh and got the correct **9,216 bytes**. The bogus blob was never served. The key genuinely changed.

**One real finding, and it is a race, not a hole.** The returning-learner cache fast path (`LearningPlayer.vue`, "CACHE FAST PATH") reads the cached script **without waiting** for the freshness check that is supposed to drop a stale one. For the *current* swap this cannot bite — the `SCRIPT_VERSION` bump to `v10` orphans every pre-fix script outright, which I verified. It is the *next* swap that is exposed: a device holding a `v10` script cached before that swap depends solely on the `audio_stamp` lane, and that lane loses the race about two times in three in my runs.

**Hot-path sites still building a bare-id URL: 4.** None of them is currently serving a revised clip — the listening-pod inventory has **zero** overlap with the revised set in either `fra_for_eng` or `deu_for_eng` — so all four are latent, not live breaks.

---

## 1. Re-verified census (against HEAD, 2026-08-07)

### Sites that carry the versioned ref — OK

| Site (file:line) | Builds | Ref source | Hot path? | Verdict |
|---|---|---|---|---|
| `providers/generateLearningScript.ts:490-496` | stamps fetched rows | `revisedAudioRefs.fetchRevisedAudioRefs` | yes | OK — this is the client-side source of truth |
| `providers/generateLearningScript.ts:882` | presentation id | `applyAudioRef(revisedAudioRefs, …)` | yes | OK — stamped separately, after the bulk pass |
| `providers/toSimpleRounds.ts:24` | `/api/audio/${uuid}` | stamped script item | yes | OK |
| `providers/backendCyclesToRounds.ts:50` | `/api/audio/${uuid}` | `/cycles` response | yes | OK |
| `components/LearningPlayer.vue:3370-3371, 4363, 4486` | `/api/audio/${id}` | stamped script item | yes | OK |
| `composables/useInstantPlayback.ts:409, 471` | prefetch `fetch('/api/audio/…')` | `BackendCycle.audio.*_id` from `/cycles` | yes | OK — server-stamped before it arrives |
| `cache/AudioCache.ts:105` | `/api/audio/${id}` and the **IndexedDB key** | the ref string its caller passes | yes | OK — keying on the ref is exactly what makes a swap land |
| `cache/resolvePlaybackUrl.ts` | playable URL | passes the ref through | yes | OK |
| `playback/bulkAudioDownload.ts:301` → `api/audio/batch-urls.ts:82-87` | presigned S3 batch | ref list; `isValidAudioId` accepts `.vN` (`audioAccess.ts:134`) | yes (offline) | OK — results keyed by ref, cached via `ensureFromUrl(ref, url)` |
| `api/_utils/audioAccess.ts:290-300` | per-revision `s3_key` | `parseAudioRef` + `resolveRevisionS3Key` | yes | OK — batch path pins the exact revision |
| `api/audio/[audioId].ts` + `audioAccess.ts:106,119,200` | S3 fetch | `AUDIO_REF_REGEX` | yes | OK — verified live, see §2 |
| `api/courses/[code]/cycles.ts:335-336`, `infplay-cycles.ts:259,275`, `bundle.ts:458+` | stamps rows | `stampRowAudioRefs` | yes | OK |
| `packages/player-vue/vite.config.js:174-188` | — | — | — | **N/A now** — the SW no longer caches audio at all. The old census's Workbox `CacheFirst` on `/api/audio/*` is gone; `runtimeCaching` covers navigation and fonts only. Several code comments still describe the removed SW audio cache (`LearningPlayer.vue:2211`, `ListeningOverlay.vue:1100`) — stale prose, not stale behaviour |
| `composables/useScriptCache.ts:28, 61` | cache key `v10:<course>` | `SCRIPT_VERSION` | yes | OK — see §5 |

### Sites still building from a bare id — FINDINGS

| Site (file:line) | Builds | Ref source | Hot path? | Verdict |
|---|---|---|---|---|
| `composables/usePodLapScheduler.ts:431, 436` | its own walk of `listening_pod_sentences` + `course_audio` | **bare** — never passes through `revisedAudioRefs` | yes (listening) | **FINDING 1** |
| `composables/useLayer1Scheduler.ts:675` | `fetch('/api/audio/${id}')` | pod lap ids (bare, from above) | yes (listening) | **FINDING 1** |
| `components/ListeningOverlay.vue:1090, 1368` | `/api/audio/${audioId}?courseId=…` | pod audio ids (bare) | yes (listening) | **FINDING 1** |
| `components/PronunciationOverlay.vue:293` | `/api/audio/${audioId}?courseId=…` | its own walk of `course_practice_phrases` (`:187`) | yes (overlay) | **FINDING 2** |
| `providers/CourseDataProvider.ts:322` | `/api/audio/${audioId}?courseId=…` | its own `course_audio` walk (`:358, :560`) | welcome / presentation lane | **FINDING 3** |
| `composables/useFullCourseScript.ts:82` | `/api/audio/${id}?courseId=…` | own walk | no — `CourseExplorer` QA screen | low priority |
| `components/PodStageAuditioner.vue:207` | `el.src = /api/audio/${it.audioId}` | own walk | no — authoring/QA tool | low priority |

Client-side stamping has exactly **one** entry point (`generateLearningScript.ts:17`); every other client walk of Supabase is unstamped by construction. That is the shape of all five findings above.

---

## 2. API layer — independently re-verified

```
/api/audio/02cb6246-aef6-4880-ac88-039f5b579522      → 200, 9216 bytes, md5 25275e47df77
/api/audio/02cb6246-aef6-4880-ac88-039f5b579522.v1   → 200, 9504 bytes, md5 142ccbe74e14
/api/audio/02cb6246-aef6-4880-ac88-039f5b579522.v2   → 200, 9216 bytes, md5 25275e47df77
```

Distinct revisions, distinct bytes, bare resolves to current. `Cache-Control: public, max-age=31536000, immutable` on all three — which is precisely why the ref string has to change.

Live DB state at run time: `fra_for_eng` carried 57 revised clips when I started and **135** by the end of the session — a swap job was running throughout. Those revisions sit on **seed 1, LEGOs 1-5** (`je veux`, `parler`, `français`, `avec toi`, `maintenant`), so round 1 is guaranteed to touch them. I watched two clips move `.v2 → .v3` between my cold and warm runs; the app picked up the new ref both times without intervention.

---

## 3. Test 1 — COLD cache · **PASS**

Fresh browser profile, no priming. Guest picks French, plays 60 s from round 1.

```json
{ "totalAudioResponses": 292, "revisedClipResponses": 43,
  "stamped": 43, "BARE_revised": 0, "bareRefs": [],
  "namedClip": [{ "ref": "02cb6246-….v2", "status": 200, "bytes": 9216 }] }
```

Sample of the captured request refs:

```
2430014c-9896-41de-b4c4-2e9cd096aea9.v3   23f0b09d-99e5-48fa-a40b-45bdec7ba167.v2
ee7b10ae-db59-44b4-9eb8-165ec8d56aba.v2   3d1db0c0-1af9-46d3-9347-775b8e26d313.v2
e3fc37e2-8f8a-4b02-b858-362a9be2bb1a.v2   02cb6246-aef6-4880-ac88-039f5b579522.v2
```

Every revised clip the learner touched was requested at its version, and Tom's named clip came back at 9,216 bytes — the new revision.

---

## 4. Test 2 — WARM cache · **PASS** (the one that matters)

Primed **before** the app ran, on the app's own origin:

1. **HTTP cache** — fetched `/api/audio/<bare uuid>` for four seed-1 revised clips, storing the immutable response under the bare URL.
2. **IndexedDB `ssi-audio-cache-v2`** — planted a **bogus 4,242-byte blob** under each of those four **bare uuid** keys, with a valid row shape (`lifecycle: 'persistent'`). If anything ever plays it, the key did not change.

Then played French from round 1.

```json
{ "totalAudioResponses": 278, "revisedClipResponses": 43,
  "stamped": 43, "BARE_revised": 0,
  "namedClip": [{ "ref": "02cb6246-….v2", "status": 200, "bytes": 9216 }] }
```

IndexedDB afterwards, for the four primed ids:

```
02cb6246-aef6-4880-ac88-039f5b579522        4242 B   ← the bogus blob, untouched
02cb6246-aef6-4880-ac88-039f5b579522.v2     9216 B   ← fetched fresh, played
e3fc37e2-8f8a-4b02-b858-362a9be2bb1a        4242 B   ← bogus, untouched
e3fc37e2-8f8a-4b02-b858-362a9be2bb1a.v2     9504 B   ← fetched fresh, played
54355041-0114-4d7e-86ed-4c5fd471b1c0        4242 B   ← bogus, orphaned
1ee9da19-8e36-4965-b3a1-6dc9d8edc8c5        4242 B   ← bogus, orphaned
```

Both keys coexist and the versioned one is the one that got fetched and played. This is the direct proof Tom asked for: the poisoned bare-uuid entry is bypassed, not consulted.

**Honest limit on the HTTP-cache leg.** I primed the HTTP cache with the bare-uuid URL, but the server currently serves the *current* bytes at the bare URL, so that leg only proves a *different URL* is requested — it cannot prove stale bytes were bypassed, because I have no way to make the live server return old bytes at a bare URL. The IndexedDB leg is the load-bearing proof of stale-byte bypass, and it is unambiguous.

---

## 5. Test 3 — the script-cache fast path · **PASS for this swap, FINDING for the next**

The returning-learner path hydrates `SimplePlayer` straight from the cached script, pre-empting `/cycles`. Two invalidation mechanisms exist in `useScriptCache.ts`, and I tested both by planting a **downgraded** script — the real cached script with every `.vN` suffix stripped out of its `/api/audio/…` URLs.

The cached script stores **full proxy URLs**, e.g. `"audioUrl": "/api/audio/57a00636-….v2"`, not bare ref strings. A live `v10:fra_for_eng` entry held **669 versioned refs** — client-side stamping reaches the cache intact.

**(a) `SCRIPT_VERSION` bump — PASS.** Planted 668 stripped refs under the old key `v9:fra_for_eng` and deleted the `v10` entry. The app ignored it, regenerated, and played **7/7 revised clips stamped, 0 bare**. Every pre-fix script on every real device is a `v9` entry, so this retires all of them.

**(b) `audio_stamp` lane — RACE.** Planted the stripped script under the **current** `v10` key with a stale stamp marker (`2000-01-01`), i.e. exactly the shape of a device that cached before a future swap. Three runs, same build, minutes apart:

| Run | Refs requested after reload | Outcome |
|---|---|---|
| 1 | 41 bare / 2 stamped | stale script served |
| 2 | 41 bare / 2 stamped | stale script served |
| 3 | 0 bare / 2 stamped; `v10:fra_for_eng` deleted from IndexedDB; marker advanced to the live stamp | lane fired in time |

The mechanism is in the code, not a guess. `checkContentVersion` is fired **fire-and-forget** — `void checkContentVersion(client, code)` at `App.vue:274` — and the cache fast path calls `await getCachedScript(courseCode.value)` at `LearningPlayer.vue:12285` **without** awaiting it. The helper that would close this, `awaitFreshnessCheck` (`useScriptCache.ts:196`), exists and is called in exactly one place: the SWR revalidation path at `LearningPlayer.vue:6051` — never before the fast-path read. So whether the drop lands before the hydration is a race between a Supabase round-trip and an IndexedDB read, and the round-trip usually loses.

**Why this is not a live bug today:** the `v10` bump means no real device can currently hold a bare-uuid script under the `v10` key. The exposure opens at the *next* swap, when devices hold `v10` scripts predating it and the `audio_stamp` lane is the only guard.

---

## Findings

**FINDING A — the cache fast path does not wait for the freshness check.** `LearningPlayer.vue:12285` reads the cached script without awaiting the in-flight `checkContentVersion` fired at `App.vue:274`; `awaitFreshnessCheck` exists but is only used by SWR revalidation (`LearningPlayer.vue:6051`). Observed live: 2 of 3 runs served a stale script whose `audio_stamp` marker was demonstrably stale. Masked for the current swap by the `v10` `SCRIPT_VERSION` bump; live from the next swap onward. The audio lane is the one that "DROPS the script cache rather than marking it stale" by its own comment (`useScriptCache.ts:445`) — an awaited drop is what would make that comment true.

**FINDING B — the listening-pod lane never gets stamped.** `usePodLapScheduler.ts:431,436` runs its own `listening_pod_sentences` + `course_audio` walk and does not import `revisedAudioRefs`; its bare ids flow to `useLayer1Scheduler.ts:675` and `ListeningOverlay.vue:1090,1368`. Latent only: pod audio has **zero** overlap with the revised set today — `fra_for_eng` 570 pod clip ids vs 135 revised → 0; `deu_for_eng` 643 vs 1,319 → 0. It becomes a live stale-audio bug the first time a pod clip is swapped.

**FINDING C — `PronunciationOverlay.vue:293` and `CourseDataProvider.ts:322` build URLs from their own unstamped walks.** Same class as B, smaller blast radius. `CourseDataProvider`'s welcome/presentation lane is the one worth checking against any presentation-audio swap.

**FINDING D — stale comments describe a service worker audio cache that no longer exists.** `LearningPlayer.vue:2211` and `ListeningOverlay.vue:1100,1804-1806` still reason about "the SW CacheFirst layer for `/api/audio/*`"; `vite.config.js:174-188` removed it. Harmless today, but it is exactly the kind of comment that makes the next person reason about the wrong cache layer.

---

## Explicit gaps

- **Listening pods were not exercised in the browser.** The probe played the main learning loop for 60 s; it never opened the listening overlay. Finding B is established from code plus a DB overlap query, **not** from observed traffic.
- **The HTTP-cache stale-bytes case could not be reproduced** against a live server that serves current bytes at the bare URL (§4).
- **One course, one browser.** `fra_for_eng` on headless Chromium against dev. No iOS Safari run, no `staging`/`main` run. The IndexedDB and HTTP-cache mechanisms are engine-independent, but Safari was not exercised.
- **The live DB moved under the tests** — `fra_for_eng` went from 57 to 135 revised clips mid-session and two clips advanced `.v2 → .v3`. Counts across sections are therefore point-in-time, not mutually consistent.

---

## Reproducing

```bash
cd packages/player-vue
LD_LIBRARY_PATH=$HOME/.pwlibs/root/usr/lib/x86_64-linux-gnu \
CHROME_BIN=$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
PHASES=cold,warm,script node e2e/versioned-clip-cache-probe.mjs
```

`PHASES` selects `cold` / `warm` / `script`; `VARIANTS` selects the script-cache variants (`v9`, `v10-stamp-defeated`, `v10-stamp-stale`). Full results land in `/tmp/versioned-clip-cache-results.json`. The probe reads no credentials — the 58 revised `fra_for_eng` clip ids are frozen into `e2e/fixtures/fra-revised-ids.json`.
