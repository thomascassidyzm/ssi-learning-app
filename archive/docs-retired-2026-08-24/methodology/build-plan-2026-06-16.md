# SSi Consolidated Build Plan — Paywall, Schools, Downloads, Rollout

> ⚠️ **One correction to the auto-scope below:** the scoping agents read a **stale local checkout** (`f485e373`, pre-`7b8b6064`), so they report the school free-play **cascade grant as still present / a live revenue leak (§2A #1)**. It is **NOT** — commit `7b8b6064` already deleted that block on `origin/dev` (verified: `provision.ts` now has only the "NO entitlement_grant" comment), **and** the live DB has **0 active `entitlement_grants`**. So there is **no live leak**; §2A’s “highest-priority delete” is **already done**. Everything else stands.

_Synthesised 2026-06-16 from four scoping reports (schools/billing, downloads/lease, rollout, loose-ends). State as of `origin/dev` @ `7b8b6064`. Single Supabase project `swfvymspfxmnfhevgdkg` backs dev/staging/prod._

---

## 1. Status snapshot

### Shipped to dev this session
- **Consumer £15 paywall.** Every course opens to free play through Yellow (seed 19 = `PREMIUM_PREVIEW_MAX_SEED`); single £15/mo Premium plan; card-up-front removed (`9ac4ca7a`).
- **Paywall protection (belt-skip hole closed).** All past-Yellow paths gated via `gateSeed()` wired at 5 call sites in `LearningPlayer.vue`; 797-line `PremiumView.vue` deleted; `composables/useCheckout.ts` added as the single £15 trigger (`655bdf20`).
- **£5/£10 student two-price flow + money hardening.** School student £5 vs tutor student £10, server-re-derived from `class.school_id` (anti-overcharge); webhook idempotency + atomic commission accrual (`71cee210`, `0383e500`).
- **Self-service school signup no longer grants students free play** (`7b8b6064`) (`7b8b6064`) — confirmed removed on `origin/dev`; the scope agents saw a stale local tree.
- **Single light theme** (theme collapse), **listening v2 toggle** (per-sentence cards, speaker-aware gaps), **rest-state chevron**, **free-access codes / email allowlist** (`email_access_grants`, forgiving/normalized codes).
- Teacher-insights refinement landed and committed (`0383e500`); the four "dirty" files (`demoRates.ts`, `TopNav.vue`, `TeacherInsightsView.vue`, `FrostSelect.vue`) are committed, nothing abandoned.

### Only-on-dev (not yet promoted)
- All 36 commits above live on `origin/dev` only. `origin/staging` == `origin/main` tree byte-for-byte; dev→staging is a **clean fast-forward**.
- One dev-only migration file: `20260615_money_hardening.sql`. **Live-DB probe says its objects already EXIST** on the shared DB (`processed_webhook_events`, `accrue_teacher_commission`, `claim_*_use`, `wise_transfer_id` UNIQUE) — but there is **no "APPLIED" provenance note anywhere in repo**, unlike every other applied migration. Treat as "appears applied, needs Tom's explicit confirm."
- `main` is 6 commits ahead of `staging` in **history only** (identical tree) — promote-merges + a security hotfix (`f8207bf6`, content already on dev).

---

## 2. Work streams

### A) Schools / tutor onboarding + billing

**Goal.** Lever (3): a real **school platform subscription** — £15/teacher/mo, with a free trial (1mo for premium track, 1yr for free-course track) that gates dashboard access on expiry, limited to **one trialled language**, with **email-burn** (one trial per email per track, forever).

**Current state.** Lever (3) **does not exist**. `/schools` and `/teach` access is a pure role check (`canAccessSchools` = `isTeacher` from `educational_role`) with **zero expiry/subscription enforcement** — once `educational_role='school_admin'`, dashboard is permanent and free. `schools` has no status/expiry/plan/seat/Paddle columns. `subscriptions` is per-learner only. Levers (1) £5/£10 student and (2) admin's-own play-trial (`user_entitlements`, hardcoded 30d) both **work**.

**The build (file-level).**
- **NEW migration** `supabase/migrations/<ts>_school_platform_subscription.sql`:
  - `schools` += `platform_status` (trial|active|past_due|expired|cancelled, default 'trial'), `trial_course_code`, `trial_kind` ('premium_1mo'|'free_1yr'), `platform_expires_at`, `teacher_seats` (default 1), `provider_subscription_id`, `provider_customer_id`. (Belonging = 1:1 → columns on `schools`, not a join table.)
  - **NEW table `trial_burns`** (`email`, `track` ['school'|'tutor'], `burned_at`, `school_id`; PK `(email, track)`) — must outlive a deleted/recreated learner row and an expired trial; keyed on email, the only stable identity.
  - Mirror `platform_status` + `platform_expires_at` columns on `teachers` (tutor gate = 1mo always).
- **`api/onboarding/provision.ts`** (biggest change):
  1. **DELETE the school `entitlement_grant` block (L202-221).** Confirmed still present on this branch (verified live). _This is the "do NOT re-add the cascade" requirement — leaving it gives every self-service school free student play._ **Money-path, highest priority.**
  2. Set platform trial on the `schools` row: premium→`premium_1mo` +30d; free→`free_1yr` +365d (free-course schools must NOT fall into today's `if (!isFree)` skip that would give them a permanent free dashboard).
  3. Enforce exactly **one** `trial_course_code` per school (reject/require-checkout on a second language).
  4. **Email-burn first, then grant** (insert `trial_burns`; on 23505 unique-violation → already burned → deny, no trial). Never grant-then-burn. Replaces the leaky per-learner `SELF_SERVICE_TRIAL_CAP` for the platform trial (keep that cap only for lever-2 play access).
- **The gate (expiry enforcement)** — `active = status==='active' || (status==='trial' && expires_at > now)`; govt/ssi_admin/act-as bypass:
  - `SchoolsContainer.vue` `showDashboard` AND platform-active; expired → renew panel.
  - `containers/TeachContainer.vue` + `views/teach/TeachDashboard.vue` (read `teachers.platform_expires_at`; replace stale "7-day free trial" copy at ~L530/550 with "1 month free").
  - `router/index.ts` `beforeEnter` guards on `/schools` + `/teach` (deep-link can't skip the container).
  - `composables/schools/useSchoolContext.ts` loads the platform columns for the gate.
  - **NEW `api/school/subscription.ts`** — server read of platform status (mirror `api/subscription/index.ts`) so the value-read isn't client-only.
- **Paddle** — `api/teacher/paddle-webhook.ts`: new `kind='school_platform'` branch (mirror `handlePremiumSubscription`) → set `schools.platform_*`, `teacher_seats = items[0].quantity`, `platform_expires_at = currentBillingPeriod.endsAt` (absolute SET, not increment → idempotent-safe). Per-teacher pricing = Paddle **quantity** on one per-seat price. New env `VITE_PADDLE_SCHOOL_TEACHER_PRICE_MONTHLY`. Tutor branch sets `teachers.platform_expires_at` from `current_period_end`.
- **Onboarding copy** — `Onboarding.vue` + `lib/onboardingTracks.ts`: "1 language free trial (1mo premium / 1yr free)"; reflect burn ("already trialled").

**New tables/migrations.** One migration: `schools` columns + `teachers` mirror columns + `trial_burns` table.

**Dependencies.** Must land the `provision.ts` cascade delete + trial-on-schools together. Gate depends on the migration. Webhook branch depends on the new Paddle price env. Server-side enforcement depends on RLS tightening (see risk).

**Risks (money-path marked 💰).**
- 💰 **Live revenue leak:** the school cascade grant at `provision.ts` L202-221 is still active — every self-service premium school currently gives free play to joining students. **Highest-priority delete.**
- 💰 **Client-only gate is bypassable** while schools tables are permissive RLS (insights/analytics composables query Supabase directly). The gate must reach RLS or a server read **before the first paying school** — this build IS the CLAUDE.md "tighten RLS" trigger. Until then the gate is advisory.
- 💰 **Email-burn correctness** — burn-before-grant on the stable email, else trials are farmable by account deletion/expiry.
- 💰 **Seat-count drift** — block/prompt-upgrade when a school invites teacher N+1 beyond paid `teacher_seats`, else "£15/teacher" goes unbilled.
- 💰 **Webhook trust** — read `current_period_end`/quantity from Paddle, never client.
- **Tutor double-trial confusion** — consolidate lever-2 play-trial + stale "7-day" copy into one "1 month free, then £15/mo, dashboard cuts on expiry."

**Effort: L.**

---

### B) Downloads-as-premium + the 30-day offline handshake

**Goal.** (b1) Gate deliberate downloads behind premium; (b2) Spotify-style **30-day lease** — every download stamps a lease; any successful online subscription check slides expiry +30d; if not renewed within 30 days (offline whole time or sub lapsed), offline playback **locks** (bytes stay on disk, instant unlock on reconnect).

**Current state.** Downloads are **completely ungated** — `toggleOffline`/`downloadForOffline`/`startOfflineDownload` never consult `useEntitlement` despite `canDownload`/`isPaidUser`/`maxDownloadHours` already existing. **No lease/expiry anywhere**; once audio is in IndexedDB it plays offline forever. A user can download a whole premium course (play is blocked past seed 19 by `gateSeed`, but the downloader fetches the entire script), and a lapsed subscriber keeps offline access permanently.

> **Correction to inherited docs:** `packages/core/src/cache/*` (OfflineCache/DownloadManager/AudioSource) **does not exist** — the real stack is entirely in `player-vue` (`cache/AudioCache.ts`, `composables/useScriptCache.ts`, `useOfflineDownloadStatus.ts`, `LearningPlayer.vue`, `ModeTray.vue`). Fix the stale `CLAUDE.md` file map (one line) so the next agent doesn't chase ghosts.

**The build (file-level).**
- **Gate at the trigger** (cheap, one consumer; don't gate the hot read path on live subscription):
  - `LearningPlayer.vue` `toggleOffline()` / `startOfflineDownload()` / `downloadForOffline()` — if `!canDownload.value` → `startCheckout({ courseCode })` instead of opening the depth picker; defensive re-check at the top of the download fns. Free/community stay open (`canDownload` already true).
  - `ModeTray.vue` — `canDownload` prop renders a lock affordance ("Offline play — Premium"); decision still lives in `toggleOffline`.
- **The lease** lives on `CachedScript` in `useScriptCache.ts` (per-course IndexedDB row the cold-reopen already reads — **no new store, no SQL migration for v1**): `offlineLease { grantedAt, expiresAt, lastValidatedAt, subscriptionId?, entitlementHash? }`.
  - **Grant** at end of successful `downloadForOffline` (~L8982), in the existing `setCachedScript`.
  - **Renew** — NEW `composables/useOfflineLease.ts`: on boot (after `useSubscription.initialize`), on `window 'online'`, on a ~6h timer → calls validate endpoint → on active sub, slide `expiresAt = serverNow + 30d`. Renew on _every_ successful check (active user never locks).
  - **Lock (not delete)** — `isLeaseValid` checked at offline boot fast-path (~L10161), `resolveAudioUrl` (~L7985), `offlinePlaybackActive()`. Expired → fall back to network (fails gracefully → lock UI). Bytes preserved; one renewal re-validates instantly.
  - **Lock UI** — add `'locked'` state to `useOfflineDownloadStatus.ts` + ModeTray Offline row + a lock screen reusing the paywall overlay shell ("Offline access paused — reconnect to renew").
  - Wire `useOfflineLease` init in `App.vue` after `useSubscription.initialize`.
- **NEW thin server endpoint** `api/entitlement/offline-lease.ts` — `verifyAuthToken` (pattern from `api/entitlement/user.ts`) → reuse the existing subscription/entitlement helper → `{ valid, reason?, leaseDays:30, serverNow, courses[] }`. `serverNow` is the clock-tamper anchor.
- **NEW constants** `config/offlineLease.ts` — `LEASE_DAYS=30`, `RENEW_INTERVAL_MS`, `computeExpiry`, `isLeaseValid`, `isClockTrustworthy`. (Don't reintroduce the vestigial hours-based `PAID_DOWNLOAD_HOURS`/`FREE_PREFETCH_MINUTES`.)

**New tables/migrations.** None for v1 (client holds the lease; server is stateless authority). Optional later hardening: an `offline_leases` table so the server can revoke on chargeback/refund — defer until that consumer exists.

**Dependencies.** Builds on the paywall/`gateSeed`/`useCheckout` machinery (`655bdf20`) already on dev. Reuses `useSubscription` + `useEntitlement` (no parallel check).

**Risks.**
- 💰 **Locking active subscribers is the cardinal sin.** Renewal must be **fail-open on infra failure** (network/5xx → keep expiry, retry), fail-closed only on an explicit server `{valid:false}` (sub genuinely lapsed) — and even then with a graceful remaining-days tail. Lapsed-but-not-yet-expired runs out its days, doesn't instant-cut. Test: active sub + API down a day must NOT lock.
- **iOS read-path fragility** — the lease gate must sit before `getWavBlobUrl` (mp3→WAV) resolves to network-fallback, without interfering with WAV decode. Verify on iOS standalone PWA (this surface has burned the codebase repeatedly).
- **Clock-tamper** mitigated (server-time anchor + regression detection fail-safe-to-locked), not eliminated; a fully-offline tampering lapsed user keeps bytes ~30d — acceptable BSC trade vs DRM.
- **Demo/dev bypass** (`ssi-demo-tier`, `checkDevPaidStatus`) must also bypass the lease → route to an infinite lease, or demos lock after 30d.
- **Entitlement-code users** — lease `expiresAt = min(now+30d, entitlement.expiresAt)` so a lease can't outlive the code.

**Effort: M (gate) + L (handshake).**

---

### C) Rollout / promotion (dev → staging → main)

**Goal.** Promote the 36-commit dev train (headlined by the consumer paywall + £5/£10 levers) to production safely.

**Current state.** dev→staging is a clean FF (verified `merge-base(dev,staging) == staging tip`). staging tree == main tree byte-for-byte; main is 6 **history-only** commits ahead of staging (promote-merges + security hotfix already on dev). Both June-15 migrations appear already live on the shared DB (probed). The only true blockers are **outward-facing config Tom must confirm**, not code or DB.

**The build (steps).**
1. **Step A — back-merge `main` → `staging`** (housekeeping first). `git checkout staging && git merge origin/main` (trivial, no tree change; resolves history divergence so subsequent promotes are clean). The dev side of the hotfix lane is already covered (`validate.ts` identical on dev).
2. **Step B — promote `dev` → `staging`** (clean FF after Step A). Soak on `staging.saysomethingin.app`: free play-through-Yellow on a premium course; belt-skip can't bypass `gateSeed()`; in-player £15 trigger opens Paddle; tutor/school student land on £10/£5.
3. **Release note** — `node scripts/draft-release-note.cjs` (dry-run → review), `--commit` to insert DRAFT row, Tom publishes at `/admin/release-notes`. Run after Step B.
4. **Step C — promote `staging` → `main`** only after: external/Colombo soak, a real-or-sandbox end-to-end subscription has fired at least once (exercises the unexercised `processed_webhook_events` dedup), and §5 config confirmed. Cut the prod note with `--version $(git rev-parse --short origin/main)`.

**New tables/migrations.** None pending. Tom only **confirms** `20260615_money_hardening.sql` was the deliberate apply already live (idempotent re-run is a safe no-op if any doubt).

**Dependencies.** Step A before B before C. Step C gated on Tom's env-var + Paddle confirmations and the first-webhook test.

**Risks (all money-path 💰).**
- 💰 **Env vars escape git/DB rollback:** `VITE_PADDLE_TEACHER_PRICE_MONTHLY` (£15), `VITE_PADDLE_STUDENT_PRICE_MONTHLY` (£10), `VITE_PADDLE_STUDENT_SCHOOL_PRICE_MONTHLY` (£5) must exist per-environment, else `useCheckout` errors "price not configured" and the paywall is inert.
- 💰 **Paddle "trial 0 days"** is a Paddle-dashboard setting — verify on the live price before prod.
- 💰 **`processed_webhook_events` has 0 rows** — idempotency path is correct-by-construction but **unexercised in production**; watch the first live subscription closely.
- **Shared-DB reality:** any migration committed on any branch is immediately live in prod — treat every migration as a prod change.

**Effort: S (mechanics) — gated on Tom's confirmations, not engineering.**

---

### D) Loose ends

**Goal.** Close the one live-money gap; correctly leave parked items parked; tidy dead TODOs/docs.

**🔴 Must-do (money).**
- **Confirm/apply `20260615_money_hardening.sql`.** Until its objects exist, the three financial-idempotency fixes are **inert/fail-open**: `processed_webhook_events` dedup, atomic `accrue_teacher_commission`, `claim_invite_code_use`/`claim_entitlement_code_use`, `wise_transfer_id` UNIQUE. The teacher-payouts cron is live (`vercel.json` monthly 1st 06:00) so accrual fires for real. Probe says objects exist but **no provenance note** → Tom confirms, runs `NOTIFY pgrst` reload, and records it APPLIED in `WORKLIST.md`. _This is the single item where the gap escapes git/provenance — it's live money on Paddle/Wise._

**🟡 Nice-to-have (deferred / earn-it).**
- Two Supabase cloud sentinels (health 07:00, webhook-integrity 07:30) self-report BLOCKED until `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set on the cloud routine env.
- Insight boards ("Rate compare"/Teacher/Coverage/Difficulty-turns) are demo-only (`?demo` fixtures); wire live rates **when waiting schools onboard** (engagement/coverage real; latency/execution lane not).
- Schools teacher **reads** → server-mediated (RLS-rebase cancelled by Tom): build alongside actual co-teaching (`useClassesData`/`useTeachersData`/`useStudentsData`/`useAnalyticsData`). Folds in the Class-as-first-class M2M read-path swap.
- Schools: bulk-invite-staff endpoint (`SetupView.vue` L12/14 TODO — staff invites are client-state only, no write path); school/global benchmarks unwired (`AnalyticsView.vue` ~L285); verify `contentFriction` RPC applied (`20260602_analytics_friction_extended.sql`).
- `useLearningSession.ts` L601-604: delete/reconcile 4 stale TODOs (superseded by shipped metrics engines).
- APML doc drift (`claude/apml-reconcile` 162 commits behind dev) — low-urgency reconcile.

**⚪ Parked (confirm, don't reopen).**
- **Pronunciation/prosody engine** (`@ssi/core/audio/PronunciationEngine.ts`, 5 bands) — real+tested, deliberately removed from UI, 0 scores persisted. Belongs to future homework/extension + ASSESSMENT composite. Leave banked.
- `get_cascade_courses` RPC consumption in `api/entitlement/user.ts` is **correct as-is** — `7b8b6064` removed only the auto-grant at signup; the RPC carries deliberate ssi_admin/govt comps. Watch it doesn't get "fixed" backwards. _(Note the tension: this means the §2A "delete L202-221" is about the **signup-time grant insert**, not the RPC — keep them distinct.)_
- Adaptation M2 / Prosody-VAD M3 / CEFR M4-5; conversational-flow priming — think-pieces, don't build.

**Effort: S (must-do confirm) + everything else deferred.**

---

## 3. Recommended sequence

1. **Confirm money-hardening migration (D, 🔴).** Blocks safe live payments; do before any promotion that could see a real webhook. Tom confirms + notes APPLIED. _(S, Tom)_
2. **Promote the existing dev train (C).** Step A back-merge → Step B dev→staging → soak + release-note draft → Step C staging→main. Gated on Tom's env-var + Paddle-trial confirmations. This ships the already-built paywall/levers to real users. _(S, gated on Tom)_
3. **Delete the school cascade grant + close the schools-billing gate (A).** Start with the **`provision.ts` L202-221 delete** (standalone, immediate leak fix — can ship ahead of the rest of A). Then the migration → trial-on-schools → gate → Paddle branch. _Schools billing must map lever-3 first_ (the new `schools` columns) before the gate or webhook have anything to read. _(L)_
4. **Downloads gate + lease (B).** Independent of A; depends only on the shipped paywall machinery. Ship the **trigger gate first** (M, closes the leak), then the **30-day handshake** (L). _(M+L)_

**What needs Tom's input/action (cross-cutting).**
- Confirm `20260615_money_hardening.sql` applied + record provenance.
- Confirm the three `VITE_PADDLE_*_PRICE_MONTHLY` env vars per environment.
- Confirm Paddle "0-day trial" on the live price.
- Sign off the staging soak before staging→main.
- Decide the open product calls in §5.

---

## 4. Immediate next actions

1. **Tom: confirm `20260615_money_hardening.sql` is applied** on the shared Supabase (probe says yes; no provenance note) and record APPLIED in `WORKLIST.md`. Re-run is an idempotent no-op if any doubt.
2. **Tom: confirm `VITE_PADDLE_TEACHER/STUDENT/STUDENT_SCHOOL_PRICE_MONTHLY` exist in staging + prod Vercel envs**, and the Paddle live price has a 0-day trial.
3. **Agent: delete the school cascade-grant block at `api/onboarding/provision.ts` L202-221** (verified still live this branch) — standalone leak fix, smallest high-value change.
4. **Agent: back-merge `main`→`staging`, then promote `dev`→`staging`; run `scripts/draft-release-note.cjs` dry-run** and soak.
5. **Agent: gate downloads at the trigger** (`toggleOffline`/`downloadForOffline` → `canDownload` else `startCheckout`) — closes the downloads leak independently of the lease build.

---

## 5. Open product decisions (Tom's call)

- **Tutor trial shape.** Mirror columns on `teachers` (symmetry with the school gate) vs keep tutor on `user_entitlements` + a `platform_expires_at`? And confirm the single message: "1 month free, then £15/mo, dashboard cuts on expiry" (kills the stale "7-day"/lever-2 double-trial).
- **Free-course schools pay for the platform (1yr trial then £15/teacher)?** The plan assumes yes (time-limited `free_1yr`). Confirm — it's the difference between a permanent-free vs time-limited free-course dashboard.
- **Seat-overage policy** when a school invites teacher N+1 beyond paid `teacher_seats`: hard-block vs prompt-upgrade vs allow-and-true-up?
- **RLS-tightening timing for the schools gate.** This build is the CLAUDE.md "first paying school" trigger. Server-mediated reads / RLS before the first paying school, or accept an advisory client-only gate for a defined window?
- **Lease lapse tail.** Confirm the graceful "lapsed-but-not-expired runs out remaining days" behaviour (vs instant cut) and the surfaced "offline works until <date>" copy.
- **Offline-lease server revocation table** — build `offline_leases` now for chargeback/refund kill-switch, or defer until that consumer exists (plan defers)?
- **Whether to ship the `provision.ts` delete + downloads trigger-gate into the **current** promotion train** or hold them for the next cut (affects whether Step C waits).