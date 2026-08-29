# What a learner actually waits for before first play — measured 2026-08-29

> Brief: "2+MB is too big a wait before first play. Spotify is the model...
> start the bundle fetch on INTENT, not on press." (Tom, 2026-08-29 19:17Z)
>
> This document reports what the measurement found, which is not what the
> brief assumed. Everything below is from real headless-Chromium runs against
> the **deployed dev build** (`709f0dd1`) and the **deployed staging build**,
> cold profile per run — no service worker, no IndexedDB, no localStorage
> beyond an injected session. Harness:
> `packages/player-vue/e2e/first-play-wait-probe.mjs`.

---

## 0. The headline

**The bundle fetch already starts on intent, and it is not what the learner
waits for.**

On dev the bundle download begins **219–550 ms** after navigation — before the
course list, before enrollment, at the first moment a course can be named — and
finishes at **1.7–2.3 s**. Zero fallbacks in any run. The learner then waits
another **six and a half seconds** with the play button disabled.

Pressing play is not a wait at all: **press → sound is 55–265 ms**.

The wait is the play control being `is-disabled` (pulsing red, taps ignored)
until the player reports ready. Cold, that is **8.5–9.0 s** on `spa_for_eng`.
Of that, the bundle accounts for about 1.8 s of *overlapped* network, and
**4.7 s is a single block of main-thread JavaScript with no network activity
at all**.

Starting the fetch earlier cannot move this number, because the fetch is
already finished long before the block that holds the button.

## 1. Time to a pressable play button — deployed dev, cold cache

`pressable` is when `.center-btn` loses `is-disabled`. `press→sound` is from the
press to the first course clip calling `play()` (hooked on
`HTMLMediaElement.prototype.play`, so it is the sound, not the request).

| run | link | bundle starts | bundle done | **pressable** | press→sound | fell back? |
|---|---|---|---|---|---|---|
| `spa_for_eng` signed in | unthrottled | 223 ms | 2241 ms | **8993 ms** | 222 ms | no |
| `spa_for_eng` signed in | unthrottled | 385 ms | 1998 ms | **8697 ms** | 264 ms | no |
| `spa_for_eng` signed in | unthrottled | 197 ms | 1857 ms | **8494 ms** | 195 ms | no |
| `spa_for_eng` signed in | 4G (9 Mbit/60 ms) | 523 ms | 2073 ms | **5863 ms** | 55 ms | no |
| `spa_for_eng` signed in | 4G | 525 ms | 2024 ms | **5700 ms** | 98 ms | no |
| `hun_for_eng` anon | unthrottled | 197 ms | 604 ms | **5158 ms** | 193 ms | no |
| `hun_for_eng` anon | unthrottled | 228 ms | 787 ms | **5424 ms** | 175 ms | no |
| fresh, no `?course` (→ `fra_for_eng`) | unthrottled | 1296 ms | 2938 ms | **4855 ms** | 82 ms | no |
| fresh, no `?course` (→ `fra_for_eng`) | unthrottled | 1120 ms | 2548 ms | **4152 ms** | 140 ms | no |
| `hun_for_eng` anon | Fast 3G | 1930 ms | 2368 ms | **never (90 s)** | — | — |

The Fast-3G row is a single run and is reported as taken; it is not enough to
call a defect, but it is enough to say the slow-link case is not understood.

## 2. Repeat visits — the bundle is genuinely a one-time cost

Same browser context, three loads in a row, `spa_for_eng` signed in,
unthrottled:

| visit | bundle fetched? | Supabase queries | **pressable** |
|---|---|---|---|
| 1 — cold | yes (441 → 2228 ms) | 125 | **8855 ms** |
| 2 — warm | **no** | 72 | **3858 ms** |
| 3 — warm | **no** | 72 | **4093 ms** |

The bundle cache does exactly what it is meant to: the second visit never asks
for it. And the wait still runs to ~4 s, of which 2.8 s is the deliberate
splash floor (`MINIMUM_ANIMATION_MS`). So even with the whole bundle already on
the device, a warm boot still spends 72 Supabase queries getting to a play
button.

## 3. Where the cold 8.8 s actually goes

A full request trace of one cold `spa_for_eng` load:

```
t+214 ms   bundle requested
t+1774 ms  bundle 200
t+2434 ms  first clip requested   → 200 at t+2611 ms
t+2748 ms  ...30 one-query-per-seed course_practice_phrases reads...
t+3467 ms  [generateLearningScript] Skipped 468 practice phrases for "spa_for_eng"
           ── 4.7 SECONDS OF NOTHING ON THE NETWORK ──
t+8202 ms  audio warm-up resumes
t+8462 ms  player reports ready
t+8544 ms  PLAY BUTTON ENABLED
```

**125 Supabase queries on a cold boot, 72 on a warm one** — including thirty
`course_practice_phrases?seed_number=eq.N` reads, one per seed, plus the whole
`course_legos` catalogue, `course_round_index` and `course_audio`. Every one of
those asks for data the bundle already contains and has already delivered.

A CPU profile of the same load (sampling profiler, 9.3 s window) says the main
thread is busy for ~6.8 s of it, with ~1.7 s of self time in a single minified
function and ~1.7 s in `(program)`. This box is a fast desktop; a phone CPU is
several times slower.

The 4.7 s block sits immediately after the old client-side script generator
(`providers/generateLearningScript.ts`) finishes loading its data — the
whole-course walk that path (a) of the cutover exists to delete. On a warm
visit the cached-script fast path skips it, which is why a warm boot is 4 s
rather than 9.

## 4. Staging, which is what Tom was playing on

Staging does **not** carry the boot-budget work (dev `1ae11f37`), and it shows:

| run | bundle starts | pressable | `/round-map` called? | fallback |
|---|---|---|---|---|
| `spa_for_eng` signed in | 1433 ms | 6466 ms | yes | **budget exceeded ×2** |
| `spa_for_eng` signed in | 1376 ms | 4624 ms | yes | **budget exceeded** |
| fresh, no `?course` (fra) | 1101 ms | 5420 ms | yes | **budget exceeded ×2** |
| `spa_for_eng` signed in, 4G | 1918 ms | 6610 ms | yes | **budget exceeded ×2** |
| `hun_for_eng` anon | 905 ms | 5339 ms | no | none |

`[InstantPlayback] bundle round-map failed, falling back to /round-map: bundle
not ready inside the boot budget` fires on every premium run on staging — the
2500 ms round-map budget being applied to a whole-course download. Dev fixed
that; staging has not had it promoted. So part of what Tom felt is a build that
is one promotion behind.

## 5. What changed here, and what deliberately did not

Two changes, both strictly "when does the fetch start", per the brief's fence.
Neither splits the bundle, changes the 8000 ms budget, or removes the fallback.

1. **`App.vue` — a second intent signal.** The synchronous boot warm-up can
   only name a course from `?course=`, the demo session key, or
   `localStorage`. On a fresh device, a fresh PWA install, or after a storage
   wipe there is nothing there, so the download waited for the course list and
   enrollment reads: measured at 1120–1296 ms instead of ~250 ms. The
   learner's own `preferences.last_course_code` now fires the same warm-up the
   moment auth resolves. Both call one helper; `getCourseBundle` coalesces, so
   two calls cost one fetch and every later consumer joins it.

2. **`prewarmInstantCaches` — warm the clips, not just the map.** The legacy
   branch finishes by fetching the first cycle's four clips (presentation,
   known, target1, target2) so a course switch is a cache hit at the tap. The
   cutover's early `return` for flagged courses silently dropped that. It is
   restored, reading the cycle out of the bundle already in memory — no extra
   metadata request, only the clips. Pinned by
   `useInstantPlayback.prewarmAudio.test.ts`.

**Deliberately not done**, and the reason:

- **No hover/scroll prefetch in the course picker.** The brief warned against
  fetching courses a learner merely glances past, and on a phone there is no
  hover anyway — the tap already fires `prewarmInstantCaches`, and a course
  switch reaches a pressable button in 0.8–2.2 s. Adding hover handlers would
  be surface for no measurable gain.
- **No change to the boot path.** That is where the seconds are, and it is a
  scope change the brief explicitly fenced off.

## 6. The recommendation

The prefetch-on-intent question is closed: the fetch starts at ~250 ms, ends at
~2 s, never falls back on dev, and the press itself costs ~150 ms.

The wait Tom felt is real and is worth about **six seconds**, and it is the
unfinished half of the cutover: the old client generator still walks the whole
course in JavaScript, and 125 Supabase queries still fire on a cold boot for
data the bundle already delivered. Building the session's script **from the
bundle** and retiring `generateLearningScript` on flagged courses is where
those seconds are. That is design §5 step 6, already planned.

Two smaller things fell out of the measurement and are logged rather than
fixed:

- `hun_for_eng` anon on Fast 3G never reached a pressable button inside 90 s in
  the one run taken. One run is not a defect report, but it should be repeated.
- The warm path still runs 72 Supabase queries and 2.8 s of splash floor to
  reach a play button with everything already on the device.
