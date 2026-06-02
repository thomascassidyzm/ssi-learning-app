# The Insight Engine

*A position paper on turning SSi's telemetry into world-class, self-interpreting insight. This is the **delivery system**; its measurement model is **Measuring Progress** (`metrics-architecture.md`). Built to be argued with.*

**Status:** Draft for discussion — Tom + Aran, 2026-06-02.
**Companions:** `metrics-architecture.md` (*what* we measure — the model this engine reads), `admin-insights.md` (the catalogue of insights it serves first).
**Lives in:** the admin Methodology hub, beside *Measuring Progress* and *The Listening Pod*.

---

## 1. The opportunity: for the first time, we can both capture *and* interrogate

Real insight has always needed two things, and for most of SSi's life we had neither. We couldn't reliably **capture** what learners actually did — the telemetry wasn't there. And even where data existed, we had no way to **interrogate** it without a bespoke build for every question. Either gap alone is fatal.

Both are now solved — and that is the genuinely new, genuinely exciting thing. We capture everything: tens of thousands of events a month, nearly every one tagged on every axis at once — content, learner, cohort, region, device, build, time. And the means to ask it *anything* is exactly what this paper builds. We are, for once, in the rare and happy position of designing the interrogation layer **from scratch, on a full data substrate.**

So the opportunity is generous, and forward-looking: not "a better dashboard" (a dashboard is only a cheaper *answer* to a question someone already chose), but **driving the cost of asking a new question toward zero** — an engine where a new insight is a *composition*, not a *project*. That single shift is the whole leap to world-class. The substrate is here; what we get to build is the engine that lets us ask.

---

## 2. It plays on the same field as *Measuring Progress* — same substrate, new surface

This paper does not introduce a competing theory of measurement. It would be a failure if it did. *Measuring Progress* defines **what** we measure: the two-axis (difficulty × execution) coordinate, the discipline of reading **curvature, not level**, the **self / group / world** frames, the **sovereign comparison** rule (entity vs aggregate, never a named peer), and the layered architecture (events → per-learner → cohort → views).

The Insight Engine is the **delivery system that reads that model.** Its entire vocabulary *is* the measurement model's:

- its **metrics** are the measured signals (retention, friction, calibration, hours, conversion…),
- its **frames** are *Measuring Progress*'s self / group / world / content,
- its **order** is *Measuring Progress*'s level / velocity / acceleration.

Nothing is invented here; the measurement model is made **queryable, composable, and self-interpreting.** Coherence is the point — one theory of measurement, one engine that serves it everywhere, so that a number a learner sees and a number an admin sees are the *same definition* at different `GROUP BY` levels.

---

## 3. The architecture — three layers

### 3.1 A semantic substrate — the *what*, declared as config, not code

The reason questions have been expensive is that the *meaning* of each metric lived inside one-off SQL and one-off charts. The fix is to lift it out: define, **once and declaratively**, the primitives —

- **Entities** — learner, course, LEGO / seed, cohort, region, class, build.
- **Metrics** — each a single, named, tested definition (retention, friction, days-active, hours-to-milestone, calibration, trial→paid…).
- **Dimensions** — time, course, region, device, build, entry-cohort.
- **Frames** — self / group / world / content.
- **Order** — level / velocity / acceleration.

Then **any** question is a composition: `{metric} × {entity} × {dimensions} × {frame} × {order} × {filter}`. *"Welsh learners, last 30 days, skip-back, content-relative, acceleration"* is a **row, not a build.** This registry is the thing that lets us "easily think of how to use the data" — because every new thought is *already expressible* the moment we have the words for it. It is also where correctness lives: a metric is defined and tested once, so two surfaces can never quietly disagree about what "retention" means.

### 3.2 A composable query surface — ask in plain language

On top of the registry, the interface is **natural language in.** *"Which courses do trial users stick with longest?"* → the model maps it to a composition over the registry → an answer comes back. The team stops *waiting for a chart to be built* and starts *asking*. Saved compositions become the "boards" (the course scoreboard, the quality queue, the conversion funnels of `admin-insights.md`) — but they are **instances of the engine, not hand-built pages.** The boards are bookmarks, not software.

### 3.3 The interpretation layer — an analyst in the box *(the world-class part)*

Every analytics tool ever built hands you numbers and makes *you* the analyst. This is where almost all of them stop, and it is exactly where the value leaks out — because reading a chart correctly is a skill, and a busy team does it rarely and late. The Insight Engine closes that gap by putting an **interpreter** on top of the substrate:

- **Explain.** *"L03 skip-back is up 40% across 18 learners this week. That's content-relative, so it's a quality signal, not adaptation — most likely a mis-split. Suggested action: re-split, or defer behind richer context."* Number → meaning → action, in one step.
- **Discover.** A proactive read — *"here are the three things in your data this week worth a human's eye, and why."* It surfaces the question you didn't know to ask. This is the engine's own completeness check: what moved, what's anomalous, what's worth attention.

This layer is a **deliberate, billed-by-design runtime model call** — the same pattern as the Configuration-Economics Alexander guide, *not* the accidental-API-key trap we have been bitten by before. It is engineered cost-bounded from the first line: it reasons over **aggregates, never raw events**; it is **admin-gated**; it runs **on demand and cached**, never as an always-on firehose. (Development-time work still runs on the CLI; only this product feature calls the API.) Critically, those constraints are not a tax — they are *exactly* what §7 already requires, so the cheap design and the safe design are the same design.

---

## 4. Why this is world-class, and where the honesty line is

The claim is specific and falsifiable: **the near-zero marginal cost of a new question, with the interpretation included.** That is the thing competitors with bigger data teams still do not have, because they solved the *answer* (dashboards) and never solved the *question* (the cost of asking one). An engine + an interpreter means the *thinking* scales without the *building* scaling — which is the only way a team SSi's size out-insights teams ten times its size.

And the honesty line, stated plainly so we never oversell it: this is an **analyst in the box over our own data**, not an oracle. It reasons over aggregates, proposes hypotheses, and points a human at what to look at. It does not assert causation it cannot see, and it never replaces the judgement call — it removes the *grind* that currently stops the judgement call from being made at all.

---

## 5. Future-proof: the vocabulary grows, the architecture does not

The test of an architecture is what happens when the world changes under it. Here, every foreseeable change is **additive to the registry, not a rebuild of the engine:**

- **VAD lands** (the execution / prosody axis of *Measuring Progress*) → new metrics in the registry. The engine is untouched; its vocabulary simply grows. Behavioural-first today, prosody-rich tomorrow, *same engine.*
- **A real school arrives** → a new entity and a new frame level; the sovereignty and k-anonymity rules already handle it (they were designed for exactly this).
- **A new audience** — learner, tutor, admin, government — is **a different lens on one substrate**, not a new product. The learner's "how am I doing vs other Spanish learners" and the admin's "how is the Spanish course doing" are the same composition at different levels.
- **The interface never needs redesigning as the data grows**, because the interface is *language*, and language already spans whatever the registry can express. That is the deepest form of future-proofing: the surface area can 10× and the way you interact with it does not change.

---

## 6. The discipline — so this is a commitment, not a boil-the-ocean

The danger with a vision this size is that it becomes an excuse to build a platform before building a feature. It must not. The discipline is *Measuring Progress*'s Principle 5 — **better × simpler × cheaper, and never build a signal before its consumer exists** — applied to the engine itself:

- **Commit to the approach now.** From here on, every board we build is an *instance of the engine* — defined in the registry, never a one-off page. The architecture is what we commit to today.
- **Start tiny.** Five metrics, two frames, one `explain` call, over the raw tables that already exist (`admin-insights.md` §5: no rollup tables until something strains). The registry can be five entries on day one and fifty by VAD-time.
- **Earn each addition.** A new metric, a new frame, the rollup tables, the prosody axis — each lands only when a consumer needs it, never speculatively.

The world-class version is the *destination*; the first version is a handful of registry entries and a single interpreter call. We hold the architecture firmly and the surface area loosely.

---

## 7. The guarantees it inherits — IP and sovereignty, enforced at the substrate

Because every surface is an instance of one engine, the protections are enforced **once, at the substrate, and inherited everywhere:**

- **IP guardrail.** The telemetry is behaviour *over content-IDs*, never the generative method. *What* played, in what order, with what friction — yes; *why* (triple-helix, spaced-rep, adaptation) lives in code, and the content sits behind the entitlement-gated audio proxy. Even a full export is **one realised path, not the rules that generate paths** — it cannot reconstruct the course or the method. The engine never changes that: it reads behaviour and aggregates, never the generative logic.
- **Sovereignty.** Every comparison is entity-vs-aggregate, never entity-vs-named-peer, with a **k-anonymity floor** so a band of one or two can't leak an individual. The interpreter sees cohorts and aggregates, never a named learner.

Internally, for SSi admin, the engine is fully generous — it's our content and our learners — but it is built so that even an internal tool *cannot* become an external leak.

---

## 8. Open questions (for Aran)

1. **LLM-from-the-start, or substrate-first?** Do we wire an `explain` call into the very first board (proving the world-class shape immediately), or prove the semantic substrate on two or three boards and add the interpreter once there is something worth interpreting?
2. **How far does the engine reach beyond admin?** The unified-substrate ambition says the *same* engine could serve the learner's self-vs-cohort view and the tutor's needs-attention list. Do we design for that from day one, or admin-only first and generalise later?
3. **The registry's first five metrics.** Which five questions matter enough to define first? (Candidate: retention, content-friction, days-active, trial→paid, audio-failed.)
4. **Build vs buy for the semantic layer.** Hand-roll a tiny metric registry, or adopt an existing metrics-layer convention? (Lean: hand-roll tiny, because the registry's *content* is the value, not the framework.)
