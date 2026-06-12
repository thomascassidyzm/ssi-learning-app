# Atom-Fusion Introduction — design spec

> **Status:** Design agreed (Tom + Claude, 2026-06-12). Not yet built — gated on
> the upstream persistence step (see *Data contract*). This document is the
> contract between the dashboard (Popty) content pipeline and the learning app.

## The problem

On first encounter, a whole clause is too big to parse, and the current
explainer is a single baked clip that walks the breakdown as a wall — the
learner can't practise the parts or build them up. Meaning is "explained" but
not *acquired*.

## The model: introduce by atoms, fuse back to the whole

A clause is broken into **atoms** — the smallest pieces that still mean
something alone (usually one word; glue-words glue into a neighbour, e.g.
`na posao` = "to work"; multi-word atoms only for glue or genuine fixed
expressions; a clause/verb phrase is never one atom). See the explainer-atom
rules in the dashboard generator (commit 67e40842).

Stage one then **meets each atom, then fuses them back together**, one join at a
time, until the learner hears the whole clause as one understood chunk. The
"sticking back together" is literal: we shrink the gaps between atoms tier by
tier until the clause plays unbroken.

Stages 2–9 (the existing `algorithm_config.pods` translation + speed ladder) are
unchanged — Stage one *builds* the phrase; later stages *lock it in*.

## Data contract (Popty → app)

Per `listening_pod_sentences` row, **three audio files + one atom map**:

| Asset | What | Sliced? |
|---|---|---|
| `target_clause` | whole clause, target language (the natural take) | yes — at atom offsets |
| `known_clause` | whole clause, known language (holistic meaning) | no — played whole |
| `explainer` | the per-atom "X means …, Y means …" walk | yes — at atom offsets |

**Atom map** — ordered, one entry per atom:

```jsonc
atoms: [
  {
    "gloss": "you're going",        // known-language text (for the screen)
    "target_start_ms": 0,           // offset into target_clause
    "target_end_ms":   620,
    "explainer_start_ms": 0,        // offset into explainer
    "explainer_end_ms":   1900,
    "is_note": false                // true = job note (e.g. a name), not a teachable atom
  }
]
```

- **Offsets are the only genuinely new data.** The stitcher already knows the
  atom boundaries (it assembled the explainer from the atom pieces) — this is a
  *persistence* step, not new generation.
- Audio should be keyed by text where possible so recurring atoms / clauses
  dedupe and cache across the course (`molim`, `na posao`, … taught once,
  reused everywhere).

### What we deliberately do NOT send

**No per-composite known audio** ("1+2 means…", "1+2+3 means…"). Two reasons:

1. **Pedagogy** — meaning is taught at the *atom tier* (atom target + its
   explainer slice) and capped by the *known clause* at the end. The fusion
   tiers in between are **target-only** — the learner is parsing, not learning
   meaning. So meaning lives at the bottom and the top, never the middle.
2. **Linguistics** — known language reorders against target ("I have fifteen
   years" vs *tengo quince años*), so a target composite has no clean matching
   span in the known clause. Composite glosses would be combinatorial *and*
   wrong.

This cut is what keeps the asset set at exactly three files, forever.

## The Stage-one ladder (app)

Computed from the atom map + a few config knobs. For a clause of N atoms
(example: *Ideš na posao, Maria?* → `[Ideš] [na posao] [Maria]`):

1. **Orientation** — whole `target_clause` once. The destination.
2. **Meet the atoms** — for each teachable atom: target slice → its explainer
   slice → (optionally) target slice again. Screen highlights the atom + shows
   its gloss. Lowest cognitive load: one tiny meaning at a time. A second,
   lighter pass fades the scaffold (target + explainer once, no echo).
3. **Fuse** — adjacent atoms join, **target-only**, the inserted gaps shrinking
   each tier: `[Ideš·na posao]` → `[Ideš·na posao·Maria]`. Screen: the chunks
   visually merge. Overlapping windows (3+4 then 4+5) are allowed — they're just
   a windowing choice, no extra audio.
4. **Arrive** — the whole `target_clause`, untouched, natural speed. The
   `known_clause` caps the holistic meaning. It parses now.

Config knobs (live, like `algorithm_config.pods`):
- **fusion rule** — default **pairwise adjacent merge** (self-scales: gentle for
  short phrases, log-ish for long).
- **scaffold fade** — how fast the explainer drops across the meet-the-atoms passes.
- **gap curve** — the silence lengths per fusion tier, ending at 0 (= the take).
- **anchoring** — re-hear the whole clause per tier, or only orientation + arrive.

Tiers self-scale to atom count: a 2-atom clause collapses to a few steps; a
6-atom clause stretches. Reuses the **per-chunk row engine** already shipped —
atoms are sub-rows that merge; the gap-and-advance machinery already exists.

## Slicing reliability (the key risk — and why it's smaller than it looks)

The offsets must land on atom boundaries in the *target_clause*. The reassuring
part is **how** we use them — precision is only needed where errors are
cosmetic, and the natural-sounding part needs no cutting at all:

- **Fusion tiers (must sound natural):** we do **not** cut and re-concatenate.
  We play the **continuous, untouched clause take** and *insert shrinking
  silences at the boundary offsets*. A slightly-off offset just lands a pause a
  few ms early/late — imperceptible — and at zero insertion it's the original
  take, bit-for-bit. So the high-stakes part is **immune to slice imprecision.**
- **Meet-the-atoms tier (must be intelligible):** here we *do* cut an atom out
  in isolation. But errors are **cosmetic, not semantic** — a clipped edge is
  ugly, not wrong, because meaning is carried by the explainer slice + the
  on-screen gloss, not by perfect audio edges. Apply a few-ms fade + zero-cross
  snap + small pad at cut edges to kill clicks.
- **Glued atoms help** — gluing glue-words into their neighbour means fewer
  internal boundaries, landing on more natural seams than word-level cuts.
- **Final tier is always clean** — it's the whole unsliced take, so the learner
  always ends on perfect audio regardless of slice quality.

**Where the offsets come from** decides upstream effort:
- **TTS clause** → the engine emits word/phoneme timings: exact, free, no
  guesswork. *(Strongly preferred if the clause is synthesised.)*
- **Recorded clause** → forced-align once in the Popty pipeline (reviewable,
  correctable), never on-device.

**QA hook** — reuse the existing admin QA Mode so the content team can audition
slices and flag bad boundaries; offsets are just data and can be corrected
without re-recording.

## Open decisions

1. **Is the target clause TTS or recorded?** (decides the offset source above)
2. **Fusion rule** — confirm pairwise-adjacent as default.
3. **Retire the monolithic explainer?** Once atoms are persisted the app can
   compose the breakdown itself. Lean: keep transitionally, retire once proven.

## Division of labour

- **Popty:** persist the three files + the atom map (offsets + gloss + is_note).
  Key audio by text for cross-course reuse.
- **App:** the Stage-one introduction ladder (computed from the atom map + the
  config knobs), the slice/insert-gap playback, and the visual atom highlight.
  Stages 2–9 untouched.

---

*Last updated: 2026-06-12*
