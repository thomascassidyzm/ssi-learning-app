# Progressive-only prefetch: the number, measured on staging

**Verified 2026-09-01 against `staging.saysomethingin.app`, build `0ad8110`** (the
dev→staging promotion carrying `43f89cf0` "progressive only — bulk downloading is
Offline Mode's alone" and `ac816697` "sign-out clears the course-bundle cache").

## What was wrong

The automatic rolling filler spliced `collectAllListeningAudioIds()` into every
warm — the whole listening corpus, ~2,401 clips / ~100 MB on `spa_for_eng`, not
scoped to the learner's cursor. It rode the very first burst, which fires on
rounds-loaded, **before the learner has played a single cycle**. Tom's phone read
"92 MB downloaded for offline" in Settings for a scenario that should have been a
handful of MB.

## The measurement

Probe: `packages/player-vue/e2e/upfront-download-budget-probe.mjs`. Fresh Chromium
profile on an iPhone 13 device profile (UA / 390×844 / DPR 3 / touch), zero service
workers, zero IndexedDB, zero localStorage — proven empty at nav time, not assumed.
Brand-new guest, never signed in, never opted into Offline Mode. Course
`spa_for_eng`. HTTP cache cleared via CDP.

Two independent measurements, neither an estimate:

1. **Wire bytes** — `Network.loadingFinished.encodedDataLength` summed per response.
   Actual bytes across the network, not a `Content-Length` guess and not a file
   count multiplied by an assumed clip size.
2. **The Settings number** — read from the same source `SettingsScreen.vue:2365`
   renders (`getAudioCache().stats().persistent.bytes`, i.e. IndexedDB
   `ssi-audio-cache-v2` → store `audio`, `lifecycle === 'persistent'`). This is
   literally the figure a learner would see on that screen.

First-audible is a genuine `timeupdate` past `currentTime > 0.05s` on a
document-start-patched `HTMLMediaElement.prototype.play` — a resolved `play()`
promise is not accepted as proof of sound.

## The result (two runs)

| | run 1 | run 2 |
|---|---|---|
| first lesson audio genuinely audible | 5.1 s | 4.3 s |
| **audio bytes on the wire at first audible** | **1.33 MB** (34 requests) | **1.85 MB** |
| **audio bytes on the wire at first-audible + 60 s** | **5.45 MB** (179 requests) | **5.46 MB** |
| total bytes incl. app shell, at +60 s | 6.90 MB | — |
| **"MB downloaded for offline" (Settings) at +60 s** | **4 MB** (152 clips) | **4 MB** (152 clips) |

## The verdict

A new learner on a phone now pulls **~1.3–1.9 MB of audio to reach first sound**
and **~5.5 MB across the first minute of play** — reproducible to within 0.01 MB
across runs. The Settings line a learner would read says **4 MB**, not 92 MB.

The corpus is no longer touched by the automatic path at all: 152 persistently
cached clips after a minute of play, against the ~2,401-clip corpus the old filler
fetched upfront. Listening audio still arrives progressively, one lap ahead; the
whole-corpus download now runs only behind the learner's own Offline Mode
selection, gated structurally by the required `offlineModeOptIn` parameter on
`BulkAudioDownloadDeps`.

Raw report: `staging-verification-2026-09-01.json`.
