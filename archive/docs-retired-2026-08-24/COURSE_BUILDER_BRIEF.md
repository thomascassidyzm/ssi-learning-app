# SSi Course Builder Brief

## Your Task

Build a language course for [TARGET_LANGUAGE] for [KNOWN_LANGUAGE] speakers.

Create ~260 LEGOs and ~5,000 phrases by working through the 260 seed sentences, using your language knowledge to chunk appropriately.

---

## The SSi Method

### What is a LEGO?

A minimum viable unit of robust meaning that:
- Passes ZUT (Zero Uncertainty Test) - learner hears KNOWN language prompt, has zero uncertainty of TARGET language required
- Works naturally in BOTH languages
- Can connect to other LEGOs

### A-type (Atomic)

Tiles transparently. No special handling needed.

```
speak → 说
Chinese → 中文
today → 今天
```

### M-type (Molecular)

Cannot be inferred from existing LEGOs. Requires components shown at introduction.

Use M-type when:
- Order differs between languages
- Meaning only works as a chunk (e.g., "I want to" = 我想, not "I" + "want" + "to")
- Contains grammatical glue

```
LEGO: I want to → 我想 (M-type)
  COMPONENT: I → 我
  COMPONENT: want to → 想
```

---

## How to Build

For each seed:

1. Translate naturally into target language
2. Identify chunks that pass ZUT
3. Check existing LEGOs - reuse if possible
4. Add new LEGOs as needed (mark A or M type)
5. Generate phrases - combinations with previously introduced LEGOs

### Phrase Rules

- Only use LEGOs already introduced
- Must be natural in BOTH languages
- ~10 phrases per LEGO basket (don't agonise over exact count)
- ~20 syllables max per phrase
- Prioritize recent LEGOs

### Sorting (automatic)

Phrases are sorted by syllable count:
- **Shortest 7** → DEBUT phrases (introduction)
- **Longest 5** → ETERNAL phrases (spaced repetition)

Early baskets won't have enough for 7+5, that's fine.

---

## Seeds

Seeds are a GUIDE. Each language pair can:
- Simplify if the target language needs it
- Reorder if it makes more sense
- Adapt while keeping the spirit

```
1. I want to speak [LANGUAGE] with you now.
2. I'm trying to learn.
3. how to speak as often as possible
4. how to say something in [LANGUAGE]
5. I'm going to practise speaking with someone else.
6. I'm trying to remember a word.
7. I want to try as hard as I can today.
8. I'm going to try to explain what I mean.
9. I speak a little [LANGUAGE] now.
10. I'm not sure if I can remember the whole sentence.
...
[260 seeds total - query: SELECT * FROM course_seeds WHERE course_code = 'spa_for_eng' ORDER BY seed_number]
```

---

## Database Schema

### Table: course_legos

| Column | Value |
|--------|-------|
| course_code | e.g., 'ita_for_eng' |
| seed_number | 1-260 |
| lego_index | 1-N within seed |
| type | 'A' or 'M' |
| is_new | true (first occurrence) or false (reuse) |
| known_text | Known language |
| target_text | Target language |
| components | JSON array for M-types, null for A-types |
| status | 'draft' |

### Table: course_practice_phrases

| Column | Value |
|--------|-------|
| course_code | e.g., 'ita_for_eng' |
| seed_number | 1-260 |
| lego_index | 1-N within seed |
| position | 1-N within basket |
| known_text | Known language |
| target_text | Target language |
| lego_count | Number of LEGOs in phrase |
| status | 'draft' |

---

## Database Writes

Write directly to Supabase:

```javascript
// Insert LEGO
await supabase.from('course_legos').insert({
  course_code: 'ita_for_eng',
  seed_number: 1,
  lego_index: 1,
  type: 'M',
  is_new: true,
  known_text: 'I want to',
  target_text: 'voglio',
  components: [
    {known: 'I', target: 'io'},
    {known: 'want to', target: 'voglio'}
  ],
  status: 'draft'
})

// Insert phrases (batch)
await supabase.from('course_practice_phrases').insert([
  {course_code: 'ita_for_eng', seed_number: 1, lego_index: 1, position: 1, known_text: 'I want to', target_text: 'voglio', lego_count: 1, status: 'draft'},
  {course_code: 'ita_for_eng', seed_number: 1, lego_index: 1, position: 2, known_text: 'I want to speak', target_text: 'voglio parlare', lego_count: 2, status: 'draft'}
])
```

Connection:
```javascript
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
```

---

## Quality Bar

1. Natural known language
2. Natural target language
3. ZUT passes - learner hears known, zero uncertainty of target required
4. Phrases only use introduced LEGOs
5. Word order correct for target language

---

## Example: First 5 LEGOs for Italian

**L01: voglio (I want to)** - M-type
- Components: io (I), voglio (want to)
- Phrases: voglio

**L02: parlare (to speak)** - A-type
- Phrases: parlare, voglio parlare

**L03: italiano (Italian)** - A-type
- Phrases: italiano, parlare italiano, voglio parlare italiano

**L04: con te (with you)** - M-type
- Components: con (with), te (you)
- Phrases: con te, parlare con te, parlare italiano con te, voglio parlare con te, voglio parlare italiano con te

**L05: adesso (now)** - A-type
- Phrases: adesso, parlare adesso, parlare italiano adesso, voglio parlare adesso, voglio parlare italiano adesso, voglio parlare con te adesso, voglio parlare italiano con te adesso

---

## Go

Work through seeds 1-260. For each:
1. What new LEGOs needed?
2. A or M type?
3. What phrases can now be made?
4. POST to API.
