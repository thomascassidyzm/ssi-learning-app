# Test checklist before this week's release — 2026-08-07

**State, 11:20 UTC.** Almost nothing is waiting on dev — it's all already on **staging**, and staging is what you're about to release. Test on **https://staging.saysomethingin.app**. Three audio commits landed on dev this morning and are *not* on staging; they're row 13, on the dev URL.

The org, school and admin work you asked to go straight to production **already went this morning** — it is live and out of scope here. What's below is the learner-facing half that was deliberately held.

---

## The checklist

**1. Piece-by-piece introductions are gone.**
Learners no longer hear "The French for: 'I', is:" for each little piece of a phrase before the phrase itself. Only whole LEGOs get introduced now. This is shared code — all 96 courses, not just French. It has never been on production; learners on the live app were still hearing it this morning.
*Test:* open https://staging.saysomethingin.app, start any course from the beginning, listen through the first two or three rounds. You should hear an introduction for the whole phrase and never for its individual words.

**2. Easy and Fast replace Turbo.**
Two paces, picked on the player's resting screen before you start. Fast is exactly today's course — same pauses, same repetitions. Easy roughly doubles the thinking time and the repetitions, and drops the longest half of the phrases; it does *not* slow the speech down. Turbo is gone from the tray, the settings and the copy.
*Test:* on staging, open the player and look at the resting screen before you tap start — Easy / Fast should be there and the selected one visible. Switch to Easy, play a few cycles, listen for the longer pause. Switch to Fast, confirm it sounds like today's course.

**3. A brand-new learner starts on Easy; an existing learner stays on Fast.**
Nobody currently learning is moved silently.
*Test:* on staging, sign in as one of your existing test accounts — it should be on Fast. Then open a private window with `?reset=1` and start fresh — that one should land on Easy.

**4. Listening is back in the mode tray, one tap each way.**
The old "pick one mode" radio group is gone. Listening is now an on/off row in the tray you already open mid-session, sitting alongside Pronunciation guide and Offline, and the same row turns it off again. It also goes straight in — no intro popup first.
*Test:* on staging, start a session, open the sliders tray at the bottom, tap Listening — it should drop straight into listening with no popup. Tap the same row again to come back out.

**5. Listening audio follows the belt speed ramp.**
Target clips in listening now play at whatever speed your belt is on, instead of a flat normal speed. Higher belts hear it faster, as in speaking.
*Test:* on staging, go into listening on a test account at a higher belt and listen — the target clips should be at the ramped pace, not slower than the speaking rounds were.

**6. No prompt plays three times in a row.**
Anywhere — normal rounds, the pod laps, and the offline fallback ladder that used to loop one cycle when nothing else was available.
*Test:* on staging, play ten minutes of a session and listen for the same phrase coming round a third consecutive time. It should never happen. (Adding `?fc=1` to force interjections gives the scheduler more to trip over.)

**7. The interjection card no longer renders blank.**
The little between-things card that carries the spoken interjection was drawing with no visible content.
*Test:* on staging, open the player with `?fc=1` so an interjection fires at every round boundary — the card should show its text, not an empty panel.

**8. A dead clip can no longer stall a session, and the app counts them.**
This is Aran's German hard-stop on "with you". A clip that 404s or hangs is retried twice, skipped, and the session carries on. Nine in a row now shows up as one hollow session in the diagnostics rather than nine unrelated blips.
*Test:* on staging, play a stretch of German and confirm it runs end-to-end without stopping. The counting half is diagnostics only — nothing to see.

**9. The app no longer dies halfway through updating.**
Taking an update used to activate the new code under the running page, which deleted chunks of the page's own code from under it — hence the crash and then a finished app on reopen. Taking the update is now a plain reload fired inside your tap, which fetches the new build straight from the network. If the reload doesn't take on iOS, the banner comes back as a relaunch button.
*Test:* on staging, install to your home screen, use it, and when the update banner appears tap it. It should relaunch cleanly onto the new build with no crash.

**10. The pod-start reminder banner is gone.**
The transient banner that appeared over the first line of a listening pod has been removed, along with the space it reserved. The teleprompter sits where it should.
*Test:* on staging, start a listening pod and watch the top of the screen — no banner, and the first line shouldn't be pushed down.

**11. A course with no pods stops serving a stale downloaded snapshot.**
Welsh in particular: if the server says the course has no pods, the old offline snapshot is dropped rather than replayed.
*Test:* on staging, open Welsh on a device that has downloaded it before — it shouldn't offer pod listening content the course no longer has.

**12. "How this works" is rewritten for the new modes.**
The learner explainer now describes Easy and Fast rather than Turbo, says where listening lives, and adds a short passage about what the listening stretches ask of you.
*Test:* on staging, open Settings → how this works and read it. No mention of Turbo anywhere.

**13. Repaired audio clips reach every path — dev only, not on staging yet.**
Three fixes landed on dev this morning: the client's own script walk, a downloaded listening snapshot, and the pod scene view all now ask for the repaired version of a clip rather than the old one. The first of these already went to production as a hotfix; these three close the remaining paths. **This is not on staging and would not ride this week's release** unless you promote dev first.
*Test:* only on https://ssi-learning-app-git-dev-zenjin.vercel.app — open German, play, then reload and play again; a repaired clip should sound repaired both times.

**Grouped:** rows 6 and 8 each cover several separate commits that do one thing between them; row 13 collapses three fixes to the same mechanism. Nothing was dropped silently.

---

## Not learner-visible — nothing to test

Roughly two thirds of this set touches nothing a learner or teacher sees: the browser probes and unit tests written to verify the above (about twenty files), APML specs for the consecutive-repeat law, the player conductor, listening layers and the audio architecture, and a large pile of investigation write-ups — the German chopped-clip census (one 87,000-line data dump, which is most of the headline line count), the Welsh silent-stub finding, the A-22 audio exposure map, the easy/fast placement notes, the deep-link and stall diagnoses, and the release-train reports.

Two server-side items also ride along and cannot be checked by hand: a database change that makes a **co-teacher's class page load in normal time** (already canary-applied to the live database, so it is in effect now), and a build-config change to how the app's chunks are named. Internal renames in the core package — `turbo_boost` becoming `fast_mode` / `easy_mode` — are the same feature as row 2, not a separate thing.

The schools fixes you may remember from yesterday — the benchmark panel that got stuck on "loading", and a class not claiming "0 students" when its roster failed — are **already in production**; they went with this morning's promotion.

---

## Size of the divergence

- **dev → staging:** 3 commits. 14 files, 692 added, 44 removed. All three are the repaired-clip work in row 13.
- **staging → main:** 137 commits by patch count, but that number is inflated — this morning's production promotion cherry-picked 47 of them onto main with conflict resolutions, so their patches no longer match. Content: **151 files, 97,482 added, 1,010 removed** — of which one census data file is 87,065 lines. Excluding docs, specs, tests and probes, the code that actually runs is **66 files, 2,324 added, 817 removed.**

---

## Appendix — technical detail

Snapshot taken 2026-08-07 11:20 UTC, after `git fetch origin`. `origin/dev` = `8ba48282`; `origin/staging` = `2d1a0738`; `origin/main` = `283e81ab`.

Note that dev moved during this pass: at 11:18Z it was `05f736fd` with zero divergence from staging; the three A-86 commits (`d33c2fe5`, `9a2bd7f1`, `8ba48282`) landed at 11:20Z. Row 13 reflects the later state.

Commands run:

```
git fetch origin
git cherry origin/staging origin/dev          # 3 '+' commits
git diff --shortstat origin/staging...origin/dev
git cherry origin/main origin/staging          # 137 '+', 1 '-'
git diff --shortstat origin/main...origin/staging
git diff --stat origin/main...origin/staging
```

Reused prior work: `docs/dev-to-staging-review-2026-08-06.md` (the Easy/Fast learner-facing description and the code-vs-docs line split), `docs/promote-dev-to-staging-2026-08-06.md` (the never-stall and audio-stamp verification), and `docs/promote-non-learner-to-production-2026-08-07.md` (which non-learner work already reached main, and therefore what is *not* on this list). The component-intro evidence is `docs/introductions-audio-coverage-2026-08-05.md`.

Key files behind each row:

| Row | Where |
|---|---|
| 1 | `api/courses/[code]/cycles.ts` — `component_intro` no longer emitted; `providers/backendCyclesToRounds.ts` |
| 2, 3 | `components/PlayerRestingState.vue`, `composables/useAlgorithmConfig.ts`, `composables/newLearnerMode.ts`, `useAuth.ts` (`turbo_mode_enabled` → `learning_mode`), all 22 locale files |
| 4 | `components/ModeTray.vue`, `components/BottomNav.vue`, `LearningPlayer.vue` |
| 5 | `playback/listeningSpeedRamp.test.ts`, `composables/useLayer1Scheduler.ts` |
| 6 | `playback/capConsecutiveRepeats.ts`, `composables/usePodLapScheduler.ts`, `composables/useOfflinePlay.ts` |
| 7 | `playback/interjectionDisplay.ts` |
| 8 | `playback/SimplePlayer.ts`, `providers/generateLearningScript.ts` |
| 9 | `components/PwaUpdatePrompt.vue`, `composables/useServiceWorkerSafety.ts`, `utils/bootHeal.ts` |
| 10 | `composables/usePodListeningReminder.ts` (deleted), `components/PodTurnDisplay.vue` |
| 11 | `composables/useListeningPods.ts`, `composables/listeningMetaCache.ts` |
| 12 | `explainer/learnerExplainers.ts` |
| 13 | `providers/revisedAudioRefs.ts`, `providers/CourseDataProvider.ts`, `composables/listeningMetaCache.ts`, `components/ListeningOverlay.vue` — dev only |

Ambiguity recorded rather than guessed: `utils/deepLinkTarget.ts` differs only in a comment, so the deep-link work is already on main and gets no row. `packages/core/src/config/*` and `ratePolicy.ts` changes are the Easy/Fast rename, folded into row 2.

One repo-hygiene note, not a test item: `55624411` on dev silently rolled back the interjection-card fix, the listening speed ramp and their probe (documented in `docs/promote-non-learner-to-production-2026-08-07.md`). Those files are present on both `origin/dev` and `origin/staging` as of this snapshot, so nothing is missing from the release — but the incident is why the two branches' histories disagree about them.

No promotions were run and no branches were merged as part of this pass.
