# What the Data Tells Us — an admin-insights think

*A deep think on the **value** of the telemetry we already capture, and the **types** of insight it yields — before we build any display. Companion to `metrics-architecture.md` (the learner-facing measurement) and the §09 "For SSi" section of `metrics-vision.html` (which this expands).*

**Status:** Think-piece, 2026-06-02. Decides *what to measure for the company*; the dashboard/queries come after.
**Scope:** Admin / SSi-company value — marketing, quality, feedback, health. Schools-dashboard revisit is **parked** until Tom + Aran discuss the position paper.

---

## 0. The premise has flipped

For most of SSi's life the question was *"how do we capture more?"* That question is closed. We now log **~84k events in 30 days** (3× the late-May figure), climbing at ~1,000 events per *hour* of active testing, and — the part that matters — almost every event carries, simultaneously:

- a **content key** — `legoId`, `seedId`, `cycleType`, `role` (which exact unit was playing),
- a **learner key** — `learnerId` / `user_id` (who),
- and **context** — `device_type`, `client_version` (build sha), `cacheHit`, `ip_country`, `occurred_at`, plus event-specific payload (`direction`/`fromPhase`/`toPhase`/`elapsed_in_phase_ms` for the phase-pill, `reason` for failures, `podRound`/`stage`/`sentenceIdx` for pods).

So the new question is **not what to capture — it is what the capture already tells us, and to whom.** This doc answers that, and only that. No displays yet.

---

## 1. The one idea: same stream, two directions

Every insight in this document is one of two readings of the **same** event stream:

- **Learner-relative** — read *down a person*. How is *this learner* doing? Drives **adaptation** (the player flexes for them) and the tutor's "who needs me this week".
- **Content-relative** — read *across people, keyed by unit*. How does *this LEGO / seed / pod-step* treat everyone who meets it? Drives **quality** (the content is wrong) and feeds Popty.

This gives us **Tom's friction law**, which is the single most useful discriminator the data offers:

> **Friction that moves *with the learner* is an adaptation problem. Friction that stays *with the unit* — everyone stalls in the same place — is a quality problem.**

The discriminator is mechanical: take any friction signal (skip-back, stall, drop-off, failure) and ask *does it concentrate on a person or on a LEGO?* Person → the engine quietly flexes (invisible, Principle 1). Unit → the curriculum is at fault regardless of who's playing it → a Popty ticket. Same data, opposite owner. We never have to guess which; the pivot tells us.

This is also why **one** dashboard substrate serves both audiences (the better×simpler×cheaper unified model): the learner sees themselves against a group-average they belong to; admin sees the same signals pivoted to content and cohort. Different reference frame, *one* coordinate — see §4.

---

## 2. What we actually have to work with (grounded)

| Signal source | What it is | Pivots it supports |
|---|---|---|
| `player_events` (~84k/30d) | every audio_play, tap, skip, phase-pill tap, round_complete, pod/commentary, audio_failed | person · **content** · cohort · region · device · **build** · time |
| `learner_speaking_opportunities` | per (learner, course, UTC-day): opportunities + play_seconds | **days-active**, minutes, retention, hours-to-milestone |
| `course_enrollments` | progress: last/highest LEGO, last_practiced_at | **difficulty axis** (where each learner is), stall, recency |
| `daily_contributions` | global per (language, day) | community totals (offset-based, see sessions doc) |
| `learners` | identity, verified_emails, created_at, region | cohorts, acquisition, region |
| `subscriptions` (Paddle) | **0 rows today** | LTV / revenue — *the future axis, empty now* |

The honest boundary, stated once: **no payers yet, and the schools rows are real activity by fake test entities.** So every "value" number today is an **engagement/retention proxy**, not revenue. That is not a weakness — those proxies are the *leading indicators* of the revenue to come, and they are exactly what tells us which courses to back before a single pound moves.

---

## 3. The four insight families (the company lens)

The admin question — *"what can we tell about our users in terms of value to the company?"* — resolves into four families. The first three are Tom's (marketing, quality, feedback); the fourth, **health/ops**, the inventory forced onto the list (audio_failed at 3%, builds landing unevenly — the Aran incident proved this one is load-bearing).

### A — Market better (the learner's journey through the catalogue)
*The marketing pillar is not a scoreboard — it's a **funnel plus a flow graph**: where a learner enters, what converts them, whether they expand. Every marketing question is a stage of one journey.*

**Enter** — *which course, from where.* Entry course (the sign-up-course field — or first-course-played as the proxy) × **region** (`ip_country`). The acquisition map: which course, which place, brings people in.

**Engage** — *how much, before anything else happens.* Depth on the entry course. **Reach** (new/active learners by course × region × time) and **retention** (return-rate over 7/30/90d — the truest pre-revenue value signal) live here, as does **hours-to-milestone** (median in-app hours to the 30h/100h anchors per course — a course that reaches conversation faster is a measurably better product).

**Convert** — *what tips them over — and it is TWO funnels, not one.* The premium model is a **7-day free trial**; free/community courses are unlimited *online* but offline-download gated. So conversion has two distinct shapes:
  - **Trial funnel (premium).** No taster — premium is trial-or-nothing. start-trial → engage across 7 days → convert or churn at day 7. Tells: trial-start rate, **trial→paid rate**, *which day* they commit (early = strong fit), what they did in the trial, which courses retain trial users best. (The "completed the free preview" paywall in code is the *older* model — the events to instrument now are **trial-started / converted / lapsed**.)
  - **Offline-upgrade funnel (free).** Free courses are unlimited online; the single gate, and so the single conversion moment, is **offline download** ("take it with you"). "How far into a free course before they upgrade" is exactly the metric, against that trigger (half-instrumented via `tap_listening_download`).
  - *Which road* a course's learners take is itself a marketing signal — premium courses pull via the trial, free ones via the take-it-with-you moment.

**Expand** — *do they broaden.* How many do **more than one course** (distinct enrollments per learner); paid-in → paid-switch (cross-sell within premium); and the **course-flow graph** — first → next → next (Spanish→French? Welsh→Cornish?). That graph is marketing *and* a sequencing insight at once.

**Value, the through-line.** *"Which courses are doing well"* needs one honest number. Pre-revenue: **total lifetime in-app hours a course has generated**, decomposed into *reach* (learners) × *stickiness* (hours/learner) × *retention* (return-rate) — one figure that shows *why* a course ranks where it does. The day `subscriptions` has payers, real £ LTV by course and acquisition-cohort slots into the same column.

### B — Serve better (the curriculum's own quality loop)
*Where does a course hurt everyone who meets it?* — content-relative, per Tom's law.
- **Friction hotspots per unit** — for each LEGO / seed / pod-step: population-wide **skip-back rate**, **stall** (curvature — they suddenly take far longer), **drop-off** (sessions that end here), and **phase-pill back-taps** (collective "say that again"). A unit that spikes across *many* learners is mis-chosen — too big, mis-split, mis-sequenced.
- **Broken audio** — `audio_failed` keyed by `audioId` / `role` / `device` / `build`. The hardest, cheapest quality win: missing or broken clips are unambiguous and fixable today (this is the pod-audio-orphan class of bug, surfaced not reported).
- **Pod progression** — `podRound` / `stage` / `sentenceIdx` friction shows which *step* of a Listening Pod catches people — directly actionable for the Pod-flow redesign.
- **Delivery quality** — low `cacheHit` on specific content = a buffer/delivery problem, distinct from a pedagogy problem.
- **Output shape** — not a dashboard for its own sake, but an **evidence-led queue to Popty**: *"re-split this LEGO", "this clip is failing on iOS", "pod step 3 here loses 40%."* The course tells us where it fails its learners.

### C — Honest feedback (behaviour over surveys)
*The good self-report is already a tap, not a questionnaire.*
- **Calibration** — the phase-pill (`direction`/`elapsed_in_phase_ms`) is in-the-moment self-assessment expressed as behaviour: confident-skip-forward vs uncertain-re-hear, and *how fast*. Correlated against execution, it tells over- from under-confident (opposite coaching responses).
- **Inaction as signal** — where people skip, stall, drop, and churn is the truest feedback. Learners vote with their actions and *inactions*, not their survey answers.
- **Surveys stay narrow** — reserve voluntary self-report for the one place behaviour can't reach: the small external **CEFR calibration sample**. Never a primary metric.

### D — Health / ops (the fourth, that the data demanded)
*Is the machine healthy, and is my fix actually on people's screens?*
- **Reliability** — `audio_failed` rate over time, by device/build/course; the trend is the alarm.
- **Build landing** — distribution of `client_version` across active learners: who is on the latest vs a **stale SW-cached build**. This is exactly the "did Aran have the fix" question, answerable from the data the moment the stamp is widespread.
- **Delivery** — `cacheHit` rate (buffer health), `device_type` / browser spread (where to test).
- This family isn't pedagogy, but it's the operational floor under everything else — and the data screams for it, so it earns its place.

---

## 4. One substrate, two audiences (the BSC unification)

Don't build a learner dashboard *and* an admin dashboard. Build **one metric substrate** and read it through different **reference frames** (the position paper's Self / Group / World):

- **Learner lens** — *self vs a group-average they belong to* (their course cohort: "all Spanish learners"). Their progress, their days-active, their calibration, their contribution to the community total. **Sovereignty rule:** an individual compares to an *aggregate they're part of*, **never to a named peer** — and an aggregate needs a **k-anonymity floor** so a band of one or two can't leak an individual.
- **Admin lens** — the *same* signals pivoted: content-relative (quality, §3B), region×course (marketing, §3A), cohort (retention/LTV), build/device (health, §3D). **Visibility ≠ comparison:** admin can drill into any single entity and see its real numbers, but every *comparison* it's shown is still entity-vs-aggregate.

The win is that the learner's "how am I doing vs other Spanish learners" and the admin's "how is the Spanish course doing" are **the same query at different `GROUP BY` levels**. One substrate, costed once.

**The IP guardrail (a standing discipline).** The telemetry is behaviour *over content-IDs*, never the generative method. *What* played, in what order, with what friction — yes. *Why* it played — the triple-helix, spaced-rep, and adaptation logic — lives in **code**, and the content itself sits behind the entitlement-gated audio proxy. So even a full data export is a record of **one realised path, not the rules that generate paths**: it cannot reconstruct the course or the method. Keeping it that way is the one discipline on everything built here — never push sequencing logic *into* queryable/exportable data, and keep every learner-facing or external view aggregate + sovereign (the no-named-peer / k-anonymity rule already enforces it). Internally, for SSi admin, we stay fully generous — it's our content.

---

## 5. What's buildable now vs earned later (sequencing)

Per Principle 5 (*don't build a signal before its consumer exists*) — and the consumer (us, admin) now exists:

- **Now, on raw queries — no rollup tables.** Every §3 insight is a query over `player_events` + `course_enrollments` + `learner_speaking_opportunities` as they stand. Region×course reach, content-friction ranking, audio_failed/health, activation/retention, build distribution, needs-attention — all available today without building Layer 1/2. Active populations are small (tens of learners); live queries are cheap.
- **Earned later — when query cost or the engine demands it.** The Layer 1/2 rollup tables (`learner_lego_state`, `learner_metrics`) become worth their cost when (a) live queries get slow at population scale, or (b) the **adaptation engine** needs persisted per-LEGO state — not before.
- **Adoption-paced.** The **execution/prosody axis** stays a parallel track gated on VAD opt-in; today's admin insights run entirely on the **behavioural** tier, which is fully populated.
- **One small build — the conversion moments.** The CONVERT funnel (§3A) is the single place inference isn't enough: make it *exact* by logging **trial-started / converted / lapsed** and **offline-prompt-shown / converted** as explicit `player_events` (the taps already fire — `tap_listening_download` — but the *shown → converted* pairing is what's missing). Cheap, and it's the moment we most want to measure: the only "do-now" here that's instrumentation rather than a query. Plus one *verify* — where the **sign-up-course** field actually lives (vs leaning on the first-play proxy).

So: **admin insight views on raw queries first; promote to rollups only when something actually strains.**

---

## 6. The first cut (proposed — for the "value to the company" ask)

If we build one admin surface first, it answers Tom's first-level question directly. Three boards over raw queries:

1. **Course scoreboard** — one row per course: active (7/30d), new this month, return-rate, median hours-to-30h, an LTV-proxy, and a friction-hotspot count. Ranks *"which courses are doing well."* (Marketing/value.)
2. **Content-friction board** — per course, the top friction units (skip-back / stall / drop-off / audio_failed), each a one-click Popty question. (Quality.)
3. **Health strip** — audio_failed rate, cacheHit, `client_version` spread, device spread. (Ops — and our "is the fix live" gauge.)

The per-learner **needs-attention** list and the **individual unified view** (learner-vs-cohort) come next, on the same substrate. Schools stays parked.

---

## 7. The open decisions (for Tom)

1. **Audience-first order** — admin-company boards first (this doc's §6), or the *individual* unified learner-vs-cohort view first? (They share the substrate; it's a question of which consumer we serve first.)
2. **LTV proxy definition** — agree the pre-revenue value formula (retention × hours? + activation weight?) so "which courses are doing well" has one honest number, not five.
3. **Friction thresholds** — what skip-back / stall rate, over how many distinct learners, promotes a unit to "quality issue" vs "noise"? (A k-floor here too — one struggling learner isn't a content bug.)
4. **Where it lives** — extend the existing `AdminAnalytics` / `useAnalytics*` suite (it already has engagement/friction/growth/retention composables), or a fresh insights surface? Likely extend — the scaffolding is already there.
