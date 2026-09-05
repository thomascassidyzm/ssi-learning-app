# Pods: who is actually getting them

*Measured 2026-09-05, read-only, against the live database. Real learners only — demo, internal and e2e accounts excluded throughout.*

## The numbers first

- **In the last 5 days (since the isLayer1 telemetry flag exists, 2026-08-31): 20 genuine pod dialogue laps were delivered fleet-wide, to 8 real learners.** In the same window roughly 32 real learners were active. So about **three-quarters of active real learners are receiving zero listening pods.**
- **Detector run over the last 7 days: 9 of 24 courses with active real learners are RED** — either zero pod dialogues delivered despite earned listening work (isl, por_br, tur, ukr, and at the learner grain deu/Beuno), or **no live pod exists to serve at all** (cym_n, cym_s, rus, ces, ben). Two more are AMBER (nld, swe — delivering under half of what learners' work has earned).
- **The flagship case is not Beuno but Morgan on Welsh North**: 211 rounds completed since 2026-08-22, roughly 40 laps' worth of listening work — **zero pod dialogues, and zero possible**, because every `cym_n_for_eng` pod is `held`. All 20 "listening laps" Morgan's telemetry shows are Layer-1 seed cups. The course reads as healthy on every surface.
- **Beuno (beunollyn, deu_for_eng)**: received **3 pod laps ever, all on Aug 7–8** (from the then-live pod-0), and none since — a month of real sessions. His enrollment ratchet reads `completed_pod_rounds = 0` despite those 3 completed laps, so even the delivery record failed to record delivery.
- Tom's claim, checked precisely: **pod-1 content does reach some main flows** — e.g. Stephen got a genuine `deu_for_eng` pod-1 dialogue on 2026-09-03 — so "not live in ANY course's main flow" is not literally true. What is true is worse in a way: **delivery is so sparse and so unevenly distributed that for most learners, most courses, it is indistinguishable from off** — and until 2026-08-31 the telemetry could not tell a pod dialogue from a seed drill, which is exactly how the earlier "the code looks fine" reading survived.

## The mechanism — what actually gates a pod

**The 30-minute cutoff does not exist.** I searched the codebase for every plausible spelling of an elapsed-session gate (`1800`, `30 * 60`, `1800000`, "thirty minutes", elapsed-ms comparisons): there is none gating pods. Aran's model ("20-minute sessions never reach the 30-minute cutoff") is a folk theory of the symptom. This matters: the mechanism everyone has been reasoning from was wrong, so any fix aimed at "re-basing the 30 minutes" would have repaired a gate that isn't there.

The real gate, from code verified against live config (`algorithm_config.pods`: `roundInterval: 5`, `podActivationRound: 6`):

> A pod fires when the learner's **absolute round position** satisfies `(mainRound − activation) % 5 === 0`, position ≥ activation. (`usePodLapScheduler.shouldFireLapAt`, wired through `podCadenceFiresAtRound` in LearningPlayer.)

That is a **position-modulus** rule, and position is the wrong axis. Measured on Beuno: he did 33 round-completions in a month, but his *position* only advanced from round 10 to round 14 — replays after breaks, easy-mode selection, short sessions. Fires live only at positions 5, 10, 15…; he crossed his last one on Aug 8 and has been walking between boundaries ever since. **Work done accumulates; the cadence can't see it.** A missed or silently-failed boundary is simply gone — no debt is carried.

The full silencer stack, each one observed in the data, each failing toward "looks like a working course":

1. **Position-modulus cadence** (above) — slow-position learners starve. The scheduler's own 2026-05-20 comment already names the correct design ("mode-agnostic monotonic counter") as "lands separately". It never landed.
2. **Held/parked pods** — `cym_n_for_eng`, `cym_s_for_eng`, `deu_at_for_eng` have every pod held; ~10 more courses with active learners have no `listening_pods` rows at all (rus, ces, ben, srp, hun, afr…). `servedPod.ts` resolves these to "no pods yet" *by design*, and nothing anywhere says so out loud.
3. **Ratchet non-persistence** — Beuno completed 3 laps; his ratchet is 0. The write is fire-and-forget by design (acceptable per-lap), but nothing ever reconciles, so the delivery record can lie forever. (`enrollment_threads`, the second ratchet home named in the sector-merge work, contains **zero rows in the entire table**.)
4. **Telemetry conflation** — `pod_lap_start` is emitted for both pod dialogues and Layer-1 seed cups; distinguishable only since 2026-08-31 (`isLayer1`). Every pod-delivery reading made before that date was contaminated, including the one that overruled Tom.
5. **Silent composed-nothing boundaries** — until 2026-09-01 a due boundary where the pod composed nothing wrote no event at all. The fix logs `pod_lap_unavailable`; zero such events exist yet (few updated clients have crossed a due boundary since).
6. **Offline whole-pod gate** — a pod not fully on-device stays due and the seed cup plays instead (correct ratchet behaviour, but another way a learner hears no dialogue today).

## The derived rule

The estate's canon: delivery position is **derived from prerequisites, never authored**; pods and courses are **listening and producing walks over one graph**; a shape the learner must own belongs in **core**. An elapsed-clock gate is a proxy for progress; Tom's "every 5 rounds regardless of session length" is a better proxy; both are proxies for the real quantity, which is **listening work owed by producing work done**.

**The rule: pod delivery becomes a debt, not a schedule.**

> Keep one monotonic per-enrollment counter, `rounds_since_pod`, incremented on **every completed round** — replays, easy-mode rounds, revival-tail rounds, all of them; it is a measure of work done, never of position. At any clean round boundary where `rounds_since_pod ≥ 5` and a lap can compose, the pod fires; on lap **completion** the counter resets to 0. It never resets on failure, skip, offline-incomplete or composed-nothing — the debt stands until it is paid.

Why this is the derivation and not a new number:

- **It lands on Tom's instinct — every 5 rounds — for stated reasons**: "rounds" was always the right unit (rounds of *work*, the nearest honest proxy for graph coverage the runtime can see today), but the shipped code implemented "every 5 rounds of *position*", which is a different rule, and the difference is precisely Beuno. The constant 5 is unchanged; only the axis changes.
- **Debt is what makes silent failure impossible to compound.** Under modulus, every silencer in the stack above converts a missed fire into permanent loss. Under debt, every silencer converts it into a fire at the next viable boundary. Short sessions accumulate debt across sessions and get their pod first thing next session — which is also the correct answer to Aran's original re-basing proposal, without any clock.
- **Deeper derivation (fire cohort K when its atoms' prerequisite LEGOs are owned) is the true graph rule, but the edges don't exist in data** — pod sentences carry `atom_map` but no prerequisite links to `course_legos`. Building that is a real project; gating this fix on it fails Simpler and Cheaper today. The debt rule is the largest step toward "derived, never authored" that current data supports, and it composes with a future prerequisite gate (prerequisites decide *what* composes; debt decides *when*).
- **Better × Simpler × Cheaper**: Better — every learner doing the work receives the listening walk, at the same average cadence current config intends. Simpler — deletes the activation-pin capping saga (`pod_activation_round`, the 2026-05-20 hotfix cap, the returning-learner pinning) because a work-counter starting at 0 needs no pin and can produce no avalanche; one column replaces three interacting mechanisms. Cheaper — one additive enrollment column plus a smaller `shouldFireLapAt`; no new service, no new signal without a consumer (the detector is the consumer and it already runs).
- **Quadrant: reversible and detectable → build the detector and ship.** Reversible: additive column, one function, config constant unchanged, revert is one commit. Detectable: the detector below reads delivery directly and would show the change (or its failure) within days. Per the commission, the rule is **specified here but not applied to production config in this job**.

Held-pod courses are the one thing the rule cannot fix, because they are a *content* decision: a course whose pods are all held delivers nothing lawfully. The rule for those is the detector's `no-servable-pod` RED — the hold stays available as a deliberate state, but it can never again be an invisible one.

## The detector

`scripts/pod-delivery-detector.mjs` (this repo). Read-only. For every course with real-learner activity in a trailing window it computes: learners active, **laps owed** (`floor(roundsCompleted/5)` per learner, summed — the debt rule used as a measuring stick), **pod dialogues delivered** (`pod_lap_start` with `isLayer1 === false` only; unflagged old-client events are counted but never credited — the exact contamination that fooled the 2026-08-31 reading is fenced out), and **served-pod status** from `listening_pods`. Verdicts: RED `no-servable-pod`, RED `zero-delivery`, AMBER `under-delivery`, GREEN. Exit 1 on any RED. `--notice` posts one plain-English summary into the ssi-learning-app project channel on the command surface (the audio-gap nightly's proven delivery path) — a detector talking to nobody is not a detector.

**Proven red before trusted green** — first live run, real output:

```
cym_n_for_eng | 1 | 18 | 0 | 20 | held-only | RED no-servable-pod
por_br_for_eng | 1 | 3 | 0 | 12 | live | RED zero-delivery
ukr_for_eng | 1 | 2 | 0 | 10 | live | RED zero-delivery
tur_for_eng | 1 | 1 | 0 | 1 | live | RED zero-delivery
isl_for_eng | 2 | 1 | 0 | 3 | live | RED zero-delivery
rus_for_eng / ces / ben / cym_s — RED no-servable-pod
9 RED, 2 AMBER, 13 GREEN of 24 active courses   → exit 1
```

Its pure verdict logic is unit-tested (`scripts/pod-delivery-detector.test.ts`, 9 tests, wired into the nightly `test:api` suite so the tests actually run). Recommended standing home once merged: a `pod-delivery` leg in the watson-1 nightly (`ops/ci` or a sibling timer to `ssi-audio-gap`), running `--days 7 --notice`.

## Open questions for Tom (one word each)

1. **Switch the cadence from position-modulus to the 5-round work-debt rule as specified?** My recommendation: **yes**. (This is the only behaviour change; everything else in this job is measurement and detection.)
2. **Welsh North/South and the no-pod courses: is "held, silently" still the intended state now that it's measured as the biggest single delivery hole?** My recommendation: keep the hold if Layer-2 content isn't ready, but let the detector's RED stand as the permanent reminder rather than muting it.

## Loose ends found and left alone, stated honestly

- Beuno's ratchet reading 0 despite 3 completed laps: cause not established (failed RLS write, or a course reset — both fit). The debt rule makes the ratchet non-load-bearing for cadence, and the detector measures delivery from events, not the ratchet — so this becomes observable rather than silent, but it was not separately fixed.
- `enrollment_threads` is empty fleet-wide; whatever was meant to write it never has. Flagged, not chased.
- Why Beuno's one due boundary on Aug 31 (position 10) produced silence could not be reconstructed from data — it predates the `pod_lap_unavailable` logging. The instrumentation that would answer it next time already shipped (2026-09-01).
