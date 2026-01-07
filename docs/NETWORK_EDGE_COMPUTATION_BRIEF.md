# Brief: Phrase-Based Distinction Network Edge Computation

## Context

We're building a visualization of a learner's "distinction network" - showing how LEGOs (language building blocks) connect based on co-occurrence in practice phrases. This should reflect actual neural wiring from "fire together, wire together" principles of distinction physics.

The network shape should be a **property of the COURSE**, not the learner. It represents the linguistic structure of the language pair. Different learners traverse the same network at different speeds.

## The Problem: Valid Paths vs False Connections

Simple word co-occurrence creates FALSE connections. Consider English examples:

```
"turn left"     → turn + left (valid - direction instruction)
"it's your turn" → uses "turn" but NOT the same concept
"left over"      → uses "left" but NOT the same concept
```

If we naively connect "turn" ↔ "left" because they appear together, we'd wrongly strengthen that connection when the learner practices "it's your turn" or "left over".

**We need VALID PATHS** - decomposition into actual LEGO components, not just word matching.

---

## Real Data: Spanish for English (Seeds S0001-S0010)

### LEGOs Introduced (in order)

```
S0001: "Quiero hablar español contigo ahora" (I want to speak Spanish with you now)
  - S0001L01: "Quiero" (I want)
  - S0001L02: "hablar" (to speak)
  - S0001L03: "español" (Spanish)
  - S0001L04: "contigo" (with you)
  - S0001L05: "ahora" (now)

S0002: "Estoy intentando aprender" (I'm trying to learn)
  - S0002L01: "Estoy intentando" (I'm trying)
  - S0002L02: "aprender" (to learn)

S0003: "cómo hablar lo más frecuentemente posible" (how to speak as often as possible)
  - S0003L01: "cómo" (how)
  - S0003L02: "hablar" (to speak)  ← REUSES S0001L02's concept!
  - S0003L03: "lo más frecuentemente posible" (as often as possible) [M-LEGO with components]

S0004: "cómo hablar algo en español" (how to say something in Spanish)
  - S0004L01: "cómo" (how)  ← SAME as S0003L01?
  - S0004L02: "hablar algo" (to say something)  ← Different from "hablar" alone!
  - S0004L03: "en" (in)
  - S0004L04: "español" (Spanish)  ← REUSES concept from S0001L03

S0005: "Voy a practicar hablar con alguien más" (I'm going to practise speaking with someone else)
  - S0005L01: "Voy a" (I'm going to)
  - S0005L02: "practicar" (practise)
  - S0005L03: "hablar" (speaking)  ← Same root as S0001L02, S0003L02?
  - S0005L04: "con" (with)
  - S0005L05: "alguien más" (someone else)

S0006: "Estoy intentando recordar una palabra" (I'm trying to remember a word)
  - S0006L01: "Estoy intentando" (I'm trying)  ← SAME as S0002L01
  - S0006L02: "recordar" (to remember)
  - S0006L03: "una palabra" (a word)

S0007: "Quiero intentar tan duro como pueda hoy" (I want to try as hard as I can today)
  - S0007L01: "Quiero" (I want)  ← SAME as S0001L01
  - S0007L02: "intentar" (to try)
  - S0007L03: "tan duro como pueda" (as hard as I can) [M-LEGO]
  - S0007L04: "hoy" (today)

S0008: "Voy a intentar explicar lo que quiero decir" (I'm going to try to explain what I mean)
  - S0008L01: "Voy a" (I'm going to)  ← SAME as S0005L01
  - S0008L02: "intentar" (try)  ← SAME as S0007L02
  - S0008L03: "explicar" (to explain)
  - S0008L04: "lo que quiero decir" (what I mean)  ← Contains "quiero"!

S0009: "Hablo un poco de español ahora" (I speak a little Spanish now)
  - S0009L01: "Hablo" (I speak)  ← Related to "hablar"?
  - S0009L02: "un poco de" (a little)
  - S0009L03: "español" (Spanish)  ← SAME concept as S0001L03, S0004L04
  - S0009L04: "ahora" (now)  ← SAME as S0001L05

S0010: "No estoy seguro si puedo recordar toda la oración" (I'm not sure if I can remember the whole sentence)
  - S0010L01: "No estoy seguro" (I'm not sure)
  - S0010L02: "si" (if)
  - S0010L03: "puedo" (I can)  ← Related to "como pueda" in S0007L03?
  - S0010L04: "recordar" (remember)  ← SAME as S0006L02
  - S0010L05: "toda la oración" (the whole sentence)
```

### Practice Phrase Example (S0030L01 basket)

When practicing "Quería" (I wanted), the learner encounters:

```
Practice phrases:
  - "Quería hablar español" (I wanted to speak Spanish)
  - "Quería aprender ahora" (I wanted to learn now)
  - "Quería intentar hoy" (I wanted to try today)

Decomposition levels:
  Level 2: "Quería hablar", "Quería aprender", "Quería intentar"
  Level 3: "Quería hablar español", "Quería aprender ahora", "Quería intentar hoy"
```

**Key insight**: These practice phrases CREATE VALID EDGES:
- Quería ↔ hablar (fired together)
- Quería ↔ aprender (fired together)
- Quería ↔ español (fired together)
- hablar ↔ español (fired together, reinforcing S0001's connection)

---

## The Decomposition Challenge

### Exact Matches (Clear Cases)
- S0006L02 "recordar" and S0010L04 "recordar" → SAME LEGO
- S0001L01 "Quiero" and S0007L01 "Quiero" → SAME LEGO
- S0001L03 "español" and S0009L03 "español" → SAME LEGO

### Partial/Ambiguous Matches (Hard Cases)
- S0001L02 "hablar" vs S0003L02 "hablar" vs S0004L02 "hablar algo" vs S0005L03 "hablar"
  - Are these the SAME distinction or DIFFERENT?
  - "hablar algo" (say something) has different semantics than "hablar" (speak)

- S0009L01 "Hablo" vs S0001L02 "hablar"
  - Same verb root, different conjugation
  - Should these be connected? How strongly?

- S0008L04 "lo que quiero decir" contains "quiero"
  - Should this create an edge to S0001L01 "Quiero"?
  - It's embedded in a larger chunk, not standalone

- S0007L03 "tan duro como pueda" vs S0010L03 "puedo"
  - "pueda" (subjunctive) and "puedo" (indicative) - same root
  - The learner IS building a "poder" distinction
  - But one is embedded in an M-LEGO

### M-LEGO (Molecular) Complications
- S0003L03 "lo más frecuentemente posible" has components: "lo más", "frecuentemente", "posible"
- Should edges be created to the M-LEGO? To its components? Both?

---

## Questions for Agent Exploration

1. **Decomposition Algorithm**
   - How do we cleanly decompose a practice phrase into its LEGO components?
   - Exact string matching? Fuzzy matching? Lemmatization?
   - How do we handle conjugation variations (hablar/hablo/habla)?

2. **Edge Creation Rules**
   - When should an edge be created between two LEGOs?
   - Only when they appear in the SAME practice phrase?
   - What about M-LEGO components?

3. **Edge Strength Calculation**
   - How do we weight edge strength?
   - Count of co-occurrences in practice phrases?
   - Recency? Spaced repetition schedule position?

4. **Resonance vs Exact**
   - Exact match: LEGOs that are literal components of the phrase
   - Resonance: LEGOs with morphological/semantic similarity
   - How bright should each be? What's the falloff?

5. **The "Valid Path" Problem**
   - How do we ensure we only create edges for VALID linguistic connections?
   - How do we avoid the "turn left" / "it's your turn" false connection problem?

---

## Deliverable

Propose an algorithm/approach for computing edges from practice phrases that:
1. Creates VALID edges based on true LEGO co-occurrence
2. Handles exact vs partial matches appropriately
3. Weights edge strength meaningfully
4. Considers M-LEGO decomposition
5. Can be pre-computed for a course and stored in the database

The network should look organic (like the brain view reference images), not sequential/ring-like.

---

## PRIORITY: Welsh North Course Data (Real CCF Format)

Welsh is the **priority language** and uses an older but well-structured format that shows how edges should work. The CCF format explicitly defines "builts" (practice phrases) for each LEGO.

### Welsh Course Structure (CCF Format)

```
seed [6F227950-...] "I want to speak Welsh".en / "dw i isio siarad Cymraeg".cy
[
    "".en[] -> "dw".cy[0],
    "I".en[0] -> "i".cy[1],
    "want".en[1] -> "isio".cy[2],
    "speak".en[3] -> "siarad".cy[3],
    "Welsh".en[4] -> "Cymraeg".cy[4]
]

introduced[71A29CD1-...]:
    "I want".en / "dw i isio".cy
    builts:
    [
        "I want to speak".en / "dw i isio siarad".cy
        "I want to learn".en / "dw i isio dysgu".cy
        "I want to try".en / "dw i isio trio".cy
        "I want to practice".en / "dw i isio ymarfer".cy
        "I want to remember".en / "dw i isio cofio".cy
    ]
```

**Key insight**: The `builts` list explicitly defines which LEGOs fire together!

### Edge Creation from Builts

For LEGO "dw i isio" (I want), the builts create these edges:
```
dw i isio ↔ siarad    (fired in "dw i isio siarad")
dw i isio ↔ dysgu     (fired in "dw i isio dysgu")
dw i isio ↔ trio      (fired in "dw i isio trio")
dw i isio ↔ ymarfer   (fired in "dw i isio ymarfer")
dw i isio ↔ cofio     (fired in "dw i isio cofio")
```

And transitively when builts are longer:
```
"dw i isio trio dysgu Cymraeg" creates:
  dw i isio ↔ trio
  dw i isio ↔ dysgu
  dw i isio ↔ Cymraeg
  trio ↔ dysgu
  trio ↔ Cymraeg
  dysgu ↔ Cymraeg
```

### Welsh Mutations: The "auxes" Field

Welsh has soft mutations that change word beginnings. The CCF format tracks these:

```
introduced[...]:
    "to try".en / "trio".cy
    auxes:
    [
        "try".en ~=~ "drio".cy    ← Soft mutation after "i"
    ]

introduced[...]:
    "to remember".en / "cofio".cy
    auxes:
    [
        "remember".en ~=~ "gofio".cy    ← Soft mutation
    ]

introduced[...]:
    "to learn".en / "dysgu".cy
    → becomes "ddysgu" after "i" (seen in practice: "mynd i ddysgu")
```

**Mutations are the SAME distinction**, not different nodes:
- `trio` and `drio` = same node
- `cofio` and `gofio` = same node
- `dysgu` and `ddysgu` = same node

### Word Alignment Data

Each phrase has word-by-word alignment showing exact decomposition:

```
"I'm going to learn".en / "dw i'n mynd i ddysgu".cy
[
    "I'm".en[0,1] -> "dw i".cy[0,1],
    "".en[] -> "'n".cy[2],          ← Welsh particle, no English equivalent
    "going".en[2] -> "mynd".cy[3],
    "".en[] -> "i".cy[4],           ← Welsh preposition, no English equivalent
    "learn".en[4] -> "ddysgu".cy[5], ← Note: "ddysgu" not "dysgu" (mutated)
    "to".en[3] -> "".cy[]           ← English "to" has no Welsh equivalent
]
```

This alignment enables **exact decomposition** - no guessing which LEGOs are in a phrase.

---

## Critical Design Principle: NO GRAMMAR, NO LEMMATIZATION

SSi methodology has **ZERO grammar explanations, ZERO rules**. Learning happens through massive pattern exposure. The "rules" are post-hoc constructs.

Therefore:
- **Do NOT lemmatize** (don't treat "hablar/hablo/habla" as the same)
- **Do NOT apply grammar rules** (don't infer conjugation patterns)
- **DO treat different surface forms as different distinctions** initially
- **DO let the network emerge** from actual practice phrase co-occurrence

If "hablo" and "hablar" should be connected, that connection will emerge naturally from them appearing in the same practice phrases, not from morphological analysis.

---

## Final Algorithm: Greedy Left-to-Right Matching

### Why Greedy?
The brain UPCHUNKS LEGOs that go together. "ymarfer siarad" (to practice speaking) is its OWN distinction - not "ymarfer" + "siarad" firing separately. The upchunked LEGO is what fires.

### Decomposition Algorithm
```
For each practice phrase:
  position = 0
  matched_legos = []

  while position < len(phrase_tokens):
    # Try longest LEGO first (greedy)
    for lego in legos_sorted_by_length_desc:
      if phrase[position:].startswith(lego.target_text):
        matched_legos.append(lego.id)
        position += len(lego.target_text.split())
        break
    else:
      position += 1  # No match, skip token

  # Create edges between all pairs
  for i, lego_a in enumerate(matched_legos):
    for lego_b in matched_legos[i+1:]:
      edges[canonical(lego_a, lego_b)] += 1
```

### Mutation Handling: Pragmatic Approach
- Handle during course creation in dashboard, NOT at runtime
- Simple normalization: lowercase, strip common mutations (dd→d, etc.)
- 95% accuracy is fine - this is for dramatic visualization, not linguistic perfection
- "Languages are not maths" - approximate is good enough

### Pre-compute Once, Read Many
- **Dashboard (Phase 3.5)**: Compute all edges after basket generation
- **Database**: Store in `course_lego_edges` table
- **Player**: Just load and display - no linguistic processing

```sql
CREATE TABLE course_lego_edges (
  course_code TEXT,
  lego_a_id TEXT,  -- canonical ordering: a < b
  lego_b_id TEXT,
  strength INTEGER,  -- co-occurrence count
  PRIMARY KEY (course_code, lego_a_id, lego_b_id)
);
```

### Data Source (Supabase)
Welsh North course: `cym_n_for_eng`
- 305 seeds
- 635 LEGOs
- 5,797 practice phrases
- Tables: `course_seeds`, `course_legos`, `course_practice_phrases`

---

## Reference

- Distinction Physics: https://distinction-physics.vercel.app/treatise/module-4
- "Fire together, wire together" - edges represent energy-efficient pathways
- Hierarchical chunking - M-LEGOs as higher-order distinctions
- The visualization should model actual neural organization
- Welsh CCF source: `/Users/tomcassidy/Downloads/welsh-for-english-north.ccf.txt`
