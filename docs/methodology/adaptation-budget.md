# Adaptation budget — the curvature-driven controller (M2 design)

*Think-piece, 2026-06-13. The design exploration behind metrics workstream C (the *Adapt* priority). Built to be argued with — this is open design, not a locked plan.*

**Companions:** `metrics-architecture.md` (§3 Principle 4, §4 the controller/budget) is the *why*; `metrics-implementation-plan.md` workstream C is the *what/when*. The sensor this controller reads — the **curvature engine** — already landed (`packages/core/src/learning/curvature.ts`, B1). This paper is how the controller *spends* what the sensor *sees*.

---

## 0. One-line frame

The curvature engine answers *"is this (learner × unit) turning, and how hard?"* This controller answers *"so what do we do with the next slice of the session?"* — and the answer is never a single dial, it is an **allocation of a finite practice budget** across **consolidate / defer / drill**, leaning to consolidate-and-defer.

## 1. The control objective (Principle 4)

Keep each learner in the channel between **drown** (too hard → brittle memorisation, attrition) and **bored** (too easy → affective drop-off). Formally: **damp local acceleration** — keep the curvature of each (learner, unit) execution-vs-flow signal near zero, nudging *before* a developing struggle becomes a crash. By the time the *level* has moved you are late; acceleration is the leading indicator (§4), which is exactly why the sensor reads the second derivative and the controller acts on it.

This is Principle 1's "invisible finesse": the learner never *feels* the controller. Like a good accompanist following a soloist.

## 2. What the controller reads

Per (learner, LEGO) — and, where the signal is stable enough, per word and per **boundary** (the join between units, where retrieval-while-still-producing catches people):

- `accelerationAlarm(series)` over the unit's recent execution/latency/length signal → the set of points where |acceleration| is high **relative to that learner's own noise** (B1's own-noise detector, not an absolute cutoff). A positive acceleration on latency or length-delta = a struggle *developing*.
- The unit's **mastery stage** (`MasteryStateMachine`, live) and **exposure history** (Layer 1, once `learner_lego_state` is persisted — A3).

A single cycle has no curvature, so every read is gated on a minimum number of cycles (B1's `minSamples`). No instance triggers anything; only a **pattern** does.

## 3. The two operational questions — answered with primitives we already have

The whole budget reduces to two questions. Principle 5's discipline: answer both with a primitive already in the data, and earn a richer signal only if the data later shows the primitive failing.

**Drill or defer? → ~~introduction order~~ forward-reuse centrality (SUPERSEDED 2026-07-31 — founder ruling, see `docs/DECISIONS.md`).** The original C1 answer was introduction order: the author sequenced by conversational impact, so early = critical, for free. Tom's 2026-07-31 ruling replaces the proxy with the thing it proxied: criticality = **does this LEGO block the path forward?**, measured as forward reuse — the number of *subsequent* phrases and M-LEGO compositions that contain it (`packages/core/src/learning/centrality.ts`, computed offline from course content at script-build time). Intro-order is *subsumed*, not contradicted: early LEGOs naturally score high on forward reuse because the whole course sits ahead of them — and intro-order remains the fallback for any unit with no centrality read. What changes is the tail the proxy got wrong: measured on spa_for_eng, 129 of the top-15% hubs (que, lo, no, a, de — the structural glue re-introduced mid-course) sit *past* the old 15% frontload cutoff and were wrongly deferrable; conversely, zero-reuse early one-offs no longer resist deferral by accident of position.

**Deferred return (same ruling's companion):** the Fibonacci SR schedule stays the return *mechanism*, but the policy now also signals `returnReady` when a deferred unit's neighbourhood (±3 introduction ordinals) reads easing with none struggling — the measured version of "the surrounding map has thickened". Advisory and shadow-logged only; nothing consumes it yet.

**When does a deferred item return? → the Fibonacci SR schedule.** Deferral is timing, not abandonment. Deferring *is* letting the existing `SpacedRepetitionQueue` space the item out; it resurfaces once the surrounding map has filled, which spacing already approximates. No separate "neighbourhood-consolidated" computation.

## 4. The levers — and the hard line around them

The controller's actual levers are the millisecond-scale ones the learner would never bother with manually, and which they will never notice:

- **Pause multiplier** — the ratio of PAUSE length to model-sentence length. Already live as `useAdaptationEngine.getPauseMultiplier(legoId)`, today keyed off mastery stage; M2 extends it to be nudged by local curvature.
- **Repetition count / scheduling** — bring a struggling unit back a little sooner (within the SR schedule), give a consolidating one a little more air.
- **Budget split** — how much of the next N cycles goes to consolidate vs the deferred/drilled few.

**The hard line (Principle 1 corollary):** anything the learner would notice *from outside the session* — reordering the curriculum, dropping a course, surfacing a remedial sub-track — is **not the controller's to do silently.** It writes that to a `surface_to_human` queue (C3) for the tutor/teacher to action at a higher level. The dashboards are partly *where signals the engine would otherwise act on silently get rendered for a human.* This line is also what keeps the controller safe to ship: its silent powers are bounded to the imperceptible.

## 5. The consolidate-lean, and why it's falsifiable

SSi's lean — against the mainstream drill-your-weakness instinct — is **default to consolidate and defer; reserve drill for the structurally critical few.** A hard item is usually blocked by a thin surrounding map, not by lack of exposure to itself; grinding it in isolation builds brittle memorisation and risks the drown wall, while consolidating strengths keeps the learner *in the session* (the bored wall is affective) and thickens the map that makes the deferred item land almost for free on return.

Because the metric layer captures all of this, the lean is **falsifiable**: as population and school-pilot data accumulate we can test whether defer-and-consolidate actually beats drill-the-weakness for rate of progress. The architecture gets to check its own pedagogy rather than assert it.

## 6. Build order (workstream C) and what gates it

| Step | What | Gated on |
|---|---|---|
| **C1** | Budget policy: criticality = ~~introduction order~~ forward-reuse centrality (2026-07-31 ruling, §3 above — the "earn it" bar was met: shadow logs shipped, the proxy's tail failure measured); return = Fibonacci SR + the `returnReady` neighbourhood signal. | `B4` (curvature per unit) |
| **C2** | Acceleration-damping controller: nudge pause multiplier + rep count to keep local curvature near zero. Extends `useAdaptationEngine` / `MetricsTracker`; persists Layer 1 state. | `B4` + `A3` (Layer 1 persisted) |
| **C3** | `surface_to_human` queue — engine actions needing sign-off, written for the dashboard to read, never done silently. | `A4` (Layer 2) |

**Honest dependency:** C is **not** start-now. It needs `B4` (curvature run *locally* per unit — a thin layer over the B1 engine) and persisted Layer 1 state (`A3`, a Tom-applied migration). The sensor (B1) and the pause-multiplier lever (`useAdaptationEngine`) exist *today*; what's missing between them is the per-unit curvature read and somewhere to persist it. So the **next** concrete code step toward M2 is **B4**, not C directly.

## 7. BSC narrative

- **Better:** turns the adaptation engine from a mastery-stage lookup into a controller that catches a *developing* struggle before it crashes — the per-learner finesse the flat 30/100h average can't give, kept invisible per Principle 1.
- **Simpler:** reuses every primitive already here — the curvature engine (B1), the Fibonacci SR queue, introduction order as criticality, the live `getPauseMultiplier` lever, `MasteryStateMachine`. It *adds no taxonomy*: no `communication_layer` tag, no graph-centrality, no new criticality model.
- **Cheaper:** the only genuinely new compute is B4 (curvature per unit) + persisting Layer 1; the controller is a small extension of an existing composable, and its risky/visible actions are deliberately *not* built — they're deferred to a human queue.

## 8. Open questions (for Tom / Aran)

1. **Damping gain.** How aggressively should a positive-acceleration flag move the pause multiplier — and what's the cap, so "invisible finesse" stays invisible? Wants a feel-tuned ceiling, not a formula.
2. **Boundary signal viability.** Is per-*boundary* curvature stable enough to act on, or only per-LEGO for now? (Earn the finer unit only if the data carries it.)
3. **Drill threshold for early-layer items.** "Early = resists deferral" needs a cutoff: how early is early? Introduction-order percentile, belt, or a hand-set front-loaded set?
4. **C2 safety proof.** Before any silent lever ships, what's the evidence bar that the controller never degrades a session — a shadow-mode run (compute the nudge, log it, don't apply) until the logs look sane?
