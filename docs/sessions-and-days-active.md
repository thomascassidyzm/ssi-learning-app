# Sessions, Sittings & Days-Active

**Status:** Decided 2026-06-02 (Tom). Reference for the contribution/consistency mechanics — read before building any "session count" or streak/consistency feature.

---

## TL;DR

**Stop counting "sessions". They are not the unit of anything we care about.**

The word "session" hides two different things. Separate them:

| Concept | What it is | Lifetime | Used for |
|---|---|---|---|
| **Sitting** | one continuous bout of practice | **ephemeral** (in-memory) | the belt/​modal "Session" m:ss timer, pomodoro nudges, "this session" transformation stats |
| **Day-active** | did you practise *at all* on a calendar day | **persisted** (already have it) | the real metric — consistency multipliers, return-celebration, "days active in the last N" |

A raw session *count* is meaningless (several per sitting), gameable, and guilt-shaped. We don't store it and we don't show it.

---

## Why days, not sessions

This follows directly from `docs/gamification-done-right.md`. That whole engine counts **days**, never sessions:

- Consistency multiplier → "7–10 **days** / 5–6 days / 3–4 days" out of the last 10/30
- Hidden bonuses → "7 of last 10 **days**", "25 of last 30 **days**", "return after 3+ **days**"
- Return celebration → keyed on **days away** (1 / 3 / 7 / 30)
- Explicitly anti-streak: *"Streaks create guilt… never 'you broke your streak'."*

So the persisted unit is **distinct days practised in a window**, held invisibly and surfaced only as warmth — never as a streak tally.

We already have the data: `learner_speaking_opportunities` is keyed `(learner_id, course_code, UTC day)`. Therefore:

```
days_active_in_window = COUNT(DISTINCT day)  -- over the chosen window
```

No new table, no "sessions" concept required for any of the consistency mechanics.

---

## The sitting, and the 5-minute window

A **sitting** is one continuous bout. It powers the ephemeral timer (the belt pill's m:ss and the stats-modal "Session" headline) and, later, the pomodoro nudges. It is **not** persisted as a countable row — it's just "how long this bout has been going".

**Boundary rule — reuse the resume window, do not invent a second threshold.**

The app already has a 5-minute resume window (`resumeConfig.cycleResetMinutes`):

- gap **< 5 min** → resume at the exact **cycle** you left
- gap **≥ 5 min** → resume at the **LEGO / round introduction** (same LEGO, start of the round)

The sitting boundary is the **same** threshold doing double duty:

- come back **< 5 min** → **same sitting**: the timer keeps running (and you resume at the cycle)
- come back **≥ 5 min** → **new sitting**: the timer resets to `0:00` (and you resume at the round intro)

One concept, one parameter. The minute you'd reset the resume cursor is the minute you'd reset the sitting. (Several Stop/Start taps inside one bout therefore stay one sitting — exactly what we want.)

---

## What this means for the stats modal

- **"Session"** headline = the current sitting's elapsed m:ss (same source as the belt pill — `sessionSeconds`). Continues across short pauses, resets after a ≥5-min gap.
- **"All-time"** = the per-day table summed (unchanged).
- A future **"days active"** line (e.g. "active 6 of the last 7 days") is the natural home for the consistency signal — computed from the per-day table when we build that surface. Per the doc, surface it as encouragement, never as a streak you can break.

---

## Architectural direction (NOT now)

If days-active is the unit and the per-day table already holds it, the fragile **`sessions` table earns retirement**: `learner_speaking_opportunities` becomes the single source for the user's stats *and* (eventually) the global community rollup (`daily_contributions`).

We are **deliberately not** doing that migration yet — verified 2026-06-02 that the live `daily_contributions` rollup is healthy and far richer than the young per-day table, so re-pointing now would *shrink* the community totals. Bank the direction; don't touch it until the per-day table has the history to back it (a one-time backfill from `sessions` would be the bridge). See `project_ssi_stats_modal_redesign` memory.

---

## Parameters (everything is a parameter)

| Name | Value | Source |
|---|---|---|
| sitting / resume window | 5 min | `resumeConfig.cycleResetMinutes` (one knob for both) |
| consistency windows | last 10 / 30 days | gamification-done-right.md |
| return-celebration thresholds | 1 / 3 / 7 / 30 days | gamification-done-right.md |

---

## Done / Not-done

- **Done now:** the sitting timer honours the 5-minute window (continue within, reset after) — so the modal's "Session" number behaves per this model.
- **Documented, build later:** days-active feeding the invisible consistency multipliers + return-celebration (part of the wider gamification build; this note is the contract for it).
