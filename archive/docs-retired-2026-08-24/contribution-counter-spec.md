# Contribution Counter — "Part of the Solution" Feature Spec

> **Date**: 2026-04-11
> **Status**: Design spec — ready for implementation
> **Philosophy**: You're not practising so that one day you can speak Welsh. The 17 minutes you just did? That WAS Welsh being spoken.

---

## What It Is

A live, always-visible counter showing how much of a language has been spoken by all SSi learners — and your contribution within that total.

This is **the** social feature. No chat, no groups, no scheduling, no obligation. Just a living number that grows every time anyone practises anywhere in the world. You are part of the solution to language decline, and you can see it happening.

---

## What Already Exists

| Component | Location | Status |
|-----------|----------|--------|
| `daily_contributions` table | `supabase/migrations/20251219160000_gamification.sql` | Schema exists, indexed by language+date |
| `ContributionCounter.vue` | `components/learner/ContributionCounter.vue` | Component exists — shows today only |
| `useLearnerJourney.ts` | `composables/useLearnerJourney.ts` | Fetches `daily_contributions` for today + user's sessions |
| Schools dashboard counter | `views/schools/DashboardView.vue` | Govt admin sees "Welsh spoken today" |

**What's missing**: multi-timeframe aggregation, live updates during practice, and prominent placement in the learner UI (not just schools dashboard).

---

## Data Model

### Existing: `daily_contributions` table

```sql
daily_contributions (
  target_language TEXT,        -- 'cym', 'spa', 'cor', etc.
  contribution_date DATE,     -- one row per language per day
  phrases_count INTEGER,      -- total cycles completed
  minutes_practiced INTEGER,  -- total minutes
  unique_speakers INTEGER,    -- distinct learners who practised
  UNIQUE(target_language, contribution_date)
)
```

### New: Aggregation query (no schema change needed)

```sql
-- Today
SELECT phrases_count, minutes_practiced, unique_speakers
FROM daily_contributions
WHERE target_language = $1 AND contribution_date = CURRENT_DATE;

-- Last 7 days
SELECT SUM(phrases_count), SUM(minutes_practiced), COUNT(DISTINCT contribution_date)
FROM daily_contributions
WHERE target_language = $1 AND contribution_date >= CURRENT_DATE - 7;

-- Last 30 days
SELECT SUM(phrases_count), SUM(minutes_practiced)
FROM daily_contributions
WHERE target_language = $1 AND contribution_date >= CURRENT_DATE - 30;

-- All time
SELECT SUM(phrases_count), SUM(minutes_practiced)
FROM daily_contributions
WHERE target_language = $1;
```

### New: User's personal contribution (per timeframe)

```sql
-- User's contribution today / 7d / 30d / all time
SELECT
  SUM(duration_seconds) / 60 as minutes,
  SUM(items_practiced) as phrases
FROM sessions
WHERE learner_id = $1
  AND course_id = $2
  AND started_at >= $date_threshold;
```

### Populating `daily_contributions`

The table needs to be kept current. Two approaches (implement both):

**1. Real-time increment (on cycle complete):**
```sql
-- Called by the app after each cycle
INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
VALUES ($lang, CURRENT_DATE, 1, 0, 1)
ON CONFLICT (target_language, contribution_date)
DO UPDATE SET
  phrases_count = daily_contributions.phrases_count + 1,
  minutes_practiced = daily_contributions.minutes_practiced + EXCLUDED.minutes_practiced,
  updated_at = NOW();
```

The `unique_speakers` count is trickier for real-time (can't just increment). Options:
- Approximate: increment only on first cycle of the day per learner (track in localStorage)
- Exact: nightly batch recalculates from `sessions` table

**2. Nightly reconciliation (cron or Supabase function):**
```sql
INSERT INTO daily_contributions (target_language, contribution_date, phrases_count, minutes_practiced, unique_speakers)
SELECT
  SPLIT_PART(course_id, '_for_', 1) as target_language,
  started_at::date as contribution_date,
  SUM(items_practiced),
  SUM(duration_seconds) / 60,
  COUNT(DISTINCT learner_id)
FROM sessions
WHERE started_at::date = CURRENT_DATE
GROUP BY 1, 2
ON CONFLICT (target_language, contribution_date)
DO UPDATE SET
  phrases_count = EXCLUDED.phrases_count,
  minutes_practiced = EXCLUDED.minutes_practiced,
  unique_speakers = EXCLUDED.unique_speakers,
  updated_at = NOW();
```

---

## UI Spec

### 1. During Learning — Subtle Corner Counter

Small, unobtrusive, top-left or top-right of the player. Does not compete with the learning cycle.

```
┌──────────────────────────────────────────┐
│  🗣️ 34,308 mins today (+17 yours)       │
│                                          │
│                                          │
│        [LEARNING CYCLE CONTENT]          │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

**Behaviour:**
- Shows on app load (fetched from `daily_contributions`)
- The global number updates periodically (every 60s poll, or Supabase realtime subscription)
- "+X yours" increments locally in real-time as cycles complete (no DB round-trip)
- Tapping/clicking expands to the full timeframe view (overlay, not navigation)
- Fades to lower opacity after 5s of learning, returns on pause/idle

### 2. Expanded View — Timeframe Toggle

Accessible by tapping the corner counter, or from the home/landing screen.

```
╔════════════════════════════════════════════╗
║  WELSH SPOKEN                              ║
║                                            ║
║  Today     7 days    30 days    All time   ║
║  ─────     ──────    ──────     ────────   ║
║  34,308    241,092   1.04M      14.2M      ║
║  minutes   minutes   minutes    minutes    ║
║                                            ║
║  Your 17 mins joined 312 other speakers    ║
║  today keeping Welsh alive.                ║
║                                            ║
║  ┌──────────────────────────────────────┐  ║
║  │ Today    7 days   30 days   All time │  ║
║  │ +17      +89      +340      +4,200   │  ║
║  │ mins     mins     mins      mins     │  ║
║  └──────────────────────────────────────┘  ║
╚════════════════════════════════════════════╝
```

**Top row**: Global totals for the target language across all SSi learners.
**Bottom row**: Your personal contribution within each timeframe.
**Middle text**: Changes per timeframe:

| Timeframe | Copy pattern |
|-----------|-------------|
| Today | "Your 17 mins joined 312 other speakers today keeping Welsh alive." |
| 7 days | "You and 847 others spoke 241,092 minutes of Welsh this week." |
| 30 days | "SSi learners spoke more Welsh this month than the population of Aberystwyth." |
| All time | "14.2 million minutes of Welsh. You contributed 4,200 of them." |

### 3. Home/Landing Screen

When the app opens (before learning starts), the counter is the first thing visible:

```
    Welsh today: 34,291 minutes
    312 speakers

    [Continue Learning]
```

Not buried. Not secondary. This IS why you're here.

### 4. Collective Milestones (Future)

When global thresholds are crossed, all learners see a celebration:

- "Welsh learners hit 1 million minutes this year"
- "More Cornish was spoken today than any day in 50 years"
- "Irish learners just passed 10,000 hours — together"

These are stored in `learner_milestones` with `milestone_type = 'collective_*'` and displayed once per learner.

---

## Implementation Plan

### Phase 1: Wire up the data (backend)

1. **Populate `daily_contributions` from `sessions`** — write a Supabase function or Edge Function that runs on session insert/update. For MVP, a simple `ON INSERT` trigger on `sessions` that increments the day's row.

2. **Add aggregate query endpoint** — new composable `useContribution.ts` that fetches:
   - Global totals for today / 7d / 30d / all time
   - User's personal totals for same timeframes
   - Returns reactive refs

### Phase 2: Learner UI

3. **Corner counter during learning** — add to `LearningPlayer.vue`:
   - Small overlay, top-left
   - Fetches on mount, polls every 60s
   - Local increment on `cycle:complete` event
   - Tap to expand

4. **Expanded timeframe view** — new component `ContributionExpanded.vue`:
   - 4-tab timeframe toggle
   - Global totals + personal contribution
   - Context-aware copy (language name, speaker count)
   - Slide-up overlay from corner counter

5. **Home screen prominence** — add to app landing / course selection:
   - Show today's global total for the learner's active course language
   - "Continue Learning" button below

### Phase 3: Polish

6. **Fade behaviour during learning** — counter fades after 5s of active learning, reappears on pause
7. **Number formatting** — "1.04M" for millions, "241K" for thousands
8. **Endangered language emphasis** — for languages with fewer speakers, show more emotional copy
9. **Collective milestones** — detect threshold crossings, store + display once per learner

---

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `composables/useContribution.ts` | **Create** | Fetch global + personal contribution data across timeframes |
| `components/learner/ContributionCounter.vue` | **Modify** | Add timeframe toggle, expand/collapse, live increment |
| `components/learner/ContributionExpanded.vue` | **Create** | Full timeframe overlay view |
| `components/LearningPlayer.vue` | **Modify** | Add corner counter overlay, wire cycle:complete to local increment |
| `supabase/migrations/YYYYMMDD_contribution_trigger.sql` | **Create** | Trigger to increment daily_contributions on session insert |

### No schema changes needed

The `daily_contributions` table already has the right structure. The `sessions` table already captures `duration_seconds` and `items_practiced`. We just need to:
1. Keep `daily_contributions` populated (trigger)
2. Query it across timeframes (composable)
3. Show it prominently (UI)

---

## Why This Works

- **Zero coordination** — you contribute by learning, nothing else required
- **Can't be gamed** — minutes come from actual practice tracked by the app
- **Scales to one person** — even if you're the only Manx learner today, you still contributed
- **Especially powerful for endangered languages** — the smaller the community, the more each minute matters
- **Government loves it** — demonstrable, measurable revitalisation impact
- **Guilt-free** — "312 other speakers joined you" not "you missed yesterday"
- **Literally true** — every cycle where a learner speaks during the pause = a moment where that language exists in the world that otherwise wouldn't have

---

*"We don't motivate people to learn. We help them notice that they're part of something bigger than themselves."*
