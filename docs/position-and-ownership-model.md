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

## Navigation controls — "granularity = location"

Three transport controls, three POSITION levels, each unambiguous by where
it lives. All position-keyed; the belt **DERIVES** from the landed round
(`deriveBeltFromLandedRound`), never an independent `setPlayingPosition` and
never a parsed seed string.

| Control | Location | Axis | Engine |
|---|---|---|---|
| `‹ ›` | bottom nav | **CYCLE** (slot ±1) | `simplePlayer.stepCycle(±1)` |
| `‹‹ ››` | header | **ROUND / LEGO** (introduced LEGO ±1) | `handleRoundBack` / `handleRoundForward` |
| central pill | header | **BELT** jump (modal) + INF-PLAY readout | `handleBeltPillTap` → modal (`handleSkipToBelt` / `handleActivateInfPlay`) |

1. **Bottom-nav `‹ ›` = CYCLE advance/regress.** Step one practice cycle
   (slot ±1) within the current round, crossing round boundaries naturally
   (last cycle → next round's first cycle; first cycle → previous round's
   last). `SimplePlayer.stepCycle(direction)` does the slot arithmetic and
   routes through `jumpToRound` (honours Turbo-culled cycles via
   `find{Next,Prev}PlayableCycleIndex`). Finest, most-used control. Wired
   `BottomNav` → `handleRevisit` (-1) / `handleSkip` (+1).

2. **Header `‹‹ ›› = ROUND / LEGO advance/back.**
   - **Forward** (`handleRoundForward`): in the main loop, go to the NEXT
     introduced LEGO (round +1, by LEGO id); at the FINAL LEGO, advancing
     ENTERS INF PLAY (`enterInfPlay()`). **WHILE IN INF PLAY** (`current_mode
     === 'infplay'`, or sitting on a non-main-loop round) forward is **NOT a
     no-op — rounds still exist in INF PLAY**: it STEPS THROUGH the revival /
     spaced-rep rounds (the recycled rounds appended after the main loop at
     `cachedRounds` indices `>= mainLoopCount`), wrapping back to the first
     revival round at the tail (`advanceInfPlayRound`). The belt stays PINNED
     to the final belt (revival rounds carry a random USE legoId that would
     otherwise bounce the indicator); the central-pill ∞ "round N" readout
     (`infplayRoundIndex`) bumps each step. No revival set loaded →
     `enterInfPlayFromCache()` (never stall).
   - **Back** (`handleRoundBack`): go to the PREVIOUS LEGO and REPLAY its
     intro/debut — jump to that round's START (slot 0) so intro/debut/build
     play again (the learner can cycle-skip them via `‹`). LOADs the previous
     LEGO's rounds if not loaded (mirrors the belt-back load-then-resolve
     fix). **Remains the INF-PLAY exit** (flips `current_mode` → `main`,
     force-loads the main loop, lands on the last main-loop LEGO) — only
     round-back leaves the mode; forward stays inside it.

3. **BELT jump = MODAL ONLY.** The header chevrons are no longer belt nav.
   Belt jumps live in the belt-pill modal (`handleSkipToBelt`, LEGO-id-keyed).
   The modal's belt row is **colour-only**: each belt is just its coloured dot
   (no text label) with a **thin black ring** so the WHITE belt reads on the
   white modal and every dot gets a crisp edge; the belt NAME lives in the
   button's `title`/`aria-label` (semantically present, visually gone).

4. **Central belt-progress pill = belt readout + INF-PLAY indicator.** Tapping
   it opens the belt modal in all states. When `current_mode === 'infplay'`
   the pill changes colour, **throbs**, and shows an **∞ glyph with NO central
   progress line** (`.belt-timer-unified.is-infplay`, plus its
   `[data-theme="mist"]` counterpart — mist overrides every surface). The ∞
   pill is the INDICATOR; the modal's ∞ button is the ACTIVATOR (see 5).

5. **INF PLAY entry/exit.** **Entry is deliberate and explicit.** The primary
   activator is the **glowing/throbbing ∞ button in the belt modal** (a MODE
   activator, visually distinct from the belt dots — `.infplay-activator`,
   with its `:root[data-theme="mist"]` counterpart since the modal teleports
   to `<body>`). It emits `enterInfPlay` → `handleActivateInfPlay()` →
   `enterInfPlay()`. Round-forward past the final LEGO also enters (legacy
   path), and the belt modal picking a belt past content re-enters. All set
   `current_mode='infplay'` and the pill shows ∞. **Exit** = belt-modal jump
   or round-back → loads the main loop, sets `current_mode='main'`. (Tom:
   "not fascist — they can trigger it, they just need to know what they're
   doing"; the ∞ activator reads as "activate infinite play", clearly
   different from "jump to a belt".)

*Owner of this model: methodology (Tom). Engine implementation: the LEGO-id
belt/cursor rework on `dev`.*
