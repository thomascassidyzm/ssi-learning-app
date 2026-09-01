# Boot fallback rework — Fast 3G verification, 2026-08-30

Branch `hotfix/first-time-visitor-boot-fallback` @ `4bde8cda`. Not merged, not deployed.

## The principle

Tom, 2026-08-30: *"a timeout is only justified when there is something BETTER to do when it fires."*

## What the cache actually stores

Two separate things, and the previous fix conflated them:

| Store | Key | Granularity |
|---|---|---|
| `ssi-courses-catalogue-v1` (localStorage) | one key | **whole catalogue, one blob of all 83 course rows** |
| `ssi-script-cache` (IndexedDB, store `scripts`) | `${SCRIPT_VERSION}:${courseCode}` — e.g. `v11:zho_for_eng` | **per course** |

`readCatalogueCache()` is therefore a GLOBAL check. A returning learner who has ever
booted online has all 83 rows, for every course, including ones they have never opened.

So the check is keyed to the one course this boot is about — resolved before the fetch
from local signals only (`?course=` → learner preference → `ssi-demo-last-course` →
`ssi-last-course`) — and needs **both** halves: the mirror carries that course's row,
**and** `getCachedScript(code)` returns a script for it.

## Method

Built artifact of the branch served on `localhost:5199` with `/api/*` proxied to
production `saysomethingin.app`; real production Supabase. Fresh Chromium context per
run (persistent profile for the returning-learner cohorts — `storageState()` does not
carry IndexedDB, and the per-course cache IS IndexedDB). CDP Fast 3G:
1.6 Mbps / 750 Kbps / 150 ms. 3 runs per cohort.
Probe: `packages/player-vue/e2e/_bootfallback-probe.mjs`.

## Results

All times ms from navigation start.

### The controlled pair — identical everything except which course is asked for

Same warm profile (`v11:zho_for_eng` cached, 83-row mirror, `ssi-last-course=zho_for_eng`),
same Fast 3G, same 30s-delayed courses request. Only the URL differs.

| Cohort | Long wait engages? | Gave up at | Player mounted |
|---|---|---|---|
| **cached** — `?course=zho_for_eng` (script cached) | **no** | 2956 / 2909 / 2886 | 3002 / 2955 / 2930 |
| **uncached** — `?course=spa_for_eng` (row in mirror, no script) | **yes**, @ 2711 / 2662 / 2689 | 20711 / 20663 / 20690 | 20862 / 20763 / 20942 |

A global check would have short-circuited both identically. This is the proof it is per-course.
The cached cohort is the old behaviour exactly: 2500ms budget, fall to mirror, mounted ~3s.

### fresh — first-time visitor, empty everything

| run | long wait @ | mounted | first audio ACTUALLY AUDIBLE | cue gaps |
|---|---|---|---|---|
| 1 | 7804 | 10116 | **16832** | 0 |
| 2 | 7794 | 10032 | **17417** | 0 |
| 3 | 7807 | 10129 | **17597** | 0 |

Baseline before the fix: 5/5 runs, 60s budget, **not a single note played**.

### hang — fetch delayed past the long wait

| run | long wait @ | notice shown @ | retry button | mounted, **no tap** |
|---|---|---|---|---|
| 1 | 7815 | 26012 | yes | 32418 |
| 2 | 7816 | 26192 | yes | 32503 |
| 3 | 7798 | 26170 | yes | 32337 |

Notice at long-wait-start + 18000ms exactly. The original request keeps running behind
it and completes the boot on its own — the retry button was never pressed in any run.

## Two defects the reproduction found, and fixed

1. **The loading cue was not continuous.** `index.html` paints a spinner until Vue mounts
   (~5.0s), but the player route is a lazy chunk arriving ~10.1s. In between `route.matched`
   is empty, router-view renders nothing, and the only thing on screen was AppEscape's
   "← Back" on a bare background — five silent seconds, inside the window the long wait
   extends. BottomNav's spinner cannot cover it because BottomNav does not exist yet.
   Fixed at the App.vue layer; cue now continuous from ~180ms to mount.
2. **The notice could raise itself over a working player.** The long wait can expire on a
   course with no cached script while the mirror still carries its row — that boots. Any
   usable catalogue now clears the notice.

## Gates

`typecheck` clean · `test` 2498 passed / 3 skipped / 3 todo · `lint` 0 errors (159 warnings, pre-existing class)
