# Phrase Role and Coverage Schema

**Date:** 2026-01-18
**Status:** Migration ready, pending Dashboard implementation

## Overview

This document describes new columns added to `course_practice_phrases` to enable:

1. **Explicit phrase categorization** - instead of deriving category from position
2. **Coverage-based selection** - selecting eternal/rep phrases for variety, not just length

## New Columns

### `phrase_role` (TEXT, NOT NULL, DEFAULT 'practice')

Explicit category for the phrase:

| Value | Description | When Used |
|-------|-------------|-----------|
| `component` | Parts of M-type LEGOs | Shown during LEGO introduction to demonstrate internal structure |
| `practice` | Build-up phrases | Used during debut sequence, ordered by syllable count (simple → complex) |
| `eternal_eligible` | Consolidation phrases | Eligible for end-of-round consolidation and spaced repetition reviews |

**Constraints:** Must be one of: `component`, `practice`, `eternal_eligible`

### `connected_lego_ids` (TEXT[], DEFAULT '{}')

Array of LEGO IDs that appear in this phrase alongside the primary LEGO.

**Example:** For phrase "now I want to speak Chinese" under LEGO S0001L05 ("now"):
```
connected_lego_ids: ['S0001L01', 'S0001L02', 'S0001L03']
                     (I want)    (to speak)  (Chinese)
```

**Purpose:** When selecting eternal/rep phrases, ensure variety by picking phrases that connect with *different* partner LEGOs, not always the same ones.

**Computation:** At course creation time, check which other LEGOs' `target_text` appears within this phrase's `target_text`.

### `lego_position` (TEXT, NULLABLE)

Where the primary LEGO appears in the target language phrase.

| Value | Description |
|-------|-------------|
| `start` | LEGO appears at the beginning |
| `middle` | LEGO appears in the middle |
| `end` | LEGO appears at the end |

**Example:**
- "speak now" → 现在说 → `lego_position: 'start'` (现在 is first)
- "now I want" → 我现在想 → `lego_position: 'middle'`

**Purpose:** Ensure variety in how the LEGO is presented - don't always show it at the start.

**Computation:** At course creation time, find the position of the primary LEGO's `target_text` within the phrase's `target_text`.

## Selection Algorithms

### Debut Sequence (Introduction)

```
1. Get phrases with phrase_role IN ('component', 'practice') for this LEGO
2. Order by:
   - Components first (phrase_role = 'component')
   - Then by target_syllable_count ASC (simple → complex)
   - Then by position ASC (tiebreaker)
3. Play through in order
```

### Eternal/Rep Selection (Spaced Repetition)

```
1. Get phrases with phrase_role = 'eternal_eligible' for this LEGO
2. Filter: target_syllable_count >= minimum threshold (if applicable)
3. Score each phrase for coverage:
   - Bonus for connected_lego_ids not recently seen
   - Bonus for lego_position variety (if recent phrases were all 'start', prefer 'middle' or 'end')
4. Select top N with best coverage scores
```

## Migration Notes

### Backfill Logic

The migration includes a backfill that sets `phrase_role` based on existing `position` values:
- `position = 0` → `phrase_role = 'component'`
- `position >= 8` → `phrase_role = 'eternal_eligible'`
- All others → `phrase_role = 'practice'`

This preserves current behavior while enabling explicit assignment going forward.

### Dashboard Requirements

The Dashboard needs to be updated to populate:

1. **`phrase_role`** - Can be rules-based:
   - If position 0 → 'component'
   - If syllable_count >= threshold → 'eternal_eligible'
   - Otherwise → 'practice'

2. **`connected_lego_ids`** - Computed by analyzing which LEGOs appear in the phrase

3. **`lego_position`** - Computed by finding LEGO position in target_text

### Existing Column: `target_syllable_count`

This column already exists and should continue to be populated. It's used for:
- Ordering practice phrases (low → high complexity)
- Minimum threshold for eternal eligibility

## Backwards Compatibility

- The `position` column remains and is still used for ordering within roles
- The `phrase_type` computed field in `practice_cycles` view is preserved for backwards compatibility
- Existing queries using `position` will continue to work

## Future Considerations

The `metadata` JSONB column remains available for experimental qualities:
- Semantic tags (question, statement, request)
- Frequency tiers
- Context requirements
- A/B testing variants

Core selection uses the explicit columns; experiments can use metadata without schema changes.
