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

## 6. COUNTED — the repetition schedule at course start (the decisive measurement)

Run, not simulated: `packages/player-vue/diag/repetitionCount.diag.test.ts` drives
`generateLearningScript` → `toSimpleRounds` against live Supabase with the live `algorithm_config`
triple threaded exactly as `LearningPlayer.runGenerateScript` does.

### 6.1 Cycles per round — `spa_for_eng`, normal mode

| Round | new LEGO | cycles | breakdown |
|---|---|---|---|
| 1 | quiero | **3** | intro×1 debut×1 build×1 |
| 2 | hablar | **3** | intro×1 debut×1 build×1 |
| 3 | español | **6** | intro×1 debut×1 build×2 spaced_rep×1 use×1 |
| 4 | contigo | **10** | intro×1 debut×1 build×4 spaced_rep×2 use×2 |
| 5 | ahora | **15** | intro×1 debut×1 build×7 spaced_rep×4 use×2 |
| 7–12 | steady state | **17–18** | build×7 spaced_rep×6–7 use×2 |

**Round 1 is ~17% of the density the learner gets by round 7.** Cross-course rounds 1–5 totals:
`spa` 37 · `ita` 25 · `cym_s` 19. Welsh round 1 is **2 cycles**.

### 6.2 Hearings before the first production ask — the single most important number

**Every LEGO gets exactly ONE listen-only exposure — the intro cycle — before the learner is
asked to produce it.** The intro plays the target twice (voice1 + voice2), so it is **2 audio
plays, then produce.** Identical in `spa_for_eng`, `ita_for_eng`, `cym_s_for_eng`.

**There is no ramp.** LEGO #1 of a course gets the same 2-plays-then-produce as LEGO #400. This
is the structural knob that could compensate for a thin opening, and it is fixed.

`quiero` (LEGO #1) accrues **3 attributed reps over 12 rounds and never returns** — introduced
before any spaced-rep partner existed, it never enters the fib queue. `ahora` (LEGO #5) gets 17.

### 6.3 Distinct combinations — Kai's fork, answered

`spa_for_eng` rounds 1–5: **32 production cycles across 20 distinct phrases** (mean 1.60 repeats).

| repeats | # distinct phrases |
|---|---|
| **1×** | **14** |
| 2× | 2 |
| 3× | 2 |
| 4× | 2 |

Rounds 1–12: 146 production cycles, 80 distinct — **40 of 80 phrases are heard exactly once,
ever.** Cross-course means: `spa` 1.60 · `ita` 1.43 · **`cym_s` 1.00** (14 cycles, 14 distinct —
every phrase heard exactly once).

**It is the "too HIGH" arm of Kai's fork: nothing repeats enough to stick.** Not a small recycled
pool — a near-flat sequence of one-shot phrases.

### 6.4 The cause is the authored inventory, not the generator

Provenance trace back to `course_practice_phrases` rows:

| LEGO | rd | authored | emitted | caps |
|---|---|---|---|---|
| S0001L01 | 1 | **1 build / 0 use** | 1 / 0 | build≤7 use≤2 |
| S0001L02 | 2 | 1 / 1 | 1 / 0 | ″ |
| S0001L03 | 3 | 2 / 1 | 2 / 1 | ″ |
| S0001L04 | 4 | 2 / 2 | 4 / 2 | ″ |
| S0001L05 | 5 | 4 / 4 | 7 / 2 | **at caps** |

**Rounds 1–4 are content-limited, not cap-limited.** LEGO #1 has exactly one authored practice
phrase, and that phrase is `quiero` — so the debut and the sole build cycle are the same string.
**Round 1 is: hear `quiero` twice, say `quiero`, say `quiero`.**

The generator papers over this by promoting overflow `use` rows into `build` slots and re-emitting
the same row as `use` in the same round — so part of the density from round 4 on is **within-round
duplication, not new material**.

### 6.5 Turbo strips nothing from the opening

| Round | normal | turbo | stripped |
|---|---|---|---|
| 1–3 | 3/3/6 | 3/3/6 | **0 — 100% kept** |
| 4 | 10 | 9 | 1 |
| 5 | 15 | 11 | 4 |
| 6–12 each | 17–18 | 12–13 | 5 (~72% kept) |

**Turbo cannot strip rounds 1–3 because they have fewer than 4 builds to strip — the culling
threshold sits above the content floor.** Hearings-before-production is unchanged at 1 (intro is
never tagged). **The thin opening is thin with Turbo off.** Final nail in the turbo hypothesis.

### 6.6 Config notes

- Live `turbo_boost.useKeep = 2` vs code default `1` — Turbo culls **less** than the code default.
- `normal_mode` carries no `fibKeep`/`buildKeep`/`useKeep` at all. **Normal mode is not culled by
  a mis-set config.**
- **Dead knobs:** `spaced_rep_fraction` and `debut_phrases_fraction` are **read nowhere in the
  codebase**. The turbo row sets them to `0.33`/`0.5`, which looks like a live control and is not.
- Flagged: `useEagerScriptPreload` / `useFullCourseScript` call the generator **without** the
  config triple (defaults only). The play path does thread it. Divergence not chased.
- **Gap:** `fra_for_eng` could not be measured — three runs failed on a flaky parallel-pagination
  fault in `fetchAllPracticePhrases`. No `fra` numbers are reported.

---

## 7. Attribution of the symptom (final)

| bucket | share | verdict |
|---|---|---|
| **SETTINGS** (turbo, adaptation flags) | **0%** | Ruled out three ways: Aran never toggled turbo; turbo cannot default-on; turbo strips **nothing** from rounds 1–3; adaptation v2 is in shadow. |
| **CONTENT AUTHORING** (thin inventory) | **dominant** for *"not enough repetition"* | LEGO #1 has **1** authored practice phrase. 14 of 20 phrases in rounds 1–5 are heard exactly once. Rounds 1–4 are content-limited, not cap-limited. |
| **CODE — fixed 1-exposure scaffold** | **dominant** for *"beginnings too fast"* (pedagogically) | Every LEGO gets 2 audio plays then produce, with no ramp for the first LEGO of a course. |
| **CODE — `navigator.onLine` skip-forward** | largest share of *"skipping"* | Confirmed mechanism; field frequency unmeasured. Worst when the cache is cold = course start. |
| **CODE — unbaked belt ramp** | real, but **not Aran's** | 13–18% of every cycle lost, voice 25–32% fast. Hits fresh/uncached sessions on `cat`/`eus`; Aran's own cycles are correctly ramped. |
| **CODE — 10s stall watchdog** | some of *"clips cut off"* | Truncates on slow-but-alive connections. |
| **CONTENT — broken audio** | **0% for Aran** | Croatian clean (1/28,079). German (935) real, different cohort, owned elsewhere. |

## 8. Recommendations

**Content (the biggest lever, and it is not a code change):**
1. **Author more practice phrases for the first 3–5 LEGOs of every course.** One phrase for LEGO
   #1 is the root cause of the thin opening. The generator's caps (7 build / 2 use) are never
   reached until round 5 — the machinery is ready for more material, there just isn't any.
2. **Decide whether 2-plays-then-produce is right for LEGO #1.** It is currently identical to
   LEGO #400. If the first LEGO of a course deserves more scaffolding, that is a deliberate ramp
   someone has to choose — the methodology docs are silent on it.

**Code:**
3. **Fix the `navigator.onLine` trigger** — require the explicit offline toggle *or* real fetch
   failures, add a debounce, cap consecutive skips. **Needs a human decision** (learner-experience
   judgement).
4. **Bake the belt ramp** on all three `backendCyclesToRounds` call sites. Also restores the
   currently-ignored `learner_speed` setting.
5. **Stop using playback speed as a belt proxy** — pass belt/seed position to
   `computePauseDuration` explicitly. The proxy is why one missing field corrupted two unrelated
   behaviours.
6. **Delete or wire up** `spaced_rep_fraction` / `debut_phrases_fraction` — dead knobs that read
   as live controls are a trap for the next person tuning pace.

**Measurement:**
7. Correlate `phase_skip` density against connectivity in `player_events` to size how often #3
   actually fires. Cheap; would confirm or kill the leading skipping hypothesis.

**Do not:** touch German audio (owned by lane 1).
