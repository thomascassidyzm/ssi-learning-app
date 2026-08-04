# Diagnosis: "too much skipping, course beginnings too fast, not enough repetition"

**Reported by:** Aran · **Investigated:** 2026-08-04 · **Baseline:** `origin/dev` @ `78eecc7b`
**Evidence:** live `algorithm_config` + `courses` + `course_audio` + 20,000 `player_events.audio_play`
rows (last ~24h), read with the service-role key. Reads only.

---

## Verdict in one line

**Kai's turbo hunch is wrong, and it is wrong in a way that is easy to prove.** Turbo cannot be
sticky or default-on — it is a session-only `ref(false)` that only a deliberate user tap sets.
The real cause is a **code defect**: the belt speed/pause ramp is not baked by the adapter that
every learner's main loop actually runs through, so **beginners hear native-rate speech with an
advanced learner's short pause, from cycle one.**

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
