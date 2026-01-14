# Portuguese for English Speakers - Course Build Summary

## Overview

| Metric | Value |
|--------|-------|
| Course Code | `por_for_eng` |
| Known Language | English |
| Target Language | Portuguese |
| Seeds | 30 |
| LEGOs | 92 |
| Phrases | 648 |
| Avg Phrases/LEGO | 7.0 |

## LEGO Types

| Type | Count | Description |
|------|-------|-------------|
| A-type (Atomic) | 37 | Single words that tile transparently |
| M-type (Molecular) | 55 | Multi-word phrases with components shown |

## Validation Status

All LEGOs pass the minimum gate requirements:

| Gate | Requirement | Status |
|------|-------------|--------|
| Vocab violations | Phrases only use introduced vocabulary | ✅ PASS (0 violations) |
| Min phrases | ≥7 phrases per LEGO (after seed 5) | ✅ PASS (84/84 LEGOs) |
| Target phrases | ≥10 phrases per LEGO | ⚠️ 2 LEGOs meet target |

## ETERNAL Readiness

For spaced repetition review, ETERNAL phrases must be 10+ syllables:

| Status | Count | Notes |
|--------|-------|-------|
| Ready (5+ long phrases) | 7 LEGOs | Have sufficient ETERNAL content |
| Need enrichment | 70 LEGOs | Need more 10+ syllable phrases |
| Zero long phrases | 20 LEGOs | Priority for enrichment |

## Database Schema

### Table: `course_legos`

```
course_code: 'por_for_eng'
seed_number: 1-30
lego_index: 1-N within seed
type: 'A' or 'M'
is_new: true (first occurrence) or false (reuse)
known_text: English prompt
target_text: Portuguese response
components: JSON array for M-types (null for A-types)
status: 'draft'
```

### Table: `course_practice_phrases`

```
course_code: 'por_for_eng'
seed_number: 1-30
lego_index: 1-N within seed
position: 1-N within basket
known_text: English prompt
target_text: Portuguese response
word_count: Number of words
lego_count: Number of LEGOs used
status: 'draft'
```

## Key Principles Applied

### 1. ZUT (Zero Uncertainty Test)
Every phrase passes ZUT - learner hears English prompt, has zero uncertainty of Portuguese required.

### 2. Recency
Phrases prioritize recently introduced vocabulary. For LEGO X in seed Y:
- Can use: All vocabulary from seeds 1 to Y-1
- Can use: LEGOs 1 to X-1 from seed Y (earlier in same seed)
- Can use: LEGO X's own words/components
- Cannot use: Later LEGOs from same seed

### 3. Phrase Distribution
- **DEBUT**: Shortest phrases first (building up during introduction)
- **ETERNAL**: All 10+ syllables (cognitive challenge during review)

### 4. Natural Language
All phrases are natural in BOTH English and Portuguese - not mechanical concatenations.

## Sample LEGO Structure

```
S27L4: responder (to answer) - A-type

DEBUT phrases (introduction):
  [3 syl]  responder
  [8 syl]  responder rapidamente
  [9 syl]  você vai responder em breve
  [10 syl] estou quase pronto a responder

ETERNAL phrases (spaced rep):
  [12 syl] não quero demorar muito a responder
  [13 syl] não gosto de demorar muito a responder
  [15 syl] não gosto de demorar muito a responder você
```

## Files

| File | Description |
|------|-------------|
| `docs/por_for_eng_course_export.json` | Full course data export |
| `scripts/validate-course-gates.mjs` | Validation script |

## Work Remaining

1. **Add ETERNAL phrases**: Most LEGOs need 10+ syllable phrases
2. **Increase phrase count**: Target 10 phrases per LEGO
3. **Extend to 260 seeds**: Current build is 30 seeds (proof of concept)

## Supabase Connection

```javascript
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://swfvymspfxmnfhevgdkg.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Query LEGOs
const { data: legos } = await supabase
  .from('course_legos')
  .select('*')
  .eq('course_code', 'por_for_eng')
  .order('seed_number')
  .order('lego_index')

// Query phrases
const { data: phrases } = await supabase
  .from('course_practice_phrases')
  .select('*')
  .eq('course_code', 'por_for_eng')
```

## Validation Script Usage

```bash
node scripts/validate-course-gates.mjs por_for_eng
```

Gates checked:
- Vocab violations (phrases using unintroduced words)
- Minimum phrase count (7 per LEGO after seed 5)
- Target phrase count (10 per LEGO)
- Long phrase availability (10+ syllables for ETERNAL)
