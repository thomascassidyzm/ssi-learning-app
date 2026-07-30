# OPEN LOOPS — the honest register of not-completely-solved threads

*Compiled 2026-07-30 from a full sweep: WORKLIST.md, docs/DECISIONS.md, docs/ design papers,
git branch/commit state, and the sibling repo `ssi-dashboard-v7-clean` (Popty). Capture only —
nothing here was fixed in the compiling pass.*

**How to read:** one line per loop. `state` ∈ untouched · half-built · built-unverified ·
awaiting-founder-taste · awaiting-decision · blocked · running. `owner` = who can move it
(worker / founder / Kai / Aran). Size = rough (S/M/L). ★ = founder-seeded loop (Tom's own list,
his framing kept). **Ordered by product area, not priority — the founder ranks.**

---

## Player & learning engine

- ★ **Course-switch READY perf** — shipped 07-30 (cinematic floor killed, walk ready-gated); on-device phone numbers not yet re-measured post-ship — built-unverified — founder (phone check) — S
- **Teacher classes-first PAC redesign** — in flight right now on `claude/teacher-classes-first` (@classes-first-fable, uncommitted DashboardView work) — half-built — worker — M
- **Pull-consistency tranche 3 browser pass** — welcome→first-cycle handoff, phase pill, mode buttons, INF-PLAY handoff, timer across pods — built-unverified — worker — S
- **INF-PLAY dead-end on free courses** — content to S0300 vs 668-seed list: forward-skip hits "staying put", no INF-PLAY offer; logged for owner during tranche 4 — awaiting-decision — founder — S
- **Playback write-path DB contention** — `bump_speaking_opportunities` 1.2s/call, `record_lego_pairings` 0.7s (same-row lock queueing suspected); plus inert `useEagerScriptPreload` to delete — untouched — worker — M
- **First-boot experience** — parked think-piece (staged loading narrative, instant first sound) → `docs/first-boot-experience.md` — untouched — founder+worker — M
- **Honest loading narration** — proposal written, two taste calls open in §4 (incl. whether warm loads show any message) → `docs/loading-narration-proposal.md` — awaiting-founder-taste — founder — S
- **Cold-cache load spends ~12.4s messageless** before the awakening pane even appears — flagged in the narration proposal, its own lane — untouched — worker — M
- **Player decomposition (plan 019)** — PlayerConductor shipped; full decomposition of the 18k-line LearningPlayer remains backlog; the conductor decision was **never journaled in DECISIONS.md** (process gap) — half-built — worker — L (journal fix: S)
- **Revision ramp on class resume** (NPTC promise 8d) — trigger + scope undesigned, pedagogy call first — awaiting-decision — founder — M
- **Teacher "Learn" button** — own-account learning that keeps the teach environment (logged 06-17, mobile layout question open) — untouched — worker after founder wording call — S/M

## Listening — pods, cups, mode, exercises

- ★ **PODS progression 0 → 0.5 → 1 and beyond** — L1 cups Phase 0 shipped; **Phase 1 blocked on Aran** (`course_listening_clusters` + authored 5/10/15/20 templates); Phase 2 every-round bookends unstarted — blocked/untouched — Aran + worker — M
- ★ **Listening MODE smoother/more intuitive** — July firefights all landed (pod-lap surfaces, teleprompter jank, cohort intake); no *logged* unresolved bug — what still feels rough is the founder's call to name — awaiting-founder-taste — founder+worker — M
- ★ **Listening exercises fonts/display** — 5 hardcoded `'JetBrains Mono'` literals in `ListeningOverlay.vue` instead of design tokens; TeleprompterScroll itself is fine — untouched — worker — S
- **`fix/pod-phase0-explainer-stage` branch** — listening v2 + Phase 0 explainer, awaiting Tom's ear/merge since June — awaiting-founder-taste — founder — S/M
- **Listening-pod ↔ course vocabulary overlap** (Popty) — explicitly parked by Tom ("another day") — awaiting-decision — founder — S
- **Interlude exposure backfill** — migration `20260724_backfill_meta_commentary_exposure.sql.gated` NOT applied (canary runbook required) — awaiting apply — founder — S

## VAD & adaptation & metrics

- ★ **VAD → product path** — capture pipeline fully built and wired in the player (`VoiceActivityDetector.ts`, consent-gated mic, `cycle_prosody` evidence) but **~0% adoption** (nobody has Personalised Pacing on; fields computed-then-dropped); the adoption/discovery surface is unbuilt and is a methodology call — half-built — founder (call) + worker (build) — M
- **VAD Lab → learner product** (Popty) — the lab is still an admin-only tool; no learner-facing route designed at all — untouched — founder — L
- **VAD Lab comparison-mode expansion** — parked pending founder listening to the record-yourself corpus — awaiting-founder-taste — founder — M
- **VAD Lab CEFR calibration** — per-CEFR variance bands need the founder's own graded recordings — awaiting-founder-taste — founder — M
- **VAD Lab clean-remaster** — script written (186 clips/14 voices), dry-run only; needs a box with `XAI_API_KEY` — half-built — worker — S
- **VAD Lab e2e tour suite** — never executed (chromium libs missing on watson-1) — built-unverified — worker — S
- **Chunked-take fusion-ladder A/B files** — generated for Tom's ear 06-13; the listen was never recorded as done — awaiting-founder-taste — founder — S
- **Adaptation engine v2** — ships shadow-only (computes + logs, applies nothing) until Tom flips `adaptation_v2.shadow:false` after a soak; WP-4 evidence-series migration DRAFT unapplied; WP-7b (dashboard pipeline job), WP-9 (boundary sensing), `?adaptdebug=1` overlay remaining — half-built — founder (flip/apply) + worker — L
- **CEFR-via-calibration (M4–M5)** — research roadmap, pilot-coupled timeframe — untouched — founder — L
- **VAD feedback design listening-priority work** → `docs/vad-feedback-design.md` — untouched backlog — worker — M

## Walkthroughs & self-explaining surfaces

- ★ **Self-teaching walkthroughs — coverage** — engine + 5 schools-dashboard walks live; **zero player-side walks, zero per-feature walks** (VAD etc.); a methodology-itself walkthrough is the founder's open question, deliberately undecided — half-built — founder picks targets, worker authors — S per walk
- **Walkthrough guardrails browser pass** — card-vs-topbar on a real notched phone — built-unverified — worker — S
- **How-this-works throb browser pass** — throb visual weight is explicitly a founder taste call — awaiting-founder-taste — founder — S
- **Guided missions** — one mission live on the canon node surface; open: founder taste on copy + whether missions grow beyond one; legacy-style surface inventory delivered for migration scoping — awaiting-founder-taste — founder — M
- **Self-explaining dashboard** — v1 (compiled explainer + noticing invitations) shipped; rule/persona expansion is open backlog — half-built — worker — M

## Offline & caching

- ★ **Offline robustness for teachers (Spotify model)** — genuinely works today: bulk presigned download, 30-day lease, graceful degradation; the residual gap is eviction (next line) — built, verified — (for reference) — —
- **AudioCache eviction** — fully designed, `evictToTarget` has zero callers → ephemeral cache grows unbounded on-device; only open inputs are trigger cadence + KEEP_BEHIND (defaultable) → `docs/audio-cache-eviction-design.md` — awaiting go — worker — S/M
- **PWA lifecycle later stages** — stages 1–2 shipped (boot watchdog, position authority); remaining design-doc scope unconfirmed; `design/pwa-lifecycle` branch unlanded — half-built — worker — M
- **Bundle cutover** — Phase 1 shipped (generator + types → @ssi/core); design carries ~15 remaining items; `design/bundle-cutover` branch unlanded — half-built — worker — L

## Money, entitlements, premium

- ★ **"Go Premium" shows for already-premium users — CONFIRMED BUG, root-caused, not yet fixed** — `SettingsScreen.vue` (~line 1976) branches on `isSubscribed` (Paddle billing only), never checks the ssi_admin/tester/grant entitlement bypass (`useEntitlement.checkCourseAccess`) — so role- or grant-covered users see the £15/mo upsell — worker — S
- ★ **Move-to-premium flow verification (free trial is dead)** — beyond the settings bug, remaining "trial" copy is the *institutional* trials (school/tutor platform, offline-lease taste), live by design; a final sweep for stray individual-learner free-trial copy is still worth one pass — half-verified — worker — S
- **All-languages on paid seats** — Tom's 07-14 ruling (paid seat → every language) not yet implemented; it's a simplification (delete per-course blocking); HOLD: coordinate with signup-flows work — untouched — worker — S/M
- **Family plan stage 2** — code fully wired; setting the two Paddle env vars IS go-live (founder sitting on it); pack open Qs: payer visibility depth, 7-day past_due grace — awaiting-decision — founder — S
- **Student annual pricing** — two `VITE_PADDLE_STUDENT_*_ANNUAL` vars need wiring + a monthly/annual toggle in the student join flow — untouched — worker — S
- **Group commercial model residue** — `y` per band, band list, annual/monthly discount, the Paddle integration build — awaiting-decision — founder — M
- **Capacity caps at redemption** — machinery ready (`invite_codes.max_uses`, single choke point); parked until policy numbers exist — awaiting-decision — founder — S
- **College dynamics** — play-as-class vs £5 student accounts, possible revenue-share angle — needs a Tom thinking session — awaiting-decision — founder — M
- **Webhook ordering-safety** — delayed stale Paddle event can overwrite newer state; needs `platform_updated_at` column + compare — untouched — worker — S
- **`subscriptions` one-row-per-learner** — precedence guard shipped; multi-row schema redesign deferred until tutors commonly hold two subs — parked — worker — M

## Schools & THE VIEW

- **Teacher/school_admin THE-VIEW convergence** — node home + rate-compare still 403 school staff; class node carries no teacher verbs; teacher tabs have no canonical node target. Founder ruling 07-30 settled teacher scope (own classes only, via class_teachers membership) — untouched, unblocked — worker — M
- **Schools teacher reads → server-mediated** — earn-it gated on co-teaching actually being built — parked — worker — M
- **Teacher-7d + daily-activity rollup** — needs new cross-learner rollup; blocked on an authz-pattern call (endpoint vs SECURITY DEFINER RPC; recommendation: endpoint) — awaiting-decision — founder (call) / worker — M
- **NPTC gap: class-wide skip/revisit** — per-learner jump exists, no class-level affordance; teachers hit this week one — untouched — worker — S/M
- **Insight Engine boards beyond Discovery** — course scoreboard, content-friction queue, health strip — untouched — worker — M
- **Remaining 5 HERO_RATES + learner-level drill** — rate-of-progress is real-path; the rest still demo-only — half-built — worker — M
- **Nav-unification residual** — legacy no-group govt_admin rows (region_code-only) still get the old flat views; needs a data migration to give them a group — untouched — worker — S
- **Legacy region/group backfill** — Ireland region/group mismatch + japan/wales groupless region_codes logged from dry-run; never applied — awaiting apply — founder — S
- **Gwynedd School 003 orphan** — reattach SQL handed to Tom, not run — awaiting-decision — founder — tiny
- **Region tier slice 3** — adoption flow + consent toggle per the design — untouched — worker — M
- **`schools/student-parent-onboarding` branch** — 2 commits from 07-13, possibly superseded by shipped region-tier work — needs scoping — worker — S
- **Onboarding cold-load flash hypothesis** — `showNoAccess` may flash before role fetch resolves; unverified since 07-02 — untouched — worker — S
- **Schools loose ends** — bulk-invite-staff endpoint (SetupView TODO); verify `contentFriction` RPC migration `20260602` applied — untouched — worker — S
- **Flexible grouping build** — think-piece written (year/dept/house tags, leader scope as predicate); consumer-first build unstarted — untouched — worker — M
- **Coverage-board per-teacher scoping** — the logged follow-on to the coverage board — untouched — worker — S
- **Missions/demos legacy-style surfaces** — old-generation dashboard styling inventory delivered; migration to canon awaits founder scoping — awaiting-decision — founder — M

## Invites, onboarding, growth

- **Per-person single-use links** — the one item left open from the invite rounds — untouched — worker — S
- **THE-MODEL implementation residue** — labels-not-types, tutor dissolution, invites people-only (doc written 07-18; how much is built vs pending was not re-verified this sweep) — needs scoping — worker — M
- **`release/onboarding-signup-pages` branch** — 10 commits, stale since 06-16 — dead or wanted? — awaiting-decision — founder — tiny

## Admin, ops, promotion, DB hygiene

- **Promotion backlog: staging → main is 130 commits behind dev's train** — the weekly promote (after Colombo vetting) is the single biggest accumulated loop; dev → staging is only 1 commit — awaiting-decision — founder — decision-only
- **Deploy sentinel stage 2 (client error beacon)** — designed, deliberately NOT built → `docs/deploy-sentinel-error-beacon.md` — untouched — worker — M
- **Deploy sentinel telemetry leg** — inactive until a service-role key lands in `~/.ssi-sentinel.env` on watson-1 (only anon keys there) — blocked — founder (secret) — tiny
- **Supabase cloud sentinels** — created as ProMax routines, blocked on `SUPABASE_URL`/`SERVICE_ROLE_KEY` env secrets in the cloud env — blocked — founder — tiny
- **Daily agent routines** — which analyses deserve a routine (WORKLIST groomer works today; Supabase ones need the key) — untouched — worker — S
- **`lego_progress`/`seed_progress` course-scoped unique key** — migration parked; per CLAUDE.md the 20260704 pair was canary-applied 07-05, but WORKLIST still lists both open and the files remain in `supabase/migrations/` — **reconcile the record** (verify live state, then archive the stale files + worklist lines) — worker — tiny
- **Org-table RLS tightening** — condition-gated on three triggers (demo data regenerated, client reads repointed, write path settled); parked by design, don't run early — parked — worker when conditions hold — L
- **Identity rationalisation renames** (`auth_user_id`/`learner_id` expand-contract, ~20 RLS policies) — gated to the RLS window — parked — worker — L
- **`class_sessions.teacher_user_id` dirty column** — mixed identities (81/76/8 split), Lane B writer fix + backfill designed, unapplied — parked — worker — M
- **ssi_admin danger-verbs browser pass** — guards shipped, browser verification pending — built-unverified — worker — S
- **Stray `origin/` directory in repo root** — real directory shadowing the git remote name (breaks bare `git log origin/dev`); verify contents then remove — untouched — worker — tiny
- **`fix/resume-position` branch** — 4 commits from 06-01, likely superseded by later hotfixes; confirm and close — untouched — worker — tiny
- **`pod-ladder-engine` branch** — 1 commit from 07-05, no worklist reference — needs scoping — worker — tiny

## Native / platform direction

- **Native migration Phase 0: iOS audio spike** — the go/no-go that gates ~10 downstream items (Capacitor shell, RevenueCat, push, OTA vendor, payment-rail policy, Flutter retirement); nothing downstream is startable until the spike runs and the founder rules — awaiting-decision — founder — L

## Content & course quality (Popty / ssi-dashboard-v7-clean)

- **Cross-course wrong-language sweep — DISCREPANCY** — learning-app WORKLIST marks it `[~] RUNNING` (07-24), but no ledger output exists anywhere on disk in Popty: it appears never to have actually run. Restart + verify — half-built — worker — M
- **zho S351–668 fix-queue** — 371 ranked real issues, unclaimed since 06-15 — untouched — worker — L
- **Known-language control policy for the regen prompt** (Popty #1 NEXT) — untouched — worker — M
- **zho strict-control pass + 90 ZUT consolidations** (#2, blocked on #1) — untouched — worker — M
- **French contract ratification from flags** (#3) — untouched — worker — M
- **Full strict re-lint zho + French** (#4, blocked on #1–3) — untouched — worker — S
- **Reorder-pilot promotion** (seed-aligned zho order → serving) — unblocked since the Dublin gate passed, unclaimed — untouched — worker — M
- **Metadata-gloss re-gloss** (~19 legos, 把/遍) — untouched — worker — S
- **Incremental/scoped TTS pipeline** (diff-scoped, methodology-aware) — untouched — worker — L
- **Script View regen-flow half** — display fix merged; the inline edit → regen → auto-preview half unconfirmed — half-built — worker — S
- **Phrase-level gate extensions** (coverage rule + 了/aspect-cue determinism) — BSC-deferred, prompt-only for now — untouched — worker — M
- **Pod-ladder fleet rollout** (ita/zho/spa/fra pod-0; hrv done) — half-built — worker — M
- **Cue-library rollout beyond spa_for_eng** — half-built — worker — M
- **ita/spa TTS backlog** — running under the $150 ceiling — running — worker — S
- **Big-10 semi-builds fan-out** — open design question, no plan — awaiting-decision — founder — L
- **Pair-contract derivation for non-English known languages** — untouched — worker — M
- **Learner migration on reorder** (frontier resume rule, content-hashed snapshots) — untouched — worker — L
- **Dublin gov pitch outcome** — never recorded/closed in the Popty worklist — founder — tiny
- **Purge placeholder rows migration** (11,124 pending/% rows) — written, gated, needs approval — awaiting-decision — founder — S
- **`docs/eng-for-x-remediation-handoff` branch** — handoff plan on an unmerged branch — Kai — M
- **Atom-fusion upstream persistence** — data layer built (schema, extractor, dry-run CLI); the persist-once + forced-align audio pass is a separate TTS-spend decision — half-built — worker + founder (spend) — L
- **`persist-stage0-pod0` pilot** — atom_map writes with NULL offsets; dry-run vs real-run state unconfirmed — half-built — worker — S
- **Forced-alignment switchover (MMS_FA replacing Azure timings)** — decided in principle, pipeline not switched at scale — decided-but-unbuilt — worker — M
- **Is `atom-fusion-introduction.md` still the audio-layer contract?** — pod-ladder productization may have superseded it — awaiting-decision — founder — tiny

## Kai's audio batch (owner: Kai — do not grab)

- **Heavies clone-repoint** — 5 courses, ~117k unlinked slots; prep done, xAI pricing corrected; repoint not approved/executed — awaiting-decision — Kai — L
- **Light-course backfill** (eng_for_guj/pan tail, ~5k slots) — last recorded as running; no completion record since — running (unverified) — Kai — S
- **3 courses with no voice_config** (deu_ch, fin_for_eng, por_for_jpn; ~118.6k slots) — needs a spend decision — awaiting-decision — Kai — L
- **Harmonise ~24k Azure/Sonia clips to the clone voice** — explicitly deferred as its own costed decision — awaiting-decision — Kai — L

---

*Register maintained by hand for now. When a loop closes, mark it closed with a date — don't delete;
the point of this file is that speed stops hiding things.*
