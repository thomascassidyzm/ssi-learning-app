# Inventory — every learner-facing thing that is off the default path

Read of the live code on branch `a159-library-htw`, 2026-08-19. Read-only scout;
no code was changed. This is the working inventory behind the published summary.

## The rule used for "learner-facing"

A feature counts if a signed-in, non-admin, non-tester learner could in principle
use it, and it changes what they get out of the app. Anything only an admin or a
tester can see is listed but marked as such, because half the answer to Tom's
question turned out to be *who can even see this row*.

## What an ordinary learner actually sees in Settings

`SettingsScreen.vue` is 3,751 lines and renders 38 rows. Stripped of account,
billing, legal and recovery plumbing, an ordinary learner is offered exactly
**two** genuine learning preferences: interface language, and personalised
pacing. Everything else in the "Tools" card is gated.

| Row | Gate | Who sees it |
|---|---|---|
| Personalised pacing (mic/VAD) | none | every signed-in learner |
| Interface language | none | everyone |
| Learning Speed | `v-if="isTester"` | testers only |
| View Script / Course Explorer | `v-if="showViewScript"`, itself inside `v-if="isAdmin"` | admins only |
| QA Mode | `v-if="hasAdminRole"` | admins only |
| Debug overlay, verbose logging, listening audit, fragile-progress warning | inside `v-if="isAdmin"` section | admins only |
| Enter a code | `v-if="isSignedIn"` | signed-in |
| Install the app | none | everyone |

Correction to the premise the job started from: **personalised pacing is not
admin-gated.** Tom saw it while signed in as admin, but the row carries no
`v-if` at all. Every signed-in learner has always been able to see it. So the
problem with pacing is not visibility of the row — it is that the row is one of
38 in a screen nobody browses for pleasure.

### Orphaned toggles — handlers with no row

`toggleListeningMode`, `togglePronunciationMode` and `toggleFirePath` exist as
functions in the script block and are bound to **nothing** in the template.

- Listening mode survives this: it was deliberately moved to the player's mode
  tray on 2026-08-06 and the tray row is its real, ungated home.
- Fire path survives this: `ssi-show-fire-path` defaults to on, so removing the
  toggle just means it is always on.
- **Pronunciation practice does not survive it.** `ssi-mode-pronunciation` is
  read in `PlayerContainer.vue` and gates `showPronunciationBtn` into the mode
  tray, but nothing anywhere in the app can ever set that key to `true`. The
  whole `PronunciationOverlay.vue` — record yourself, compare with a native —
  is unreachable by any learner, admin or tester. It is dead code with a live
  `getUserMedia` call in it.

## The full list

| # | Feature | Where a learner finds it | Gate in front of it | How you would know they used it |
|---|---|---|---|---|
| 1 | `/me` — the learner profile: Adherence, Mirror, Portrait, Plan panels | nowhere; typed URL only | linked from no component in the app; route meta calls it a "preview surface" | no page-view event exists |
| 2 | Personalised pacing (mic/VAD) | Settings → Tools | off by default, then browser mic permission on top | mic-derived rows in `learner_lego_metrics`; `cycle_prosody` in `player_events` |
| 3 | Offline downloads / offline mode | player mode tray | none; free 30-day taste for non-payers | offline lease rows; download events |
| 4 | Listening mode | player mode tray | none | listening-session rows/events |
| 5 | Pronunciation practice | unreachable | no bound toggle anywhere — dead | n/a |
| 6 | How this works library — walkthroughs + search | Library screen | none; quiet text link with a one-time pulsing dot | localStorage only (`ssi-htw-seen`) |
| 7 | Course switching | Library; also `CourseSwitchRow` on the unreachable `/me` | none | 2+ `course_enrollments`, or sessions in 2+ course codes |
| 8 | Install as a PWA | self-surfacing banner, Settings row, `/install` | banner dismissible, permanently after 3 refusals | display-mode at session start, if logged |
| 9 | Enter a code / redeem | Settings → Codes; `/redeem/:code` | signed-in only | `entitlement_grants`, invite redemptions |
| 10 | Interface language (22 locales) | Settings | none | `ssi-locale` is device-local, unlogged |
| 11 | Learning speed | Settings | testers only | `learner_speed` is device-local, unlogged |
| 12 | `/methodology` explainer pages | not reachable by a learner | the router guard treats `/methodology` exactly like `/admin` and requires an admin role | not a learner feature |
| 13 | View Script, QA mode, debug overlay, verbose logging, listening audit | Settings | admin only | not learner features |

## The surfacing machinery already exists — pointed at staff

This matters more than any single feature, because it is the thing Tom is about
to design.

There is already a **noticing engine**: `explainer/evaluateRules.ts` +
`useNoticingInvitations.ts` evaluate a rules pack against data the page has
already fetched — zero new queries — and surface up to three invitation cards,
each dismissible for 14 days. There is already a **walkthrough engine** that
drives a walk over the learner's own real page, with per-persona and per-place
offer filtering and free-text search. There is already a **throb protocol**: the
"How this works" button pulses on first visit and re-arms whenever the
invitation set contains something not yet seen.

All three are built, tested and live. And:

- All **8 noticing rules** in `explainer/pack.json` are scoped to `class`,
  `group`, `school` or `org`. There is not one learner rule.
- `NoticingInvitations.vue` is mounted on exactly one surface, `NodeHomeView` —
  a staff page.
- Of **18 walks** in `walkthrough/pack.json`, 6 are offered to learners:
  other languages, going back over things, reading a course card, saving your
  progress (guests), your numbers, and where you are. **None** covers
  personalised pacing, the microphone, offline downloads, listening mode, or
  the profile.

So the engine for "notice what this learner has not done, and offer it" is
finished. What is missing is learner rules, learner walks, and a mount.

## One live-behaviour caveat that affects the numbers

`LearningPlayer.vue` carries a comment recording a live reproduction on
2026-08-02: consented learners booting via the instant-playback path had the VAD
dead — no timing windows, no `cycle_prosody`, no `learner_lego_metrics` rows at
all, because `getUserMedia` was never called across a full session. The re-arm
now runs on every boot path. Any mic-derived adoption figure covering the period
before that fix understates real consent, and should be read as a floor.

## Two things deliberately ruled out of scope

- **Missions** (`missions/`, `MissionCard.vue`) are mounted only in
  `SchoolsContainer` and `views/schools/DashboardView.vue` — a staff onboarding
  device, not a learner feature.
- **`/methodology`** looked like a learner explainer but the router guard at
  `router/index.ts:905` requires an admin role for it, exactly as for `/admin`.
  It is an internal surface and is scored as such.
