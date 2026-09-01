# Audio prefetch audit — every path that fetches ahead of need

**Ruling enforced (Tom, 2026-09-01):** *"Should be progressively loaded, yes. Never upfront loaded."* / *"Because people still have the option if they choose to select the Offline Mode itself."*

Classification: **A** = progressive, scoped to the learner's cursor · **B** = upfront/automatic bulk (violation) · **C** = explicit Offline Mode opt-in.

Line numbers are as of `origin/dev` @ `ac816697` (pre-fix).

| # | Path | file:line | Trigger (traced, not guessed) | How much | Class |
|---|---|---|---|---|---|
| 1 | `SimplePlayer.prefetchNextCycle` | `playback/SimplePlayer.ts:1629` | Cycle advance inside the player | Next cycle's 3 clips, known=high / voices=low priority | **A** |
| 2 | `SimplePlayer.prefetchUrl` (current cycle voices) | `playback/SimplePlayer.ts:1410-1411` | PROMPT phase entry | 2 clips of the cycle already playing | **A** |
| 3 | Rolling filler `fillBuffer` → `collectHeadRoundsAudioIds` | `LearningPlayer.vue:12133,12415` | Every round advance; first burst on rounds-loaded | 3 rounds ahead of cursor | **A** |
| 4 | Rolling filler → `collectSpanAudioIds(spanMs)` | `LearningPlayer.vue:12053` | Same | 20 min ahead (≈4 rounds), concurrency 1; 10 min at concurrency 3 on burst | **A** |
| 5 | Rolling filler → `collectPodSpanAudioIds(spanMs)` | `LearningPlayer.vue:12104` | Same | Only the pod lap due inside the span; `[]` if none | **A** |
| 6 | Rolling filler → `collectLayer1SpanAudioIds(spanMs)` | `LearningPlayer.vue:12248` | Same | Only the L1 lap due inside the span | **A** |
| 7 | **Rolling filler → `collectAllListeningAudioIds()`** | `LearningPlayer.vue:12415` | **First burst, fires on rounds-loaded — before a single cycle plays** | **Whole listening corpus: 2,401 clips / ~100 MB / 2.4h on spa_for_eng. Not cursor-scoped, never shrinks.** | **B** ❌ |
| 8 | `podScheduler.prefetchLap` | `LearningPlayer.vue:6149` | Round boundary, when the *next* round ends in a pod | One lap (~5 min runway) | **A** |
| 9 | `l1Scheduler.prefetchLap` | `LearningPlayer.vue:6306` | Round boundary, next-round L1 lap, pod not pre-empting | One lap | **A** |
| 10 | Skip/jump prep `prepareAndJump` | `LearningPlayer.vue:9750` | Learner presses skip / belt-skip | Destination round's **first cycle only**, 5s ceiling | **A** |
| 11 | Dormancy save | `LearningPlayer.vue:9643` | `visibilitychange=hidden` / `pagehide` | Current + next cycle | **A** |
| 12 | `ListeningOverlay` per-clip warm | `ListeningOverlay.vue:1251` | Listening surface, next clip | 1 clip | **A** |
| 13 | **`ListeningOverlay.downloadListeningPack`** | `ListeningOverlay.vue:1887` | **No caller — UI button removed 2026-05-20.** Dead heavy path | Every listening clip in the course, concurrency 5 | **B** ❌ (latent) |
| 14 | **`useScriptCache.preloadAudioBatch`** | `useScriptCache.ts:588` | **No caller anywhere in `src`.** Dead unbounded helper | Whatever URL list it is handed | **B** ❌ (latent) |
| 15 | `downloadForOffline` → `bulkDownloadAudio` | `LearningPlayer.vue:12617` | `startOfflineDownload` ← depth picker ← `toggleOffline` (learner tap) | Course depth chosen on the slider + aux pools + all listening | **C** ✅ |
| 16 | `startOfflineDownloadInfPlay` → `bulkDownloadAudio` | `LearningPlayer.vue:13407` | Same picker, INF-PLAY single option | USE-only, longest 3/LEGO + aux | **C** ✅ |
| 17 | Straggler retry → `bulkDownloadAudio` | `LearningPlayer.vue:12717` | 30s/2m/5m after a partial download; guarded on `offlineActive` | Only the ids that failed a download already consented to | **C** ✅ |
| 18 | Offline-mode restore on mount | `LearningPlayer.vue:14028` | Persisted selection + valid lease | **Sets a flag only — starts no download.** Verified | **C** ✅ |
| 19 | `useEagerScriptPreload` | `App.vue:349`, `useEagerScriptPreload.ts` | Course known at boot | Script **metadata**, 10 seeds. No audio | **A** (n/a) |
| 20 | `warmBundleForIntent` / `getCourseBundle` | `App.vue:316` | Course nameable at boot (~250ms) | Course bundle **JSON**, ~300 KB gzipped. No audio | **A** (n/a) |
| 21 | Instant-playback tiers 1 & 3 | `useInstantPlayback.ts:1445,1483` | During playback | Rest of current round; next round. **Cycle metadata**, not audio bytes | **A** |
| 22 | `MetaCommentaryService.initialize` | `MetaCommentaryService.ts:211` | Service init | Fetches the **lists** of instruction/encouragement clips (metadata) | **A** (n/a) |

## What changed

| Row | Action |
|---|---|
| 7 | `collectAllListeningAudioIds()` removed from `fillBuffer`. Listening stays **promoted** ahead of the span's cycle tail (Tom 2026-08-31) via rows 5 & 6 — the laps *due in the span* — but never the corpus. New order: head rounds → pod span → L1 span → span cycles. |
| 13 | Deleted (~150 lines). Dead corpus-wide downloader with no entry point. |
| 14 | Deleted. Dead unbounded preloader in a shared module. |
| 15–17 | Now pass a required `offlineModeOptIn: () => offlineActive.value`. |
| — | `BulkAudioDownloadDeps.offlineModeOptIn` added as a **required** field, checked before any fetch; refusal returns a clean cancellation and logs why. |
| — | Tests: `bulkAudioDownload.optIn.test.ts`, `progressivePrefetch.boundary.test.ts`. |

## Where the boundary now sits

Nothing heavy happens until the learner asks for it. As you play, the app quietly keeps a short stretch of what's coming next on the device — the next few rounds, plus whatever listening exercise is due in that stretch — and it moves forward as you do, so it never runs far ahead of you. That is the automatic path, and it can only ever fetch things measured from where you currently are. The one place the app downloads a whole course, or the whole listening library, is when you turn Offline Mode on yourself and pick how much you want. Those two paths are now separated by an actual lock rather than good intentions: the heavy downloader will not fetch a single file unless it is handed proof that you chose Offline Mode, so a future change cannot wire big downloads into the automatic path by accident — it won't compile, and if it does, it won't run, and a test will fail before it ships.
