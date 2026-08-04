# Diagnosis: "too much skipping, course beginnings too fast, not enough repetition"

**Reported by:** Aran · **Investigated:** 2026-08-04 · **Baseline:** `origin/dev` @ `78eecc7b`
**Evidence:** live `algorithm_config` + `courses` + `course_audio` + 20,000 `player_events.audio_play`
rows (last ~24h), read with the service-role key. Reads only.

---

## Verdict in one line

**Kai's turbo hunch is wrong, and it is wrong in a way that is easy to prove.** Turbo cannot be
sticky or default-on — it is a session-only `ref(false)` that only a deliberate user tap sets,
and Aran has **zero** turbo-toggle events in his entire history. Adaptation v2 is in shadow and
culls nothing. **Settings contribute 0%.**

The cause is **code, in two independent defects**, and they split cleanly along Aran's two
complaints:

- *"Beginnings too fast"* — the belt speed/pause ramp is not baked by the adapter that fresh,
  uncached sessions run through, so a new learner hears native-rate speech with an advanced
  learner's short pause from cycle one (§2). **Note: this is not what Aran personally hit** —
  his own cycles are correctly ramped (§5.2). It is real for new learners on `cat_for_eng`,
  `eus_for_eng` and any first session without a cached script.
- *"Too much skipping"* — `offlinePlaybackActive` ORs `navigator.onLine`, so a momentary
  connectivity blink silently drops every not-yet-cached cycle, repeatedly, and the cache is
  emptiest at the start of a course (§5.4). This is the leading explanation for Aran's 4,777
  `phase_skip` events.

Underneath both sits a methodology gap: by its own rails, the opening of a course legitimately
has the fewest practice combinations *and* an empty review pool (§5.5).

---

## 1. SETTINGS — ruled out as the cause (Turbo)

`turboActive` is `ref(false)` (`LearningPlayer.vue:9222`). It is written in exactly two places:
`confirmTurbo` (`:9909`) and `toggleTurbo` (`:9921`) — both behind an explicit user tap, and the
first tap of a session shows an explanation popup first.

The persisted preference `turbo_mode_enabled` (`packages/core/src/persistence/types.ts:40`) is
**written but never read** — `useAuth.ts:379` initialises it to `false` and no code path ever
restores it into `turboActive`. `turbo_mode_available: true` (`config/defaults.ts:87`) only
controls whether the *button is shown*, not whether the mode is on.

**Conclusion: Turbo cannot be on unless the learner turned it on this session, and it cannot
carry over between sessions.** If Aran did tap it, the culling is real and severe (see §4) — but
it is not a default, not sticky, and not a mis-set flag.

---

## 2. CODE — the actual cause (confirmed)

### 2.1 Every learner runs the adapter that bakes no speed

`INSTANT_PLAYBACK_ALL = true` (`LearningPlayer.vue:121`) routes **every course** through the
instant-playback path. That path builds rounds with `backendCyclesToRounds`, and the code comment
at `backendCyclesToRounds.ts:203` states the design plainly:

> `No belt-ramp / per-context speed here — the legacy toSimpleRounds computes a context-aware
> speed multiplier. For the cutover we keep it simple: rely on the runtime overrides in
> simplePlayer.setRuntimeOverrides to apply the same belt/context curves at play time.`

**That assumption is false.** The runtime override does not apply any curve — it only *reads* an
already-baked value:

- `getPlaybackSpeedMultiplier` (`:9264`) returns `1.0` immediately when Turbo is off.
- `SimplePlayer` then sets `audio.playbackRate = cycle.playbackSpeed ?? 1.0` (`SimplePlayer.ts:400`, `:1118`).

With nothing baked, `cycle.playbackSpeed` is `undefined` → **playback rate 1.0×**.
All three call sites on `origin/dev` (`:1520`, `:12270`, `:12364`) pass only three arguments —
no speed config.

### 2.2 The pause is collateral damage, because speed is used as a belt proxy

`computePauseDuration` derives belt position from the playback speed:

```
beltProgress(speed) = clamp((speed - 0.8) / (1.0 - 0.8), 0, 1)   // 0 = White, 1 = Green
```

So `playbackSpeed` undefined → `1` → **the learner is treated as Green belt** and gets the fully
tapered advanced-learner pause. A beginner is denied the beginner pause by the same bug.

### 2.3 Measured magnitude (live `normal_mode` config, 2026-07-01)

Per cycle, White-belt intended vs actually delivered:

| target clip | intended (0.8×) v1+pause+v2 | actual (1.0×) | lost |
|---|---|---|---|
| 1000 ms | 1250 + 2880 + 1250 = 5380 | 1000 + 2436 + 1000 = 4436 | **944 ms (−18%)** |
| 1500 ms | 1875 + 4667 + 1875 = 8417 | 1500 + 4134 + 1500 = 7134 | **1283 ms (−15%)** |
| 2000 ms | 2500 + 6492 + 2500 = 11492 | 2000 + 5868 + 2000 = 9868 | **1624 ms (−14%)** |
| 3000 ms | 3750 + 10255 + 3750 = 17755 | 3000 + 9442 + 3000 = 15442 | **2313 ms (−13%)** |

Two separable components:
- **Voice speed: 25% faster than intended** (1.0× vs 0.8×), or **32% faster on `fra_for_eng`**
  which sets `global_speed: 0.95` → intended White speed 0.76×. This is the perceptually
  dominant half — it is a *continuously* faster voice, not a one-off.
- **Pause: 7–19% shorter** (0.4–1.0 s less thinking time). Real, but the smaller half. Under the
  live config `pause_belt_boot: 0.8`, `pause_belt_assembly: 0.95`, the belt taper is gentle.

> Correction to the standing lane-3 summary ("telemetry shows white-belt cycles carried 0.76"):
> that is incomplete. Across 20,000 `audio_play` rows in the last 24h, **0.76 is ~1%**. On
> main-loop cycle types (`build`/`use`/`debut`/`intro`/`spaced_rep`), **60–62% carry
> `playbackSpeed: 1.0`**. The ramped values that do appear come from the legacy fallback path,
> which now runs only when the instant bootstrap throws.

### 2.4 Live speed distribution by course — the same defect, visible from outside

| course | n | playbackSpeed distribution | qualifies for ramp? |
|---|---|---|---|
| `fra_for_eng` | 2656 | 1.0: 63% · 0.95: 20% · 0.8: 8% · 0.76: 3% | yes (`belt_ramp`, `global_speed 0.95`) |
| `cat_for_eng` | 1103 | **1.0: 100%** | yes (`belt_ramp: true`) |
| `pol_for_eng` | 1222 | **1.0: 100%** | no (`t1 speed 0.85`, `belt_ramp: false`) |
| `kor_for_eng` | 977 | **1.0: 100%** | no (`t1 speed 0.8`) |
| `zho_for_eng` | 921 | **1.0: 100%** | no (`t1 speed 0.8`) |
| `cym_n_for_eng` | 2234 | 1.0: 96% · 2.0: 4% | no (no `target_speed`) |
| `hrv_for_eng` | 1485 | 0.95: 41% · 0.8: 30% · 1.0: 25% | yes |
| `afr_for_eng` | 850 | 0.95: 61% · 0.8: 33% · 1.0: 1% | yes |

`cat_for_eng` and `eus_for_eng` are configured for the belt ramp and receive **none of it**.
`hrv`/`afr` show a healthy ramp — they are the control that proves the ramp works when it is
baked.

Separately, courses whose audio was *recorded* slow (`pol`, `kor`, `zho`, `cym_n`: `t1 speed`
0.8–0.85) deliberately skip the ramp — but they still hit §2.2, so **their beginners get the
Green-belt pause from seed 1**. That is a genuine defect for those courses even though their
voice speed is correct by design.

### 2.5 Side-effect: the learner's own speed setting is ignored

`currentTargetSpeedConfig()` (`:6352-6377`) folds `localStorage.learner_speed` into
`globalSpeed`. Since that config never reaches the instant path, **a learner who deliberately
slows the app down gets no effect on the main loop.** Same root cause, same fix.

---

## 3. CONTENT — ruled out for every active course except German

`course_audio` rows with `duration_ms` null or < 400 ms:

| course | total clips | suspect |
|---|---|---|
| `deu_for_eng` | 47,348 | **935** |
| `cym_n_for_eng` | 19,915 | 25 |
| `hrv_for_eng` | — | 3 |
| `zho_for_eng` | — | 3 |
| `fra_for_eng` | 48,843 | 2 |
| `pol_for_eng` | 24,117 | 2 |
| `eus_for_eng` | — | 1 |

German alone carries the known silent-clip defect (935 ≈ the reported ~908). Repair of that is
owned by another job (see `.worker-coordination.md` lane 1) — **do not double-render.**

**Stated limitation:** this test keys on `duration_ms` metadata. The separately-reported French
*truncation* (clipping fix side-effect) leaves metadata intact, so it would **not** show here.
`fra_for_eng` scoring 2/48,843 rules out *silent stubs* in French; it does **not** rule out
byte-truncated French clips. That is an explicit gap.

---

## 4. What Turbo does when it IS on (for completeness)

Live `turbo_boost` config (2026-07-01): `buildKeep: 3`, `useKeep: 2`,
`fibKeep: [0,1,2,4,6,8]`, `spaced_rep_fraction: 0.33`, `debut_phrases_fraction: 0.5`.

So a Turbo learner loses BUILD phrases beyond the 3rd, USE phrases beyond the 2nd, two thirds of
spaced rep, and half the debut phrases. It also *raises* the pause floor
(`min_pause_ms: 1500` vs normal `1000`) and flattens the belt taper (`pause_belt_boot: 1`).

That is a large, deliberate cull — which is why it matters that it is opt-in-only and
session-scoped. **If Aran tapped Turbo, this alone fully explains "not enough repetition."**
Resolving that is the single highest-value fact still outstanding.

---

## 5. Worker findings folded in (2026-08-04, three of four reported)

### 5.1 Aran is on Croatian — content and turbo both ruled OUT for him

`learners.id = 07610299-f2dd-4fc9-8872-2c9e2d01b9f6` (`aran@hey.com`, `is_internal: true`).
**45,243 of 45,252 events (99.98%) are `hrv_for_eng`.** Eleven other enrollments, all abandoned
after ≤11 minutes, untouched since May 2026.

- `hrv_for_eng` has **1** suspect clip in 28,079 — clean. **Content ruled out.**
- **Zero `turbo_toggle` events, ever.** `preferences.turbo_mode_enabled: false`. **Turbo ruled
  out.** Population-wide turbo is real but tiny: 20 distinct learners in 60 days.

### 5.2 IMPORTANT correction to §2 — the speed defect does NOT explain Aran's own experience

Aran's target-audio speeds: `0.8` × 8,806 and `0.9` × 1,000. **His cycles are correctly
ramped** — so the unbaked-speed defect is not firing for him. This is consistent with §2.1: he
is a long-established learner (round 631, `S0280L02`) whose script comes from the **cached
legacy path**, not the instant adapter.

That sharpens rather than weakens the finding: **the unbaked ramp bites hardest on a learner
starting a fresh course with no cached script — precisely "the beginning of courses feels too
fast."** It is a real defect affecting `cat_for_eng`, `eus_for_eng` and every no-cache first
session; it is simply not what Aran personally hit.

Aran's telemetry only reaches back to `roundIndex 52`, so his own beginning-of-course behaviour
is **not observable**. Explicit gap.

### 5.3 Adaptation v2 — ruled OUT, verified live

`algorithm_config.adaptation_v2` has **`shadow: true`** (row last touched 2026-07-16). Shadow
computes and logs but applies nothing, so `adaptOmitCycleIds` stays empty. Cold start was
pinned by test: with no mastery evidence every lever sits at its scripted value (7 builds /
2 consolidations / 12 spaced-reps, matching the live `script_shape` row) and **zero cycles are
culled**. There is no code path from "learner is doing well" to "play fewer repetitions" — the
only signal that moves the levers is *struggling*, and it moves toward **more** consolidation.

A latent bug was pinned for the day v2 is switched to applying: the cull counts play-time
*cycles* while the generator budgets review *slots*, and the late-course seed sandwich is one
slot but four cycles.

### 5.4 NEW — the strongest candidate for "skipping": `navigator.onLine`

`LearningPlayer.vue:9320`:

```js
const offlinePlaybackActive = () =>
  (offlineActive.value || !isOnline.value) && !offlineLeaseLocked.value
```

The explicit offline toggle is **one half of an OR, not a precondition**. A learner who never
opted into offline mode enters skip-forward mode the instant `navigator.onLine` flickers false —
a tunnel, a lift, an iOS wifi→cellular handover. From that moment every cycle whose audio is not
already in IndexedDB is **silently dropped**, and the check re-runs at every cycle boundary,
walking forward past each failing cycle in turn.

**On rounds 1–10 of a fresh course the persistent cache is nearly empty** — only what has played
plus ~one cycle of lookahead. So one connectivity blip can cull most of the near-term queue. It
self-heals when the network returns, presenting as **bursts of skipping correlated with flaky
connectivity**.

`navigator.onLine` is notoriously twitchy on mobile and says nothing about whether the
connection actually *works*. There is no debounce, no requirement that a fetch actually failed,
and no cap on consecutive drops.

Corroborating: Aran's own history carries **4,777 `phase_skip`, 432 `tap_skip`, 170 `lego_skip`**
events — heavy skip volume that nothing else in this diagnosis explains.

Also found: an unconditional 10-second stall watchdog (`SimplePlayer.ts:1164`) advances the
phase when audio makes no progress. It does not drop a cycle, but on a slow-but-alive connection
it **truncates clips to silence and moves on** — which reads to a learner as skipping. That is
mechanism (b) from Kai's taxonomy, arising from code rather than content.

### 5.5 Methodology rails — the start of a course is structurally thin, and undefended

From `ralph-methodology.md` (the runtime-facing doc):
- Spaced-rep offsets `[1,2,3,5,8,13,21,34,55,89]`; N-1 contributes **3** USE phrases, every other
  due LEGO **1**; total review capped at **12**/round.
- The validator's graduated combination ramp: **seed 1 LEGO 1 → 0 BUILD / 0 USE**; rest of seed 1
  and seeds 2–3 → **1/1**; seeds 4–5 onward → **3/5**, the full minimum for the rest of the course.
  `skip_validation` can silence these minimums, but **only for seeds 1–3**.

Two structural facts compound at the start:
1. Review offsets resolve to nothing until enough prior rounds exist (`if (targetSessionIndex < 0)
   break`) — round 1 gets **zero** spaced review, round 2 only N-1.
2. Seeds 1–3 are permitted as few as **0–1** practice combinations.

**So by the methodology's own numbers, the opening of a course legitimately has both the thinnest
practice-combination count AND the emptiest review pool.** No document reconciles this or defends
it as intentional. Directly answers Kai's "amount of combinations" question: at the very start it
is **too low**, by design, and nothing compensates.

The docs also state **no belt- or seed-indexed pace ramp** — pause/pace values are static per-role
defaults. The belt speed ramp in the player is therefore a *player-side* invention with no
methodology backing either way. The only sanctioned "faster path" is a future, unconfirmed,
performance-gated adaptive layer for learners already scoring >90% — nothing sanctions reducing
repetition at the *start* of a course.

**Gap:** `LEGO_SESSION_SPECIFICATION.md` (a spec doc, some sections marked "Future") and
`ralph-methodology.md` disagree numerically on the offset list. Neither was verified against the
actual round-assembly runtime.

---

## 6. Attribution of the symptom

| bucket | share | verdict |
|---|---|---|
| **SETTINGS** (turbo, adaptation flags) | **0%** | Ruled out. Turbo never enabled by Aran and cannot default-on; adaptation v2 in shadow. |
| **CODE — `navigator.onLine` skip-forward** | largest share of *"skipping"* | Confirmed mechanism; field frequency unmeasured. Worst exactly when the cache is cold = course start. |
| **CODE — unbaked belt ramp** | largest share of *"too fast at the beginning"* | Confirmed on `origin/dev`. 13–18% of every cycle lost; voice 25–32% fast. Hits fresh-course/no-cache sessions, not Aran's own. |
| **CODE — 10s stall watchdog** | some of *"clips cut off"* | Confirmed; truncates on slow-but-alive connections. |
| **CONTENT** (broken audio) | **0% for Aran** | Croatian clean (1/28,079). German (935) real but a different cohort and owned elsewhere. |
| **METHODOLOGY** (thin course opening) | real, by design | Seeds 1–3 permit 0–1 combinations and have no review pool. Not a bug — an undefended design gap. |

## 7. Recommendations

1. **Bake the belt ramp on the instant path.** Pass `currentTargetSpeedConfig()` to all three
   `backendCyclesToRounds` call sites and compute the speed in the adapter. Fixes both the voice
   speed and — via the belt proxy — the pause. Also restores the ignored `learner_speed` setting.
   Small, contained, high value.
2. **Fix the `navigator.onLine` trigger.** Require the explicit offline toggle *or* real evidence
   of failed fetches, add a debounce, and cap consecutive skips. **This one is a judgement call
   about what a learner should experience on a bad connection — it needs Tom/Kai's decision, not
   an agent's.**
3. **Stop using playback speed as a belt proxy.** Pass belt/seed position to
   `computePauseDuration` explicitly. The proxy is why one missing field corrupted two unrelated
   behaviours.
4. **Measure before acting on #2:** correlate `phase_skip` density against connectivity in
   `player_events` to size how often it actually fires. Cheap, and it would confirm or kill the
   leading hypothesis.
5. **Methodology, for Tom:** decide whether seeds 1–3 having 0–1 combinations and no review pool
   is acceptable. If not, that is a content-authoring change, not a code one.
6. **Do not touch German audio** — owned by another job (lane 1).
