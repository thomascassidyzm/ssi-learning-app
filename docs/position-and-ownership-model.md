# Position vs Ownership — the cycle/round model

> The one rule that makes resume, belt display, spaced-rep and telemetry
> unambiguous: **a cycle's IDENTITY (who it belongs to) is separate from its
> POSITION (where in the script it's playing).** Conflating them caused every
> belt/resume bug we hit (Dutch belt desync, INF-PLAY false-green, the
> resume overshoots). Locked with Tom, 2026-05-29.

## The distinction

A cycle has **one owner** but **many positions**: its debut slot, plus every
spaced-rep revisit. So you cannot describe a cycle with a single coordinate.

### OWNERSHIP (identity) — stable, one per phrase
`{ legoId, role, index }` carried as fields on the cycle.
- `legoId` — the parent LEGO this cycle belongs to (`S0048L02`).
- `role` — `intro` | `debut` | `build` | `use` | `review` | `spaced_rep` | component variants.
- `index` — position within that LEGO's own basket.
- **Content + spaced-rep scheduling derive from OWNERSHIP.** What the learner
  is being taught/shown is a function of the owning LEGO, regardless of where
  it plays.

### POSITION — assigned at script-build time, many per phrase
`{ round, slot }`.
- `round` — the **introduced-LEGO round index**. The round axis already exists
  as the materialised view `course_round_index` (one row per `is_new = true`
  LEGO, ordered → round number). The round's "primary" LEGO is the LEGO being
  *introduced* at that round.
- `slot` — the cycle's index **within that round** (0-based).
- **The cursor (resume position) AND the belt derive from POSITION.** Where the
  learner *is* — and therefore which belt shows — is the round's introduced
  LEGO, **not** the owner of whatever cycle is currently sounding.

The same phrase (owner `S0013L03` "jako") appears at its debut round AND inside
later rounds as a spaced-rep review — different `{round, slot}` each time, same
ownership.

## Why telemetry must record BOTH

When you log a cycle event, capture **both axes** — they differ for any
spaced-rep / review cycle:
- **Ownership** — `legoId`, `role`, `index` → "what is this, what's it teaching."
- **Position** — `roundNumber` (absolute) + `slot` → "where in the script it played."

A spaced-rep cycle in round 620 might *own* `S0040L01` (a low seed) while its
*position* is round 620. Reporting only the owner makes the timeline look like
the learner leapt backwards; reporting only the position loses what was taught.
Record both.

### Hard rules for telemetry / position logic
- **Never key on a parsed seed string.** `findRoundIndexForSeed`'s exact
  `S0080` match (silent `-1` on a miss) is the anti-pattern behind the belt
  desync. Resolve by LEGO id (`findRoundIndexForLegoId`) or, for belt
  thresholds, the **nearest `>=`** resolver (`findRoundIndexForBeltThreshold`).
- **`roundIndex` in `player_events` payloads is SESSION-RELATIVE** (resets to 0
  each session). Only `roundNumber` (absolute) and `legoId` are real position.
  Any position/resume math that touches the payload `roundIndex` is a bug.
- **A composite string like `S0048L02B04`** ("build #4 of lego 2, seed 48") is a
  **derived, human-readable LABEL only** — for logs and the admin map. Never a
  lookup key (parsing it back re-opens the string-match wound). Compute it for
  display; store/look-up via the structured fields.

## Cursor / resume (completion-driven)

- The cursor **advances only on cycle COMPLETION**, where **completed == VOICE 2
  has played** (pause + voice 1 are skippable; voice 2 is the unskippable gate
  before the next cycle — the existing `cycle_completed` event fires after it).
- **Resume = the cycle immediately after the last voice-2-completed cycle**
  (the `+1` is at **cycle/slot** granularity, never round-level). Because every
  advance requires voice 2, the cursor structurally cannot run ahead of
  completion (loaded-but-unplayed rounds never advance it).
- **Resume resolution rule: cursor → highest → R1.** If the cursor can't be
  resolved (null / not in the round set), fall to the ceiling (highest), never
  silently to round 1.
- **INF PLAY** = a sticky mode; the cursor is **frozen at the ceiling**
  (`cursor == highest == final LEGO`). Random USE phrases play on top of a
  position that doesn't move; the belt pins to the final belt. Only an express
  exit (belt-back / jump) leaves the mode and moves the cursor.

## DB shape
- `course_enrollments.last_completed_lego_id` / `last_completed_round_index` =
  the **cursor** (a POSITION, despite the "completed" name — treat as position).
- `highest_completed_lego_id` / `highest_completed_round_index` = the ceiling.
- The trigger `20260512_lego_id_independent_ratchet.sql` ratchets `highest` from
  `last_completed` (lexicographic). **Direct writes to `highest_*` are reverted —
  always write `last_completed_*`.**
- `current_mode` (`main` | `infplay`), `infplay_round_index`.

*Owner of this model: methodology (Tom). Engine implementation: the LEGO-id
belt/cursor rework on `dev`.*
