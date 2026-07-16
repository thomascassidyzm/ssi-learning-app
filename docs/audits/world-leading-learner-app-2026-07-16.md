# World-leading learner app — audit, 2026-07-16

**Mandate:** live inside the product as a learner and rank the gaps between what exists and
world-leading. Audit only — no fixes made; the founder selects from this list.

**Method:** four parallel walkthroughs of `staging.saysomethingin.app` in real browsers
(Playwright, iPhone-14 viewport primary, desktop spot-checks), console + network captured
throughout: (1) fresh learner first-ever session, (2) returning learner / progress / belts /
settings, (3) paywall + money moments, (4) modes — listening / turbo / offline / pods.
Synthetic `@ssi-internal.test` accounts minted via the admin OTP pattern (zero real email);
no payment ever completed. Evidence: ~300 screenshots + phase logs under `/tmp/audit-fresh/`,
`/tmp/audit-return/`, `/tmp/audit-money/`, `/tmp/audit-modes/` (paths cited inline).
Judged by SSi's own philosophy (speaking-first, no streak-guilt, choose-easy, invisible
adaptivity — world-leading means MORE itself, not more gamified), held to the polish bar of
the best consumer learning products.

**Caveats:** audio itself is unhearable in automation — timing, network, and state were
observed instead. The in-round pod lap (Croatian, activation ~round 6) was not reached within
budget — flagged untested, not broken; the same pod content is confirmed working via
Listening → Dialogues. Everything else below was observed directly, most of it reproduced
independently by two workers.

---

## BROKEN — bugs first, ranked (these outrank every polish item below)

### B1. The paywall is a dead end at the exact moment of conversion — CRITICAL
A guest or free signed-in learner who hits the Yellow-belt ceiling gets the (genuinely good)
"You've reached the end of the free preview" card — and **neither button works**. Real taps on
"Subscribe — £15/month" and "Maybe later" land on the resting-state layer bleeding through
underneath (`document.elementFromPoint` at both button centres returns
`.resting-content`/`.course-subtitle`, not the buttons). Backdrop tap and Escape do nothing.
**The only exit is force-reloading the app.** 100% reproducible, both trigger paths (belt-picker
jump, course-browser seed tap), guest and signed-in, confirmed independently by two workers.
A programmatic DOM `.click()` *does* dismiss it — this is a CSS stacking/pointer-events bug in
`LearningPlayer.vue`'s paywall markup (~line 12854): `.resting-state` is correctly
`pointer-events:none` but a child re-enables `auto` and paints above the overlay's hit area.
- **Learner-felt:** "the app broke" at the one moment SSi asks for money. Revenue-blocking.
- **Fix:** small (CSS containment/z-index in one component). The Settings → "Go Premium" door
  works perfectly and proves the Paddle checkout itself is healthy.
- **Evidence:** `/tmp/audit-money/g09-after-orange-jump-attempt.png`, `g17-tap-maybe-later-result.png`,
  `/tmp/audit-return/phase4c-log.txt` (hit-test dump).
- **Confidence: high** — double-confirmed, mechanically diagnosed.

### B2. Selecting Spanish silently drags in Mexican Spanish — wrong identity, broken data, error spray
Choosing "Spanish for English Speakers" (`spa_for_eng`) also processes `spa_mx_for_eng` in the
background. Consequences observed: the belt/community modal titles itself with the raw code
"**SPA_MX**" (wrong course AND an internal code shown to learners); repeated `406`s on
`course_enrollments?course_id=eq.spa_mx_for_eng`; `[generateLearningScript] Skipped 5462
practice phrases for "spa_mx_for_eng" (missing audio IDs)` + `Skipped 689/1372 LEGOs`; six
`/api/audio` `504`s while background-fetching audio for a course the learner never chose.
Likely affects every variant-pair language (French, Portuguese, Arabic, Welsh…).
- **Learner-felt:** wrong course name on their progress surface; wasted bandwidth; audio
  timeouts during real play.
- **Fix:** medium — find why the sibling variant loads (course-group prefetch?) and scope it;
  separately, never render raw course codes (display-name lookup).
- **Evidence:** `/tmp/audit-money/g06-belt-modal.png`, `s05-signedin-belt-modal.png`, console logs.
- **Confidence: high** on the symptoms; the single-root-cause reading is probable, unverified.

### B3. `POST /api/player-events` returns 500 on every course load (staging)
Every session, multiple times. `player_events` is the documented source of truth for audio-play
analytics (`audio_plays` was dropped in its favour) — if this is failing consistently, play
telemetry is silently lost, and it is the prime suspect for B4.
- **Fix:** small-medium (server-side diagnosis; likely env/schema drift on staging).
- **Evidence:** all four workers' console captures; also present on a clean guest first boot
  (`/tmp/audit-fresh/run1/console.json`).
- **Confidence: high** it's broken on staging; **unknown** whether prod shares it — check first.

### B4. The progress surfaces show zeros after real practice (signed-in)
After multiple signed-in rounds: progress modal reads SESSION **0:00**, ALL-TIME **0m**, and
"**0** MINUTES OF SPANISH TODAY · THE SSI COMMUNITY". The session timer pill stayed at 0:00
through 45+ seconds of confirmed play (it ticked normally as a guest — signed-in-specific or
intermittent). The app's only motivation surface tells an active learner: you've done nothing
and nobody else is here.
- **Fix:** diagnose with B3 (same write path is the likely culprit), then verify the rollups.
- **Evidence:** `/tmp/audit-return/20-progress-modal-open.png`, `phase2c-log.txt` (timer poll);
  contrast `/tmp/audit-fresh/cycles/shot-003.png` (guest timer at 0:08, ticking).
- **Confidence: high** on what was seen; root cause unproven.

### B5. Going offline mid-session permanently blanks the prompt card until a full reload
Play → drop the connection → the network errors are all caught gracefully (good) — but the
resting card collapses to the bare course name ("Chinese", no phrase, no label) and **never
recovers**, even after connectivity returns. Only a full page reload fixes it. A learner on a
train reads this as broken, not offline-graceful — undercutting an otherwise excellent
offline story (see Worth Protecting).
- **Fix:** small-medium — the resting-card renderer needs to re-derive after its source
  errors mid-flight.
- **Evidence:** `/tmp/audit-modes/103-offline-t3.png` → `107-back-online-t7.png`.
- **Confidence: high** — clean repro.

### B6. The install banner sits on top of the mode-tray trigger — and returns every load
"Install SaySomethingin" slides up directly over the mode-tray button (Playwright: the click is
intercepted by `install-banner-dismiss`) — while showing, Listening/Turbo/Offline are
unreachable. It reappeared on **every** fresh page load (10+ sessions), not once-per-device.
A "New version available — Later/Update" banner also appeared ~63s into a learning session,
over the live player. See also Gap 4.
- **Fix:** small (placement + frequency cap + suppress-during-play).
- **Evidence:** `/tmp/audit-modes/30-normal-done.png`, `/tmp/audit-return/phase2b-log.txt` (t=33s, t=63s).
- **Confidence: high.**

### B7. Paused-state contradictions
While paused, the hero card still shouts "YOU'RE MEANT TO BE SPEAKING NOW"; the sr-only
announcer says "Paused" while audio requests continue to fire; 61 audio requests fired during
15 seconds of untouched resting state; after pause→resume the play/pause affordance and actual
state can disagree. Individually small; together the player's state is not always legible or
truthful.
- **Fix:** small-medium sweep of pause/resume state + phase-hint gating in the player.
- **Evidence:** `/tmp/audit-return/phase2d-log.txt`, `phase7b-log.txt`,
  `/tmp/audit-return/46-italian-played.png` (speak-now banner on a paused player).
- **Confidence: high** on observations; some may be deliberate (prefetch continuing) — the
  *visible contradiction* is the defect.

### B8. Content: `S0476L01` (zho_for_eng) `known_text = "second half (of game"`
Unclosed parenthesis — malformed English AND a direct violation of the zero-parentheses law.
Confirmed the only paren-carrying known_text in zho_for_eng's 1,190 LEGOs (one-off, not
systemic). Runtime already warns: `1 LEGOs with bracket explanations`.
- **Fix:** one row, cut-it-out or rewrite per the QA rubric.
- **Confidence: high** — read from the DB directly.

### B9. `?seed=` deep link is a silent no-op; a code comment claims it works
No code reads a `seed` URL param; the comment at `LearningPlayer.vue:10610` ("incl. ?seed=") is
stale. Not a bypass risk (the wall holds everywhere real) — just a lie in the code and a dead
test-cheat.
- **Fix:** one-liner (comment) or small (implement it as the dev cheat it's documented to be).
- **Confidence: high.**

---

## THE TOP 10 GAPS — ranked by learner-felt impact

### 1. Nobody ever tells the learner to speak
**Now:** a brand-new learner sees "GET READY TO SPEAK", then a known-language phrase, then a
pause with the hint "you're meant to be speaking now" — red, scold-toned, and the *only* cue
that speaking aloud is the entire method. Nothing on first boot says the one sentence that
matters: *you'll hear a phrase you know — say it out loud in Spanish before the speakers do.*
The intro instead relies on welcome audio a kitchen-noise phone user may not absorb, and the
coaching story arrives later. A curious adult can spend their whole first session listening
politely, never speaking — practising the wrong method perfectly.
**World-leading:** the method demonstrates itself inside 30 seconds — one localized on-screen
line before round 1, phase hints that coach rather than scold ("your turn — out loud"), and the
already-designed staged first-boot narrative. `docs/first-boot-experience.md` already specifies
exactly this (global brand moment → one i18n line → straight into round 1); it's parked, not
contested.
**Fix:** medium — first-boot line + phase-hint copy pass + hint tone. Surfaces: `LearningPlayer.vue`
phase hints, first-boot splash, i18n.
**Confidence:** high on the gap (all four workers experienced the cold open; the fresh worker's
full transcript is still in capture, but its screenshots and logs ground this); the *solution*
is already Tom-directed in the parked doc.

### 2. The app never shows you you're changing — the transformation layer is missing
**Now:** the only visible progress is a belt pill and minute counters — currently reading zero
even after real practice (B4). No "new phrases you produced today", no response-time trend, no
journey timeline, no evolution level, no return-consolidation warmth. The entire
`docs/gamification-done-right.md` framework — the soul document — is essentially unshipped
surface: `daily_contributions` and days-active data exist server-side; the learner sees almost
none of it.
**World-leading:** SSi's own vision, verbatim — the "30 minutes ago mirror" after each sitting,
the journey timeline (never a streak), the evolution score, hidden-formula consistency warmth.
No competitor can copy this shape because it's built on speaking-first telemetry they don't have.
**Fix:** large, but stageable: (a) fix B3/B4 so existing numbers are true; (b) session-end
mirror stats (data already captured); (c) timeline + evolution later. Surfaces: SessionComplete,
ProgressModal, resting state.
**Confidence:** high — this is the biggest philosophical delta between the docs and the product.

### 3. Coming back is met with indifference
**Now:** a day-3 returner gets the identical "Ready when you are" as a first-timer. Resume
*position* is flawless (verified: cursor survives reload, sign-out, cross-context) — but the
moment carries zero recognition, when the return-after-absence moment is precisely where SSi's
no-guilt stance can *shine* instead of merely abstaining.
**World-leading:** the vision doc's own table — "Your brain has been consolidating. Let's see
what stuck!" (3 days), "You might surprise yourself" (7+) — keyed off days-active data that
already exists (`docs/sessions-and-days-active.md`).
**Fix:** small — copy variants on the resting state keyed on days-away. Surface:
`PlayerRestingState.vue` + the greeting line's data hook.
**Confidence:** high; lowest-effort/highest-warmth item on this list.

### 4. Interruption discipline — the app talks over the learning
**Now:** the install banner appears mid-session (~33s in — during a first session!), covers the
mode tray (B6), and returns every load; the update banner lands mid-cycle at ~63s; a navy
"Save Progress" CTA floats mid-screen inside the learning canvas during guest play
(`/tmp/audit-fresh/cycles/shot-003.png`). The one thing the screen must protect is the
speaking moment.
**World-leading:** nothing interrupts an active cycle, ever. Prompts wait for the resting
state or session end; install is offered once, then respects the dismissal.
**Fix:** small — gating + placement rules for the three banners. Surfaces: App.vue banner
logic, install-prompt composable, LearningPlayer guest CTA.
**Confidence:** high.

### 5. The player's state isn't always legible or true
**Now:** B7's cluster — "SPEAK NOW" while paused, ambiguous play/pause affordance after rapid
taps, a session timer that sat at 0:00 signed-in. Trust in an audio-first product hangs on the
one visible state indicator being truthful.
**World-leading:** at any glance: am I playing, paused, or between rounds — one honest state,
timer always alive during play.
**Fix:** small-medium (state gating sweep). Surfaces: LearningPlayer phase card, pause handling,
timer pill.
**Confidence:** high on symptoms.

### 6. Modes are excellent but under-explained
**Now:** Immersion vs Drill are visually identical before pressing play — no label, icon, or
one-liner distinguishing them (Turbo and Offline both carry sub-descriptions; these carry
nothing). "Loading pods…" is a bare spinner for ~5s. The in-round pod payoff is functionally
invisible to a first sitting (activation depth ≫ a first session), so Dialogues is the de-facto
front door without being framed as one.
**World-leading:** every mode carries its one-line promise; loading states carry content hints;
the first pod encounter is staged deliberately rather than left to archaeology.
**Fix:** small (copy + a loading skeleton). Surfaces: ListeningMode tabs, mode tray.
**Confidence:** high — direct observation; in-round pod quality itself untested (flagged).

### 7. The community counter currently argues *against* the product
**Now:** "0 MINUTES OF SPANISH TODAY · THE SSI COMMUNITY" — on one of Earth's biggest
languages. Whether zero comes from the B3/B4 pipeline or a real empty cohort, shipping a
dead-reading number on the flagship social surface says "nobody is here." The contribution
counter is *the* social feature per its spec (`docs/contribution-counter-spec.md`) — it must
never be able to read as a morgue.
**World-leading:** the spec's own design — live multi-timeframe counter, "you contributed X",
"every phrase keeps Welsh alive" — with an honesty rule: below a liveness floor, show warmth
("the community spoke 40 hours this week") not a raw zero.
**Fix:** small-medium once B3/B4 land: aggregation + floor + placement.
**Confidence:** high the surface reads dead now; medium on which layer zeroes it.

### 8. First boot: fast machinery, cold theatre
**Now:** the guest shell is genuinely fast (~1.1s window.load, cycles fetched by ~1.3s — measured)
— but it opens on a **black pre-hydration flash + red spinner** (`index.html` hardcodes
`#050508`; the manifest gives installed PWAs a black splash) before the warm Mist canvas, and
the slow path (new-device INF-PLAY build, cold functions) still shows an unnarrated dead
window. Round-map and first-cycles requests also fire duplicated (2–3×) on boot.
**World-leading:** the parked plan in `docs/first-boot-experience.md`, cheapest-first: Mist-toned
shell, staged event-keyed messages, prewarmed first sound.
**Fix:** small for the flash/splash + dupes; medium for the staged narrative. Surfaces:
`index.html`, `vite.config.js` manifest, boot pipeline.
**Confidence:** high — measured directly.

### 9. Course identity leaks internals
**Now:** raw codes reach learners: "SPA_MX" as a modal title (B2); variant pickers expose
"2 variants" ambiguity without saying how Spanish-vs-Mexican-Spanish differ or which to choose;
the money worker's brief itself carried a stale "Welsh is free" assumption — the app says
premium (correct per `pricing_tier`), but nothing in the UI tells the Welsh-curious learner the
17-year flagship story or the "slated to join the free tier" intent.
**World-leading:** every course presents a human name, one line of who-it's-for, and variant
guidance ("Spain • Latin America — pick either, switch anytime").
**Fix:** small-medium (display-name discipline + variant copy). Surfaces: course switcher,
belt modal, CourseBrowser.
**Confidence:** high.

### 10. Offline: world-class download, broken landing
**Now:** the download UX is the best moment in the app (one honest slider, live MB + "carries
you ~2% further", truthful progress in two places) — and then actually *being* offline blanks
the prompt card until reload (B5), and the graceful-degradation ladder
(belt-only → USE phrases → repeat) was not observably communicated ("downloading is acceptable;
mismatched/blank is not").
**World-leading:** losing signal is a non-event: card stays truthful, a quiet "offline —
playing from your downloads" line appears, recovery is automatic.
**Fix:** B5 first (small-medium); then a one-line offline status surface (small).
**Confidence:** high — clean repro both ways.

---

## FIVE QUICK WINS (each under a day)

1. **Mist-ify the boot chrome.** Swap `#050508` → Mist tokens in `index.html` (pre-hydration
   background + `theme-color`) and `vite.config.js` manifest `theme_color`/`background_color`;
   restyle the red boot spinner. Kills the black flash on every open and the black PWA splash.
2. **Banner discipline.** Suppress install/update banners while a cycle is active; move the
   install banner off the mode-tray trigger; honour dismissal across loads (B6).
3. **Return-celebration copy.** Key the resting-state line on days-away using existing
   days-active data — the four lines are already written in `docs/gamification-done-right.md` §6.
4. **Mode one-liners.** Sub-descriptions for Immersion vs Drill (mode tray already has the
   pattern), plus a content-hinting loading state for "Loading pods…".
5. **Content + honesty nits in one pass.** Fix/cut `S0476L01` "second half (of game"; render
   course display names instead of raw codes in the belt modal (the SPA_MX *display* half of B2);
   correct the stale `?seed=` comment at `LearningPlayer.vue:10610`.

(The B1 paywall fix is also likely under a day — it lives at the top of BROKEN because it's the
first thing to select, not because it's slow.)

---

## WORTH PROTECTING (found genuinely world-leading — don't "improve" these)

- **The paywall copy and pricing honesty.** Price visible *before* any wall (switcher banner,
  PREMIUM chips + "Try free"), calm wall copy, "Cancel anytime" up front, no urgency theatre.
  Fix B1 and this money moment is done — do not add persuasion.
- **Resume.** Position (last LEGO played) survives reload, sign-out, new contexts, and course
  switches, in ~2.5–4s. Quietly excellent.
- **The offline download picker.** One slider, honest live numbers, no fake progress.
- **Listening → Dialogues.** Day-in-the-life scenes, named speakers, turn-taking teleprompter,
  glosses only on the active turn, and the eye-toggle to strip all text — audio-first philosophy
  as an affordance. Free Croatian gets the same depth as paid Chinese (content parity).
- **The VOICE_2 LEGO tiling.** Sentence construction shown by tiles, never explained by labels.
- **No streak-guilt anywhere.** Verified across every surface touched.
- **Settings honesty.** Reset/delete flows with plain-language, type-to-confirm gravity.
- **The mode-tray backdrop fix holds** — zero eaten taps across ~15 sessions.

---

## Untested / lower confidence

- **In-round pod laps** (Croatian round-6 activation): not reached in budget; Dialogues surface
  confirmed rich and working. Needs one long-play session or a round-jump cheat to verify.
- **Audio quality/sync itself:** unhearable in automation. Phase timing (~11–13s cycles,
  pause ≈ 2× target) matched spec; the zero-tolerance text/audio-match bar needs a human ear pass.
- **Prod parity of B3** (`player-events` 500): observed on staging only — check prod before
  concluding data loss.
- The fresh-learner worker's full narrative was still in harness capture at writing time; its
  timings, console, and screenshots are incorporated above from its on-disk artifacts
  (`/tmp/audit-fresh/`), as are the return worker's (report lost in transit, reconstructed from
  its complete phase logs).
