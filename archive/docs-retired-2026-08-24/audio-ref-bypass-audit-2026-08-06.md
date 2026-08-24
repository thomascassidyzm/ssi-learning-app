# Audio-ref bypass audit — which paths reach the player unstamped

**Audited:** `origin/dev` @ `e848e72c`, 2026-08-06. Read-only via `git show origin/dev:<path>`.
**Question:** production serves versioned refs correctly, yet Tom still hears old German. Which path reaches the player with a **bare uuid** for a revised clip?

**Answer, up front:** the **returning-learner cache fast path**. `generateLearningScript` walks Supabase directly and emits bare uuids; its output is what the script cache stores; `LearningPlayer`'s CACHE FAST PATH hydrates SimplePlayer straight from that cache and `return`s — no bootstrap, no round-map, so the tier-3 `/cycles` watcher never fires either. A returning learner plays an **entire session** without touching a stamped route. Fixed on `claude/audio-rev-script-walk` (`51fca851`).

---

## 1. How stamping is supposed to work, and where the boundary actually falls

`api/_utils/audioAccess.ts` defines the scheme: a ref is a bare uuid ("current") or `<uuid>.v<N>` ("exactly this revision"). `fetchRevisedAudioRefs(course)` builds the id → ref map; `stampRowAudioRefs` rewrites the `AUDIO_ID_COLUMNS` on fetched rows.

The scheme is **self-busting by design and it works**: the ref string IS the AudioCache key (`ssi-audio-cache-v2`, `keyPath: 'id'`, no revision awareness anywhere — verified, `git grep revision` over `packages/**` returns nothing) and it is also what every `/api/audio/${id}` site interpolates. A stamped ref misses both caches and re-downloads; a bare uuid hits both.

So the ONLY question that matters is: **does the ref arrive stamped?**

| stamped by | reaches the player via |
|---|---|
| `api/courses/[code]/cycles.ts` | instant-playback bootstrap + tier-3 near-edge rounds → `backendCyclesToRounds` |
| `api/courses/[code]/infplay-cycles.ts` | INF PLAY → `infPlayCyclesToRounds` |
| `api/courses/[code]/bundle.ts` | **nothing.** No player caller — `git grep` for a `/bundle` fetch in `packages/player-vue` returns only a comment in `core/src/script/courseBundle.ts`. Tested, not consumed. |

Everything else the player reads, it reads **straight from Supabase in the browser**, where no stamping existed at all before this fix.

---

## 2. The census table

Re-walk of `docs/audio-url-census-2026-08-06.md`'s 30 construct / 9 destructure sites, marked against `origin/dev`.

### 2a. Where audio ids ORIGINATE (the part that decides staleness)

| # | source | file:line | reaches player as | stamped? | in a normal German session? | what a learner hears |
|---|---|---|---|---|---|---|
| 1 | `/cycles` | `api/courses/[code]/cycles.ts:329-331` | `BackendCycle.audio.{known,target1,target2}_id` | **STAMPED** | yes — bootstrap + every tier-3 round, *unless the cache fast path pre-empts it* | fresh |
| 2 | `/infplay-cycles` | `infplay-cycles.ts:257-259` | same | **STAMPED** | INF PLAY only | fresh |
| 3 | `/bundle` | `bundle.ts:456-676` | — | STAMPED but **dead** | never | n/a |
| 4 | **script walk — legos** | `providers/generateLearningScript.ts:392` | `ScriptItem.{knownAudioId,target1Id,target2Id,presentationAudioId}` → `toSimpleRounds` → `/api/audio/<bare>` | **NOT STAMPED** | **YES — this is the leak** | **pre-repair bytes, permanently** |
| 5 | script walk — phrases | `generateLearningScript.ts:229` (`PRACTICE_PHRASE_COLUMNS`) | same | **NOT STAMPED** | yes | stale |
| 6 | script walk — seeds | `generateLearningScript.ts:405` | seed-phase spaced-rep + L1 listening | **NOT STAMPED** | yes (seed-phase reviews) | stale |
| 7 | script walk — listen bookends | `generateLearningScript.ts:414` (`course_audio.id`) | listening block wrap | **NOT STAMPED** | listening only | stale if that role was repaired |
| 8 | script walk — pod-0 sentences | `generateLearningScript.ts:426` | pod lap cycles | **NOT STAMPED** | pods only | stale if repaired |
| 9 | script walk — presentation backfill | `generateLearningScript.ts:795-822` | intro narration | **NOT STAMPED** | yes, on courses with unlinked presentation audio | stale |
| 10 | `listeningMetaCache.ts:237,262,273` | direct `course_audio` | listening metadata bundle | NOT STAMPED | listening mode only | stale if repaired |
| 11 | `useLayer1Scheduler.ts:422`, `usePodLapScheduler.ts:421` | direct `course_audio` bookends | prefetch + play | NOT STAMPED | listening/pods only | stale if repaired |
| 12 | `usePodStage0.ts:106`, `useListeningPods.ts:184` | direct `course_audio` (`pod_explainer`, split-clip texts) | pods | NOT STAMPED | pods only | stale if repaired |
| 13 | `ListeningOverlay.vue:844-1001` | direct `course_legos`/`course_seeds` | listening overlay | NOT STAMPED | listening mode only | stale |
| 14 | `LearningPlayer.vue:11143` | direct `course_legos` select | offline bundle id collection | NOT STAMPED | offline download | downloads *fresh* bytes under the *bare* key — masks the bug, doesn't fix it |
| 15 | welcome — `CourseDataProvider.ts:356` | `course_audio` role=`welcome` → `LearningPlayer.vue:8069` | `/api/audio/<bare>` | NOT STAMPED | once per learner, ever | stale if that clip were repaired (it wasn't) |
| 16 | `useScriptCache.ts:649,730,770` (`lookupAudioLazy` / `loadIntroAudio`) | selects `s3_key`, builds `{bucket}/{s3_key}` direct | `getAudioUrlFromCache` fallback in `scriptItemToPlayableItem` | **N/A — never carries an id at all** | fallback branch only (`hasPreloadedAudio` false, non-`component_intro`) | **fresh by accident**: `s3_key` is the post-repair key, so the bucket URL changes. Bypasses `/api/audio` and AudioCache entirely. |
| 17 | `CourseExplorer.vue:601,646-716`, `PodStageAuditioner.vue:207`, `useFullCourseScript.ts:82`, `CourseDataProvider.ts:322` | direct | admin/QA | NOT STAMPED | no — admin surfaces | stale in admin views |
| 18 | `config/audioConfig.ts`, `core/database-types.ts:325-358` | — | — | N/A | dead code, zero importers (unchanged since the census) | n/a |

### 2b. URL → id destructuring (the reverse dependency)

All 10 sites survive `.vN`. Verified independently by a parallel audit (`docs/audio-url-regex-audit-2026-08-06.md`, which executed each regex against four URL shapes) and re-checked here:

- `LearningPlayer.vue:1765,1827,1893,9410,9433,10188,10243,10393,10817` use `[^?/]+` / `[^?]+` — never excluded `.` or `v`, correct before and after.
- `LearningPlayer.vue:8253` (`extractAudioIdsFromCycle`) was the one site needing a change and already has it: `/\/api\/audio\/([0-9a-f-]+(?:\.v\d+)?)$/i` (commit `a445c5b3`).
- `api/audio/batch-urls.ts:82` filters on `isValidAudioId`, which accepts refs; presigned bulk download is ref-aware.

**This lane is closed. It is not the bug.**

---

## 3. The ranked holes

### #1 — the cache fast path (**this is Tom's symptom**) — FIXED

`LearningPlayer.vue:12162-12240`. For `inferEnrollmentMode === 'main'`, a returning learner with a populated script cache hydrates `simplePlayer.initialize(cachedScript.rounds)` and `return`s. Those rounds were built by `toSimpleRounds` from `generateLearningScript` — bare uuids for all 978 revised deu clips. And because no bootstrap ran, `instantPlayback.roundMap.value` is null, so the near-edge tier-3 watcher (`LearningPlayer.vue:1580-1596`) bails at `if (!map) return` — **no stamped content enters the session at any point.**

The chain, precisely:

1. Pre-repair, the device cached clip X's old bytes under key `<uuid>` (IndexedDB) and URL `/api/audio/<uuid>` (browser HTTP cache, `max-age=31536000, immutable`).
2. Repair bumps `audio_revision` → 2. Server ref becomes `<uuid>.v2`.
3. `/cycles` serves `.v2` → new key → fresh. ✅
4. The cache fast path serves `<uuid>` → **old key → old bytes.** ❌

**Why `audio_stamp` could not save it.** `useScriptCache.ts:458-471` drops the script cache when the stamp moves — and the code comment states the assumption out loud: *"with per-clip versioned refs the repaired clips miss on their new ids and re-download by themselves."* That is true for `/cycles` content and false for script-walk content. The drop forces a re-walk, and the re-walk emits bare uuids again. **A fresh script cache was exactly as stale as the one it replaced.** That is why the repair, the stamp and the drop lane all verified green while German still sounded old.

**Fix (shipped, `51fca851`):** `providers/revisedAudioRefs.ts` — the client twin of the server helper. `generateLearningScript` fetches the revised-ref map in parallel with its six content queries (no added latency) and stamps the rows once, before anything copies an id onto a `ScriptItem`. `SCRIPT_VERSION` v9 → v10 orphans every already-written unstamped entry. Gates: core build, player-vue typecheck/test/lint, `typecheck:api`, `test:api` — all green; 5 new tests.

### #2 — the full-script handoff re-poisons the cache

`LearningPlayer.vue:12660`. Even on a *cold* session that bootstraps correctly off `/cycles`, the background walk produces bare-uuid rounds, assigns them to `cachedRounds`, and `setCachedScript`s them. That is what the NEXT session's fast path serves. Self-perpetuating — same root cause, **closed by the same fix**.

### #3 — listening / pods / listening-metadata client reads (rows 10-13)

Real bypasses, unfixed. They matter only if the repair set touches `bookend_listen_*`, `pod_explainer`, `pod_fine_known` or the split-clip roles. **Explicit gap: I did not query Supabase, so I cannot say which roles the 978 deu revisions cover.** If any are listening/pod roles, the same `stampRowAudioRefs` call is the fix at each site. Recommend checking `select role, count(*) from course_audio where course_code='deu_for_eng' and audio_revision>1 group by role` before spending on it.

### #4 — `useScriptCache`'s direct-to-bucket builder (row 16)

The census flagged this file, and it IS live — but it is **not** a staleness hole. It never carries an audio id; it carries `s3_key` and builds `{bucket}/{s3_key}`. The repair writes a NEW key, so the URL changes and the bytes are current. It bypasses `/api/audio`, AudioCache and the entitlement gate, which are separate concerns worth their own pass, but it does not produce Tom's symptom. Reached only via the `else` branch of `scriptItemToPlayableItem` (`LearningPlayer.vue:3356-3380`) when `audioRefs` are absent.

### #5 — `/api/courses/[code]/bundle` is dead

One of the three stamped routes has no client consumer. Not a bug today; worth knowing before anyone budgets more work against it.

---

## 4. Explicit gaps

- **No DB queried.** Which roles/clips the 978 deu revisions cover is unverified — it decides whether hole #3 is real or theoretical.
- **No live browser trace.** The cache-fast-path conclusion is from reading the call graph (the `return` at `LearningPlayer.vue:12240` and the `if (!map) return` at `:1583`), not from a recorded session. A one-line confirmation would be: on Tom's device, look for `[InstantPlayback] Cache fast-path: hydrating N rounds` in the console with **no** `[InstantPlayback] Bootstrap ready` after it.
- **Fix not deployed or verified live.** Committed and pushed only.

---

*Written 2026-08-06. Audit read-only; the one fix is scoped to the single unambiguous hole.*
