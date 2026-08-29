# Step 6 verified — the session builds from the bundle, and what that actually bought

*2026-08-29. Everything below is from runs the author took and waited for, against the
deployed dev alias, cold browser context per run. Nothing here is quoted from an
earlier document.*

---

## 0. The headline

Cold first play on `spa_for_eng`, signed in, unthrottled, six runs per arm,
interleaved so both arms meet the same serverless warmth. "Pressable" is when
`.center-btn` loses `is-disabled` — the wait a learner actually feels.

| | pressable, median | range | Supabase queries |
|---|---|---|---|
| **Before** — pre-cutover path (`?bundle=0`) | **7938 ms** | 7838 – 8247 | 124 |
| **After** — bundle path, step 6 | **5121 ms** | 4654 – 5566 | 74 |

**2.8 seconds off, and 50 fewer queries.** The before arm reproduces the
8.5 – 9.0 s baseline recorded in `first-play-wait-measured-2026-08-29.md` for the
same course, so the two documents are measuring the same thing.

---

## 1. Step 6 on its own was a regression, and it is fixed

`?fullscript=walk` was added for this: it keeps the bundle bootstrap on and forces
the retiring walk for the whole-course script, which is exactly the step-5 build
reachable from the current one. Without it there is no way to separate step 6 from
the rest of the cutover, because the pre-step-6 build exists on no alias.

Measured that way, step 6 as it landed made the wait **worse**:

| arm | pressable, median (n=5) |
|---|---|
| walk full-script (step 5) | 4692 ms |
| bundle full-script (step 6, as landed) | 5680 ms |

Less work losing to more is not a paradox, and the cause is not what it looks like.
A Chromium CPU profile sampled to the pressable moment, with the walk arm as the
control:

```
bundle full-script   pressable 5415ms   capConsecutiveRepeats 379ms
                                        core generateScript   185ms
                                        bundleToBackendCycles  86ms
                                        backendCyclesToRounds  32ms
                                        GC                    220ms
walk full-script     pressable 4450ms   none of the above before pressable
```

Shared costs were identical in both (bundle parse 280 ms, eruda 230 ms). The whole
difference is ~700 ms of whole-course build landing inside the paint window. **Not
slower work — earlier work.** The walk is network-bound, so its output arrived after
the button was already live; the bundle is in memory, so its build arrived before.

Two fixes, in the order the evidence forced them:

1. **`bundleFullScriptSliced`** — the same script in 60-round chunks, yielding
   between them through the walk's own `yieldToEventLoop`. Worth ~80 ms. Not the
   main cause, but correct: an un-yielded whole-course build has no business on a
   boot path, and a phone pays several times what desktop Node pays
   (`tur_for_eng`, 840 LEGOs: generateScript ~30 ms, toBackendCycle ~25 ms,
   backendCyclesToRounds ~175 ms).
2. **`afterNextPaint`** — the real one. `resolvePlayerReady()` fires in the same
   tick that flips `isFirstClipReady`, and `isFirstClipReady` is half of what
   un-disables the play button. The ready-gated handoff has therefore always
   competed with the render that lights the button up; that was free while the work
   was network-bound and expensive the moment it became CPU-bound. The handoff now
   waits two animation frames. ~32 ms of patience for ~1 s.

After both, seven runs per arm on a quiet link:

| arm | median | range |
|---|---|---|
| bundle full-script (step 6) | **4943 ms** | 4635 – 5690 |
| walk full-script (step 5) | 6379 ms | 4396 – 9020 |

The medians are close on a good link. **The spread is the real result**: 1055 ms
against 4624 ms. The bundle path is bounded because it does no network work for the
script; the walk's tail is unbounded because it does twenty-odd more queries and any
one of them can be slow.

---

## 2. Parity

`tools/bundle-cutover/parity-fullscript.mjs` runs both real producers — the walk
against a live anon Supabase client, `bundleFullScript` against the live `/bundle`
endpoint — and diffs the player `Round[]`. Re-run against the shipped build:
`docs/bundle-cutover-parity/parity-fullscript-final-2026-08-29.json`.

**Identical on all six sampled courses:** LEGO-id sequence, main-loop round count,
revival-tail length. `hun` 665/665, `gle` 786/786, `nld` 563/563, `tur` 840/840,
`spa` 57/57 (preview), `cym_s` 33/33 (preview).

**Not identical:** which BUILD/USE/spaced-rep phrase fills a slot whenever a LEGO's
phrase pool exceeds the round's cap — 152 rounds across the sampled windows, 135 of
them with the same cycle count and a different phrase in it. Cause: the walk sorts
candidates shortest-first; `@ssi/core`'s `generateScript` sorts by DB position.

This is **pre-existing and already live**, not a step-6 regression. The `/cycles`
endpoint has documented it as a known gap since it was written ("the walk's
algorithm_config-driven pools … are not applied here; this endpoint keeps DB
position order"), and that endpoint has been the live producer for the rounds a
learner actually plays since step 5. Bundle-vs-`/cycles` parity is IDENTICAL
(`parity-cycles-generator.json`, `parity-cycles-wire.json`), so step 6 changes
nothing about what a learner hears relative to what already shipped — it removes
the case where one session queue was filled by two producers that disagreed.

**It is still a live question for Tom** — see §4.

## 2b. A real defect the parity harness caught

One `cym_s_for_eng` round differed only in the intro cycle's first audio id: same
text, same voices. `course_legos.presentation_audio_id` is null there and
`lego_introductions` holds a 75-second authored clip. The walk has always repaired
that at read time; the bundle endpoint never did, so on the bundle path those LEGOs
opened with the plain known-text clip instead of their introduction narration.

Counted across the fifteen flagged courses: **174 affected LEGOs on `eus_for_eng`**
(159 repairable — a fifth of the course), 7 on `fra_for_eng`, 5 on `zho_for_eng`,
3 on `cym_s_for_eng`, 2 on `spa_for_eng`, 1 on `pol_for_eng`, none anywhere else.

Fixed in the bundle endpoint with the walk's own precedence (legacy
`lego_introductions`, then `course_audio` role='presentation' overwriting it,
newest wins, `pending/` renders skipped). Verified live on dev: `eus_for_eng` went
from 174 LEGOs missing presentation audio to 15. The intro-cycle diff is gone from
the final parity run.

---

## 3. Slicing is provably invisible

The sliced build only earns its place if it is the same script. `generateScript`
pages by (`fromLegoId`, `roundLimit`) — that is how `/cycles` has always driven it —
so chunking should be invisible, and that is asserted rather than assumed:

- Unit tests diff chunked against unchunked round-for-round at chunk sizes
  1, 2, 3, 5 and 60, including the revival tail and cycle-level audio ids.
- A run over **all fifteen live bundles** reports IDENTICAL on every one
  (premium courses over their anon preview window).

---

## 4. Open for Tom — one decision

**Should the generator sort phrases shortest-first, as the walk does and as the
methodology's round shape says ("BUILD shortest-first, then USE, cap 7")?**

Today it sorts by DB position, on every one of the fifteen courses, and has done
since step 5. It is not a step-6 change and nothing regressed by leaving it, but the
design doc's claim that the generator matches the walk does not hold for phrase
selection, and the walk was the stated source of truth.

Not done here because it is a content change — it changes which phrases a learner
hears on fifteen live courses — and because the bundle carries no syllable count, so
closing it means a wire-format field, a bundle version bump and a re-parity of all
fifteen. That is a real piece of work with a taste call at the top of it, not a
detail to absorb.

My recommendation: do it. Shortest-first is deliberate pedagogy, not a tie-break.

---

## 5. What is now live on dev

- The whole-course script for the fifteen flagged courses is built from the bundle
  already in memory. The walk is not called on those courses at all — confirmed by
  console signature and by query count (74 against 124).
- The retiring walk stays as the fork's fallback: `fullScriptFromBundle` returns
  null on anything going wrong and every caller takes the untouched walk.
- `?fullscript=walk` and `?bundle=0` are the two dev levers that reach the older
  paths for comparison, permanently.
