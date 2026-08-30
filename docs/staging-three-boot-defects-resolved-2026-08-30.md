# What is now resolved on staging — 30 August 2026

Staging is running build `5f03671`. Every number below was measured against
`https://staging.saysomethingin.app` on that build, in a real headless Chromium,
with a fresh browser profile per run (no service worker, no IndexedDB, no
localStorage). Nothing here is quoted from an earlier document.

---

## 1. A first-time visitor on a slow connection can now start learning

**Before.** They got a blank screen that never resolved. The app raced the course
catalogue against a 2500 ms timeout and, on timeout, fell back to the offline
catalogue mirror — which a first-time visitor has never written. Nothing to fall
back to, so nothing happened, forever. I reproduced this on the *old* staging
build before promoting: one Fast 3G run, 60-second budget, five network requests
total, the play button never left `is-disabled`, and the app never even got as
far as choosing a course.

**Now.** Three of three Fast 3G runs as a first-time guest reach a pressable play
button and play real lesson audio. Zero stalls.

| | median | range |
|---|---|---|
| catalogue loaded | 2703 ms | 2659 – 2706 |
| play button pressable | 8157 ms | 8122 – 8571 |
| first lesson audio actually sounding | 8467 ms | 8413 – 8900 |

Two things changed. The catalogue query stopped asking for `select(*)` on the
courses table — 1.74 MB of Popty authoring notes for 83 rows that this app never
reads, 93 % of the first network dependency of every boot. And on the one path
where nothing exists to fall back to, the wait no longer ends: it keeps trying on
a backoff that climbs to 15 s and holds, and it tells the learner.

**The learner is told, and I checked it renders.** On a deliberately awful link
(250 kbps, 1500 ms latency) the notice appears at 14.0 s reading *"Still loading —
Your connection looks slow. This will start on its own as soon as it comes
through, so there's no need to reload."* The app then recovers on its own to a
pressable play button at 32.6 s. At no point is the screen blank.

Every path that *does* hold something playable keeps its 2500 ms budget. The
un-bounded wait exists only where the alternative to waiting is never playing.

---

## 2. Hungarian — same root cause, not a Hungarian problem

**Ruling: same root cause as (1), fixed by the same change.**

The evidence is that on the failing build the app never reached the point of
having a course at all. The request trace of the old-build failure shows five
requests: the page, the manifest, the SW config, the `courses?select=*` query,
and one image. No course-scoped request of any kind ever fires, and the probe
records `resolvedCourse: null`. A failure that happens *before* a course is
chosen cannot be specific to which course you were going to choose. The
Hungarian and Chinese runs on the fixed build also complete the catalogue leg in
the same time to within two milliseconds (2705 ms vs 2703 ms), which is the leg
that was broken.

**Now, on staging, `hun_for_eng`, Fast 3G, three of three runs play. Zero stalls.**

| | median | range |
|---|---|---|
| catalogue loaded | 2705 ms | 2689 – 2738 |
| course bundle loaded | 9986 ms | 9977 – 10179 |
| play button pressable | 10947 ms | 10851 – 12247 |
| first lesson audio actually sounding | 12046 ms | 11940 – 12574 |

Hungarian is slower than Chinese after the catalogue — 12.0 s to first sound
against 8.5 s — because its course bundle is bigger, not because anything is
wrong. That is a real 3G-class connection on a first cold visit with an empty
cache; a second visit reuses everything. I am flagging it as a number worth
knowing rather than as a defect.

---

## 3. The 6.5-second wait was main-thread JavaScript, and it is gone

The wait a learner feels is the play button being dead, not the bundle download.
The bundle fetch already started at ~200 ms and finished at ~2.4 s while the
learner still waited ~8 s — the fetch was never the wait. The whole-course script
was being built in one un-yielded block on the main thread, sitting exactly where
the button would otherwise go live.

Measured on staging, `spa_for_eng`, signed in, six runs, cold context each time:

| | pressable, median | range | Supabase queries |
|---|---|---|---|
| before the fix (recorded on dev) | 7938 ms | 7838 – 8247 | 124 |
| **staging now** | **5030 ms** | 4887 – 5824 | **45** |

Press to sound is 279 – 339 ms. Zero fallback paths taken on any run.

That is 2.9 seconds off the wait, and it matches the 5121 ms the fix measured on
dev — so the improvement is genuinely on the build Tom will open, not only on the
branch it was written on.

---

## Gaps, stated plainly

- **`hun_for_eng` has been verified as booting and playing, not as teaching well
  all the way through.** Three cold runs each confirm first lesson audio sounding;
  they do not run a whole session. That end-to-end pass is the thing Tom is doing
  himself tonight.
- **Fast 3G is an emulated profile** (Chrome DevTools' 1.6 Mbit / 150 ms preset via
  CDP), not a real phone on a real network. It is the same profile the original
  diagnosis used, so the before/after comparison is honest, but a real handset on
  real mobile data will differ.
- **The "before" number in section 3 is the one recorded on dev**, not one I
  re-measured on the old staging build. Re-running it would have meant reverting
  staging to measure a build I had just replaced. The "after" number is mine, on
  staging.
- **Nothing was promoted to `main`.** Production is untouched.
