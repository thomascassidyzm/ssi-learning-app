# What is on dev to test tonight

**One URL, one browser, one sitting:** https://ssi-learning-app-git-dev-zenjin.vercel.app

Verified live at 18:25Z on 2026-08-06 — the app boots on a phone-sized screen, a Chinese session
starts and plays real audio through eleven clips, and there are zero console errors. Screenshots of
the resting screen, the mode tray and a cycle mid-play were taken from that live build.

Dev is now the single place everything lives. There is nothing else to install and no second link.

---

## Part one — what to test

### 1. Listening mode you can flick in and out of
**Where:** tap the sliders icon on the right of the player, just above the bottom bar. The tray
opens with **Listening mode — "Repeat sentences with passive listening"** as a plain on/off switch,
alongside Pronunciation and Offline.

This is the one you held the Friday train for. It is no longer buried in Settings — it is a single
tap from inside play, and a single tap back. Verified open and rendering on the live dev build.

### 2. The Easy / Fast switch on the resting screen
**Where:** the start screen, under the course name and belt — "Chinese for English speakers /
White Belt / Easy · Fast".

It sits with the mode you pick *before* you start, not buried in the tray. Easy doubles the pause
time, doubles the repetitions, and halves the longest phrase you will be asked to say. Fast is the
normal gear. New learners start on Easy. Turbo is gone from the app entirely.

### 3. Audio that refreshes when a clip has been repaired
**Where:** nothing to tap — listen for it. Any course where a clip was silent, clipped or wrong and
has since been fixed.

Every audio reference now carries the clip's revision, so a device holding the old bytes is forced
to fetch the repaired ones. This closes the last hole: the returning-learner path that rebuilt its
own script used to hand out unversioned references and quietly serve the pre-repair audio forever.
That path is now covered too.

### 4. A link into a specific cycle lands on the row that was clicked
**Where:** open a learning-app link from Popty's Script Viewer that points at a particular round and
cycle.

It used to land near the row, not on it, because Popty and the player enumerate a round slightly
differently. The link now carries the actual text of the row, so it anchors on that regardless of
the drift. A deep-linked launch also runs on plain learner defaults, so what you hear is what a
learner hears — and a deep link no longer follows you across a course switch.

### 5. Evidence, not a feature — German is playing unversioned audio
**Where:** nothing to test. It is written up on dev for you if you want it.

Live browser proof of why German still sounds stale, plus a note on the Popty/player disagreement
about what a round contains — which is a question for you, not a bug for us.

---

## Part two — what is deliberately not there

**The good news first: almost nothing had to be merged.** Four of the five things you were waiting
on were already sitting on dev, landed earlier under different commits. I checked each one line by
line rather than trusting the branch names, and dev turned out to be the newer, more complete
version of every one of them. So this was mostly a verification job, not a merge job.

- **The older Easy/Fast branch — not merged, superseded.** It still had the pace control living
  inside the mode tray as a left/right switch. Dev has since moved Easy/Fast onto the resting screen
  and retired the tray control, and dev also carries a piece of the per-mode wiring that branch
  never had. Merging it would have put a dead control back and broken the test suite. Dev's version
  is the one you have already seen and approved.

- **The audio-revision branch — not merged, superseded.** Dev already carries the same
  cache-busting contract, in a later and more complete form, including the returning-learner path
  the branch did not cover. Merging it would have installed a second, competing mechanism doing the
  same job.

- **Both deep-link branches — not merged, already there.** Every commit on them is already on dev,
  relanded under different hashes. Dev is a strict superset.

- **The staging back-merge branch — deliberately left alone.** It looked like the biggest pile of
  unlanded work, but its contents are staging's own history. Pulling it into dev would have dragged
  the held Friday train's lineage in with it and blurred exactly the separation you are relying on.
  Its genuinely new player work was already on dev anyway.

- **Design notes, diagnostics and half-built spikes — left where they are.** Region tiers, the
  parent/student onboarding sketch, the family plan, the pod-ladder engine, the bundle cutover
  design, and an unfinished courses security spike. None of them is something you can hear or feel
  in the player, and the unfinished ones carry real risk of breaking the build you are about to
  test, for no testing value.

**Nothing reached staging or production.** Both are untouched, per your hold.

---

## One small thing I fixed on the way

The German evidence probe I merged tripped the lint gate on its first run. One-line fix, committed
separately. All six gates are green: core build, typecheck, 1,602 tests, lint with zero errors,
plus the API typecheck and its 978 tests. A production build of the app also succeeds.

## Dev is at `476db930`
