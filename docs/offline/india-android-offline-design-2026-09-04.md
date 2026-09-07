# What the app does when the network is bad, absent, or expensive
## The offline contract for the India Android rollout — design + derivation

**Date:** 2026-09-04 · **Author:** offline-design worker (Fable), from a read of the real code on `dev` @ `41b3a7ba` · **Readers:** Tom first, then the India build worker and the Colombo team (Imdad, Ivan) · **Companion work:** job #451 is building the Capacitor Android wrapper in this repo right now; this document tells the wrapper what the PWA already handles and what the shell is responsible for.

**The one-paragraph answer.** The offline system is already about 85% designed and shipped, and most of what's shipped survives contact with India as-is. The app's standing law — "play what you have, verify access as and when you can, never as a gate" — is implemented, not aspirational. What the Android rollout actually needs is small: verify the shipped machinery inside the Capacitor WebView on one cheap real device, feed Play-billing entitlement into the existing lease pipe, and accept two honest, bounded losses (offline per-LEGO telemetry; no automatic cache eviction) that cost nothing at this rollout's scale. Nothing here requires a download manager, a quality picker, or any new learner-facing choice.

---

## 1. What is actually true in the code today

Read directly from the code, per the repo's own law (code is gospel; docs are historical artefact). Each claim names its file.

### 1.1 Audio delivery — two paths, both real, one law

There are exactly two ways audio reaches a device, and the boundary between them is **enforced in code**, not documented:

- **Progressive (automatic).** While the learner plays, the app warms the next cycles and rounds into the IndexedDB `AudioCache` (`ssi-audio-cache-v2`) — `SimplePlayer.prefetchNextCycle()`, LearningPlayer's rolling filler. Position-scoped and gentle. Audio streams from `/api/audio/:id` (a Vercel proxy that answers proper 206s to S3 Range requests — `api/audio/[audioId].ts`) and is cached as it flows.
- **Deliberate (Offline Mode).** A learner-chosen toggle opens a full-screen depth picker — a notched slider (2%, 5%, 10%, 25%, 50%, 100% of the *remaining* course, thumb defaulting to the smallest notch) with a live MB estimate (`LearningPlayer.vue` ~line 13275). The download runs through `playback/bulkAudioDownload.ts`: batch presigned S3 URLs (500 ids/request, 5-min TTL, just-in-time per chunk), direct-from-S3 at concurrency 24 (6 while playing), proxy fallback, three straggler rounds with growing backoff before anything is counted failed, and a hard rule that a course ≥98% cached is "Ready" (`useOfflineDownloadStatus.ts`). The gate is a **required constructor parameter**: `deps.offlineModeOptIn` must return the learner's own toggle state or not one byte downloads. Tom's ruling of 2026-09-01 ("progressively loaded, yes; never upfront loaded") is compiled in.

**Offline playback** does not touch the network at all: cached mp3 bytes are decoded to WAV blob URLs (`AudioCache.getWavBlobUrl`, memoised per clip, 5s decode ceiling with network fallback) because WebKit refuses mp3 blob URLs but plays WAV ones — and WAV blobs also survive the locked screen, which streamed audio does not (`cache/resolvePlaybackUrl.ts`).

**The degradation ladder** (`useOfflinePlay.ts`) never stalls a session: scheduled cycle → any cached cycle → repeat the last one (with an anti-loop guard). And `config/networkGate.ts` is the keystone: one 2.5-second budget for every boot-to-first-audio network call, an *observed* network-down signal (a timed-out critical call means the network is unusable, whatever `navigator.onLine` claims), and — critically — **the offline toggle expresses intent ("don't spend my data"), it does not gate playback**. A learner who forgot to flip it gets identical playback behaviour from cache.

### 1.2 Service worker and the platform seam

`platform/capabilities.ts` is the single door: `shell` is `'web'` or `'webview'`, injected by the wrapper via `window.__SSI_PLATFORM__` before the bundle evaluates. **In the WebView the Workbox service worker deliberately does not run** (`shouldRunServiceWorker()` — the native shell owns app-shell caching and update delivery; a Workbox precache underneath it would serve a stale shell). On the web the SW precaches the app shell, serves navigations NetworkFirst with a 3s timeout and a precache fallback (airplane-mode cold boot reaches the player), and **never touches audio** — audio SW-caching was removed 2026-05-24 after the iOS Range-request saga. `platform/storage.ts` is an abstraction-only seam for storage quota, explicitly waiting for a native backend "until the shell exists to host it". `platform/apiBase.ts` routes `/api/...` to a configured origin; commit `7e557f59` wired CORS preflight into the 31 routes the signed-in learner app calls, and the WebView authenticates with a Supabase **bearer token** — no cookies.

### 1.3 Entitlement — the 30-day lease is fully shipped

`api/entitlement/offline-lease.ts` + `config/offlineLease.ts` + `useOfflineLease.ts` implement the "Spotify handshake": every downloaded course carries a lease recording the last time entitlement was confirmed online. Payers slide +30 days on each (lazy, throttled, 5s-timeout) validation; non-payers get **one** non-renewing 30-day taste, remembered server-side in the `offline_leases` table so wiping storage doesn't mint a fresh one; a revocation flag (chargeback kill-switch) locks mid-window. The cardinal sin — locking a paying learner — is guarded three ways: fail-open on any infra/auth/timeout failure; a lapsed subscription runs out its remaining lease days rather than instant-cutting; and clock-tamper detection only fires on a clock wound back >6h behind the last validation (the 6h tolerance absorbs bad NITZ/GPS fixes on flight descent — a real incident, 2026-07-21). Expiry locks softly: bytes stay, the UI says "Offline paused — reconnect to renew", one successful validation unlocks.

Audio-proxy entitlement is separate and stateless: free courses and preview seeds (≤ Yellow belt) are always open; premium past-preview clips need an HMAC entitlement token, currently **fail-open by default** while client coverage is observed (`resolveAudioEntitlement` in `api/_utils/audioAccess.ts`, header-tagged).

### 1.4 Learner progress — the cursor survives; the telemetry doesn't

The honest answer to "does an offline write queue exist": **no.** `@ssi/core` contains a `SyncService` with an IndexedDB-backed queue — and nothing in `player-vue` imports it. It is dead code today.

What actually happens:

- **Position (the thing that matters).** Saved to localStorage on every cycle's `prompt` phase, and *also* written to the DB fire-and-forget per cycle (`persistLivePositionToDb` → `setLivePosition` on `course_enrollments`), with a separate ceiling ratchet (`highest_completed_lego_id`) that only ever rises. **Playback reads localStorage; the DB is the cross-device sync layer that overwrites localStorage at boot.** Offline, the DB writes fail silently, localStorage keeps advancing, and the next online cycle write catches the DB up. The learner's place is never lost on the device they used; it is stale on *other* devices until they reconnect.
- **Per-LEGO progress and usage telemetry.** `lego_progress` rows, `bump_speaking_opportunities` RPCs, session checkpoints and `player_events` are direct Supabase calls with `console.error` on failure. Made offline, they fail and are **gone** — the code comment in `useLearningSession.ts` saying a downloaded look-ahead "records normally — it just syncs later" is aspirational: nothing retries these writes. (The PRACTISING mode correctly suppresses progress inflation when replaying old material; that part is real and tested.)
- **Auth offline.** `useAuth.adoptLastKnownIdentity()` restores a remembered learner identity when the network can't answer, flagged `identityUnverified`; supabase-js keeps its stored session through network failures and only drops it on a definitive refresh rejection; `hasStoredSupabaseSession()` distinguishes "couldn't ask" from "signed out". An expired bearer token offline therefore costs nothing: offline playback needs no API, and the refresh token renews on reconnect.

### 1.5 Storage — measured size, no eviction, unmeasured Android quota

- The measured fact (`docs/full-course-offline-size-2026-09-01.md`, main checkout — **not yet committed to dev**; see taste calls): a full spa_for_eng Offline Mode download at the configured voices is **51,199 clips, 43.6 hours, ≈1.86 GB** at a thrice-confirmed 96 kbps. About 1.9× over Safari's ~1 GB PWA budget. The old "200x headroom" claim was wrong and CLAUDE.md already carries the correction.
- **No automatic eviction exists.** `AudioCache.persistentEvictToTarget()` (LRU by last-access) is implemented, tested — and called by nothing in production. `quotaPressure()` is consulted in exactly one place: the depth picker shows a "running low" warning above 90% usage. If the platform evicts, the app self-heals (blob-URL revocation on missing rows, network fallback per clip), but the app never evicts itself.
- **Android/Capacitor WebView quota is unestablished.** I could not measure it from this box and have not invented a number. What is knowable cheaply: one debug WebView build on a low-end device reading `navigator.storage.estimate()` before and after a bulk download. The assumption I proceed on (marked as such): WebView IndexedDB lives in app-private storage, is not subject to Safari's ~1 GB cap or its 7-day ejection, and is bounded in practice by the device's free disk — which on a cheap Indian handset may itself be only a few GB.

### 1.6 Where the docs were wrong

- `CLAUDE.md` Cache Module: names `usePrefetchManager.ts` and a "30 minutes ahead" target — the file no longer exists; cache-ahead is spread across `useScriptCache`/`useInstantPlayback`/SimplePlayer. Its "Safari limitations acceptable" framing predates the 1.86 GB measurement (partly corrected in place).
- `docs/trinity/offline-pwa.md` (2026-07-17): accurate for its date but predates the networkGate ruling (2026-08-15), the opt-in bulk-download gate (2026-09-01), and the platform seam (2026-09-03). Historical artefact; do not implement from it.
- `useOfflinePlay.ts`'s own header lists a four-level ladder including "USE phrases"; the code implements three levels (normal / any-cached / repeat). Minor, but the header over-promises.
- `useLearningSession.ts`'s "it just syncs later" comment — see 1.4. It does not.

---

## 2. The design, with its derivation

### 2.0 The frame expansion that resolves the central conflict

The PWA-era offline thinking was dominated by one collision: **a full course (1.86 GB) does not fit in a browser (≈1 GB)**, so every design either shrank the download (worse), pushed a choice onto the learner (ruled out), or re-encoded the whole audio estate (expensive). That is a trade-off — and per Tom's rule, a trade-off is a hypothesis that the frame is too small.

The frame-breaker has already been ruled: **the Android rollout ships a Capacitor shell.** Inside the shell, the browser quota that created the conflict is simply not the constraint any more — WebView storage is app-private and disk-bounded, not Safari-budgeted. The conflict between constraint 1 (how much audio) and constraint 2 (browser quota) doesn't get *balanced* on Android; it *dissolves*, and the residual constraint is honest and physical: **the learner's free disk and the learner's data plan.** Those two are the same number wearing two hats — bytes moved — which is why one mechanism (the existing depth picker, smallest notch by default) answers both. That is the shape of the whole design: India doesn't need a new offline system; it needs the shipped one verified on the actual platform, plus honest handling of the residue.

Where I genuinely hit a floor rather than a frame: **bytes are bytes.** At 96 kbps, an hour of listening costs ~44 MB whether streamed or downloaded. No architecture moves that; only a lower-bitrate encode does (a real option, priced in §5). I am not dressing that up: for a learner paying per MB, SSi at current encoding costs roughly 20–25 MB per 30-minute session streamed fresh (derivation: measured 96 kbps ≈ 12 KB/s; a session's ~198 clips × ~3.1 s measured mean ≈ 10 minutes of unique audio ≈ 7.4 MB, plus prefetch look-ahead and replays served from cache; the dominant term is unique audio actually heard). *Flag: the 198-clips-per-session figure is CLAUDE.md's validated count, not re-measured here.*

### 2.1 Constraint 1 · Audio delivery — keep the two-path doctrine, verbatim

**Design: no change.** Progressive warming while streaming is the default; Offline Mode is the deliberate opt-in. Both already exist, both are gated correctly, and the boundary is enforced by a required parameter a future caller cannot dodge.

Derivation: the only pressure to change this would be "Indian learners won't find the toggle before their first train ride." But the degradation ladder + networkGate mean a learner who never touches the toggle *still* keeps playing from whatever progressive warming banked, forward through cached rounds first (Tom's 2026-08-15 ruling, implemented in the expansion watcher). The toggle is an optimisation, not a lifeline. PRESS PLAY holds.

### 2.2 Constraint 2 · Storage — verify, don't build

**Design: measure the WebView's real quota on one cheap device (a one-hour probe inside job #451's debug build), and wire nothing until it says otherwise.** The `platform/storage.ts` seam exists precisely so a native storage backend can be swapped in *if* the probe shows WebView IndexedDB is genuinely constrained; the seam's own header forbids building that backend speculatively, and I agree with it.

On eviction: **leave automatic eviction unwired for this rollout, deliberately.** Derivation: eviction protects against quota exhaustion; on Android the quota is (assumed, flagged) disk-bounded; the depth picker already defaults to 2% and warns at 90% pressure; and an eviction bug that deletes a learner's downloaded course the night before a train ride is a worse support ticket than "download failed at 96%, retrying". The existing behaviour under platform eviction — self-heal per clip, fall back to network — is the right floor. What a learner loses if the OS evicts: audio bytes only. Script (IndexedDB, ~1 MB), position (localStorage), lease (on the script row) are small enough that they survive any realistic pressure event that leaves the app installed. **Nothing in the system can destroy progress by losing cached audio** — BACK holds.

### 2.3 Constraint 3 · Entitlement — the shipped design survives India; feed it Play billing

**Design: no change to the lease machinery.** The 30-day sliding lease with fail-open, graceful lapse, one-shot taste and revocation was designed for exactly this market shape and needs nothing new. The single India-specific integration: RevenueCat (ruled: Play billing on Android) must land its entitlement where the lease already looks — `resolveEffectiveSubscription` / `user_entitlements` — so that a Play-billed subscriber renews their lease through the identical pipe a Paddle/web subscriber will. One writer (a RevenueCat webhook → subscription/entitlement rows), zero new readers. This is a note to the build worker, not a billing design (out of scope by brief).

The expired-bearer-token-offline case is already resolved (§1.4): playback needs no token, identity is adopted from memory, refresh happens on reconnect, and lease validation fails open on 401 by explicit design ("a token blip never locks a payer" — the server file's own comment).

### 2.4 Constraint 4 · Learner state — the cursor is the contract; say so, and add the smallest honest patch later

**Design: declare the cursor (position + ceiling ratchet) the offline-progress contract for this rollout, and accept the loss of offline per-LEGO telemetry as a known, bounded, honest gap.**

Derivation. The instinct is to wire up the dormant `SyncService` queue. Run it through Better × Simpler × Cheaper: *Better* — marginally; what the queue would preserve is spaced-rep bookkeeping and dashboard telemetry, and the spaced-rep schedule is largely reconstructible from the cursor since the script walk is deterministic. *Simpler* — no; it adds a replay layer with idempotency, ordering and double-count hazards (the exact "double-counting" failure the brief names) to writes that are today fire-and-forget. *Cheaper* — no; it's the single most bug-prone class of offline code, and a wrong implementation here is worse than none. It fails the test. What passes: **nothing now**, and — only if India's support load or the dashboards demand it — a tiny durable outbox for exactly two idempotent counters (speaking-opportunities and minutes), flushed on reconnect with a client-generated batch id so replays can't double-count. Ranked, not scheduled, in §5.

Two-device conflict (the brief's case): device A offline advances locally; device B online advances the DB; A reconnects. The live cursor is last-writer-wins (a deliberate jump-back must stick, so this is correct), and the ceiling only rises — so the *furthest point* can never regress and nothing is destroyed. The learner may see their live position resolve to whichever device wrote last; their ceiling and everything behind it is intact. That is BACK-compliant and needs no code.

### 2.5 Constraint 5 · Data cost — intent is already a first-class signal; spend nothing without it

**Design: no new UI, one behavioural rule.** The system already has the right shape: the offline toggle *means* "don't spend my data" (networkGate's own doctrine), bulk download runs only behind it, and streaming spends data only on audio actually being heard plus a small look-ahead. The one rule worth adding, shell-side and invisible: **when Android reports a metered connection, the progressive warmer keeps its per-cycle warm but skips the deeper rolling fill** — the learner hears identical audio, the app just banks less speculative future on a connection that costs money. No dialog, no picker; a learner who wants forty minutes banked on mobile data expresses that by flipping Offline Mode, which is precisely the intent the toggle encodes. (Where the metered signal isn't available, behave as today — this is an optimisation with a graceful absence.)

The 48 kbps question — halving both storage and data with an Opus/HE-AAC variant — is real money on the table (≈0.9 GB full course, ≈10 MB/session) but it is a server-side transcode of ~50k clips per course plus a client format decision, and the rollout's bar is washing its face, not maximum reach. Priced in §5, recommended *after* launch telemetry says data cost is actually the churn driver rather than the one we guessed.

### 2.6 The shell boundary (for job #451 and the Colombo team)

The design's division of labour, stated once:

| Concern | Owner | Why |
|---|---|---|
| App shell delivery, cold offline boot, app updates | **Capacitor shell** (bundled assets) | SW deliberately off in WebView (`shouldRunServiceWorker`) |
| Audio bytes, scripts, lease, position | **PWA layers** (IndexedDB + localStorage inside WebView) | already built; WebView storage is app-private |
| API origin + auth | **seam** (`apiBase` + bearer token; CORS shipped in `7e557f59`) | done 2026-09-03 |
| Storage quota truth | **shell probe** (one-off, §5 item 2) | web API may under-report in WebView |
| Play billing → entitlement rows | **server webhook** (RevenueCat) | lease machinery then just works |
| SDK 36 target | **Colombo** | Play policy deadline (dated constraint, not preference) |

One hazard worth naming for #451: the WebView serves from its own origin (`https://localhost` by Capacitor convention), so nothing carries over from any browser visit — every install is a cold cache. That's fine (fresh installs anyway) but means "it worked in Chrome on the same phone" proves nothing about the wrapper; hence the verification pass in §5 item 1.

---

## 3. The failure cases — what the learner sees, what they lose

1. **Train, two bars, flapping signal.** Every boot-critical call has a 2.5s budget; a timeout flips `networkPresumedDown` and playback runs from cache — forward through downloaded rounds first, recycling only when those run out. Lease validation is throttled to once an hour precisely so flapping can't spam it, and fails open. *Sees:* uninterrupted audio; possibly "Playing from your offline library". *Loses:* nothing if they downloaded ahead; new-LEGO advance pauses at the cache edge otherwise.
2. **Dead spot mid-session, nothing downloaded.** Progressive warming has banked the recent past and near future; the ladder plays scheduled-if-cached → any cached cycle → repeat-last (never the same cycle three times running unless it is literally all that exists, which is logged loudly). *Sees:* audio continues, degrading toward review. *Loses:* forward progress into new material until signal returns; usage telemetry for the gap (§1.4).
3. **Device evicts the cache under storage pressure.** No app-side eviction exists to compound it; on next play each missing clip falls back to the network URL, and a re-download prices only what's missing (already-cached counts toward done). *Sees:* offline coverage silently shrunk; streaming resumes where cache fails; offline in a genuine dead spot skips missing clips. *Loses:* audio bytes only — never position, lease, or progress. *(Assumption, flagged: Android evicting app-private WebView data is rare; the probe in §5 confirms.)*
4. **Paying learner, bearer token expired, offline.** Playback needs no token; identity is adopted from local memory (`identityUnverified`); the lease gate reads local state. On reconnect supabase-js refreshes; only a definitive server rejection signs them out. *Sees:* nothing. *Loses:* nothing.
5. **Offline 31 days on a 30-day lease.** Day 31: lease reads `expired`, offline playback locks softly. *Sees:* "Offline paused — reconnect to renew"; bytes stay on disk; free preview content (≤ Yellow) still streams if any connectivity exists. *Loses:* offline access until one successful validation — which any momentary signal fixes silently (reconnect listener + forced renew). A *paying* learner hits this only after 31 genuinely airtight days; the graceful-lapse tail means a sub that expired mid-window still ran its remaining days.
6. **Two devices, one offline (worked case in §2.4).** *Sees:* live position = last writer; ceiling = the maximum either reached. *Loses:* nothing behind the ceiling; possibly the offline device's per-LEGO telemetry (§1.4).

---

## 4. Already true vs not yet true — no blurring

**Already true in code on `dev`:**
- Two-path audio doctrine with an enforced opt-in gate; bulk download with presigned S3, stragglers, ≥98% readiness; WAV-blob offline playback, lock-screen safe
- Degradation ladder + networkGate ("play what you have"); offline toggle as intent, not gate; forward-first offline resume
- 30-day lease: sliding renewal, fail-open, graceful lapse, clock-tamper tolerance, one-shot trial, server revocation, soft lock
- Offline identity adoption; bearer-token cross-origin auth with CORS on all 31 learner routes; audio-cache owner purge on identity change
- Platform seam (shell/apiOrigin/storage/SW-gate); SW-less WebView posture; app-shell offline boot on the web via precache fallback
- Position: per-cycle localStorage + DB writes, ceiling ratchet, resume-same-cycle rule; PRACTISING-mode progress suppression
- Depth picker with live MB estimates and a 90%-pressure warning; download-stall honesty ("never silently stuck")

**Not yet true (and this design's stance on each):**
- Any offline write queue for progress/telemetry — core's SyncService is unwired dead code (*stance: keep it unwired; outbox only if support load demands, §5 item 5*)
- Automatic cache eviction (*stance: deliberately not for this rollout*)
- A measured Android WebView storage quota (*stance: one-device probe, §5 item 2*)
- RevenueCat/Play entitlement feeding the lease pipe (*required before a paying Android learner exists*)
- Metered-connection awareness in the progressive warmer (*small, shell-adjacent, §5 item 4*)
- A lower-bitrate audio variant (*priced, deferred*)
- The 1.86 GB measurement doc committed to the repo (*it lives uncommitted in the main checkout*)

---

## 5. What to build first — ranked for "washing its face"

The bar is awareness + low support load, not completeness. Ordered by (support tickets prevented) ÷ (build cost), with reasons:

1. **A verification pass, not a build: run the shipped offline machinery inside #451's WebView on one cheap real Android device.** Offline Mode download → airplane mode → cold kill → reopen → play → lock screen → reconnect → lease renews → progress cursor lands in the DB. Every failure case in §3 exercised once. This is where any real India blocker will surface (WAV decode performance on a weak SoC, WebView autoplay policy, `estimate()` behaviour), and it costs a day. *Reason it's first: the estate's known failure mode is designing against a mental model; this is the antidote applied to the platform itself.*
2. **The storage-quota probe on that same device, same day** (read `estimate()` cold, after a 25% download, near disk-full). Decides whether the native storage backend ever needs to exist. One number, one hour.
3. **RevenueCat webhook → existing entitlement rows.** Without it a paying Android learner's lease can't renew; with it, everything downstream is already built. Bounded server-side work; the only *new* code this rollout strictly requires.
4. **Metered-connection restraint in the rolling filler** (§2.5). ~20 lines behind the capabilities seam; directly attacks the "why did your app eat my data" ticket, which is the highest-probability support complaint in this market.
5. **The two-counter offline outbox** (speaking-opportunities, minutes) — *only when* dashboards or support show offline usage is material. Small by construction because it carries counters, not state.
6. **48 kbps audio variant** — the biggest lever on both storage and data cost, and the most expensive item here; wants launch telemetry first.

Explicitly *not* on the list: wiring SyncService, automatic eviction, any download-manager UI, offline behaviour for teacher dashboards (ruled boundary: institutions get the web app).

---

## 6. Taste calls — one line each, with recommendation

- **Trial lease copy for India:** the one-shot 30-day taste is generous next to a Play free-trial; keep it as-is or shorten for India? *Recommendation: keep 30 days — awareness rollout, and the server already prevents re-minting.*
- **Lease-lock wording** ("Offline paused — reconnect to renew") will be many Indian learners' first meeting with the lease; it's honest but unexplained. *Recommendation: keep it; add one sub-line "your progress is safe" — nothing else.*
- **Commit the 1.86 GB measurement doc to `dev`** so the number stops living in one checkout. *Recommendation: yes, verbatim.*
- **Audio-proxy entitlement is still fail-open** for premium past-preview clips; a B2C launch is when someone will notice. *Recommendation: leave fail-open through the awareness rollout — a paywall bug that blocks payers costs more than leakage at zero-user scale — and revisit with RevenueCat wiring (item 3).*
- **Depth-picker default notch (2%)** may read as stingy for a market that downloads overnight on wifi. *Recommendation: keep 2% default, it prices honestly; the slider is right there.*

**Explicitly invented rather than derived (flagged per brief):** the Android WebView quota assumption (§1.5, §2.2); the metered-warmer rule's exact scope (§2.5 — the *principle* is derived from networkGate's intent doctrine, the cut line between "per-cycle warm" and "rolling fill" is my judgment); the 20–25 MB/session streaming figure's session-shape inputs (§2.0). Per-MB data pricing in India: not established, not invented — the metered design deliberately doesn't depend on it.
