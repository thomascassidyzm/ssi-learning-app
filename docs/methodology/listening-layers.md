# Listening Layers Methodology

> Source: Aran Jones, 2025-12-03
> Context: Insights from Irish course development on managing long-tail spaced repetition

---

## Core Insight

After Fibonacci decay reaches zero on an item, we don't need active prompts to maintain memory. **Listening exercises on seed sentences are sufficient to reactivate memory.**

This separates listening work into two distinct layers with different purposes.

---

## Layer 1: Concluded Seed Sentences (Reactivation)

**Purpose**: Maintain memory of completed content through passive listening

**Content**: All seed sentences where Fibonacci has decayed (concluded items)

**Behavior**:
- Repeat all concluded seed sentences
- Gradually grows longer over time (natural progression)
- Speed increases on each revisit:

| Revisit | Speed |
|---------|-------|
| 1st     | 1.2x  |
| 2nd     | 1.4x  |
| 3rd     | 1.6x  |
| 4th     | 1.8x  |
| 5th+    | 2.0x  |

**Note**: 2x is the practical ceiling - most impact achieved by then.

**Windowing** (after Layer 2 activates):
- Always include seeds 1-50 (foundation)
- Plus 100 other seeds in rotating blocks:
  - Block A: Seeds 1-50 + 51-150
  - Block B: Seeds 1-50 + 151-250
  - Block C: Seeds 1-50 + 251-350
  - etc.

---

## Layer 2: Conversational Listening (Acquisition)

**Purpose**: Acquire new vocabulary through comprehensible input

**Trigger**: Activates after ~150 seeds completed

**Content**: Natural conversational podcast-style content, broken into sentences

**Key Insight**: Does NOT need to be restricted to known vocabulary. As long as it's comprehensible, exposure to new content aids acquisition.

**Cycle Pattern**:
```
Initial:
  target sentence → known sentence → target sentence → target sentence (2x speed)

Over time, add sentences:
  4x target sentences → known sentence for last 3 → 4x target → 4x target (2x)

After 4th revisit of a target sentence:
  Drop the known sentence match for that item
```

**Progression**: Gradually drops known sentence scaffolding as familiarity increases

**Maximum Length**: TBD - need to analyze examples for optimal parameters

---

## Scheduling

| Phase | Layer 1 | Layer 2 | Listening Frequency |
|-------|---------|---------|---------------------|
| Early (< 150 seeds) | Every hour | Not active | Every hour |
| Later (150+ seeds) | Every hour | Every hour (offset) | Every 30 minutes |

Layer 1 and Layer 2 alternate, providing listening work every 30 minutes once both are active.

---

## Layer 1 Windowing

**Before Layer 2 activates:**
- Layer 1 includes ALL concluded seeds
- Full coverage when it's the only passive mode

**Once Layer 2 activates:**
- Layer 1 scope reduces to 50 + 100 rotating
- Always keeps seeds 1-50 (foundation)
- Rotates through other concluded seeds in blocks of 100

## Text Display (Aran's clarification)

**Default: NO text visuals during listening.**

Showing text removes effort in a way that doesn't help acquisition.

> "Bloody hell, people do like to remove effort and take longer to acquire" — Aran

If text is available at all, it should be:
- Default OFF
- Hidden behind a settings toggle
- Positioned as a "demo/preview" feature, not the main experience

---

## Subject-Specific Listening

- Requires dedicated UI tab (navigation at bottom)
- All subject-specific content uses Layer 2 format
- User-selectable from listening section

---

## App Navigation

When user clicks "Listening" icon:
1. Switches OFF prompts (no active recall)
2. Cycles between Layer 1 and Layer 2 listening
3. "Sweet and easy" - minimal cognitive load for user

---

## Implementation Notes

### For Triple Helix Engine
- Layer 1 listening can use existing seed audio
- Speed adjustment: Web Audio API playbackRate
- Window calculation: Track concluded seeds, apply rotation

### For Content Pipeline
- Layer 2 requires new content type: conversational podcasts
- Need sentence segmentation with known/target pairing
- May need new TTS voices for natural conversation feel

### Parameters to Define
- [ ] Maximum Layer 2 segment length
- [ ] Exact threshold for Layer 2 activation (150 seeds?)
- [ ] Layer 1 window rotation frequency
- [ ] Revisit count for dropping known sentence scaffold

---

## The Deeper Insight: Productive Capacity vs Productive Effort

> "It really became clear because it's all I need now for Irish. I don't really need all that much productive work with new items - I've done a lot of productive work, and I now have a lot of productive capacity - I do not need lots of productive effort with each new item now. That will vary from learner to learner, but the core will be the same. **Wider listening is the key.**"
> — Aran Jones, 2025-12-03

### What This Means

There's a **tipping point** in language learning where:

| Phase | Need | Mode |
|-------|------|------|
| **Early** | Build productive capacity | Heavy prompt/response work |
| **Later** | Maintain + expand | Wider listening becomes primary |

Once you have **productive capacity** (the ability to produce language), you don't need intensive productive **effort** with every new item. Listening exposure becomes sufficient for acquisition.

### Implications for the App

1. **Adaptive Mode Balance**: As learner progresses, shift ratio from prompts → listening
2. **Not One-Size-Fits-All**: "Will vary from learner to learner" - but pattern is universal
3. **Listening is Not Secondary**: It's not just maintenance - it's the primary acquisition channel for advanced learners

### The Learning Journey Arc

```
Early (Seeds 1-50):     [████████████░░] Prompts 80% | Listening 20%
Middle (Seeds 50-150):  [████████░░░░░░] Prompts 60% | Listening 40%
Later (Seeds 150-300):  [████░░░░░░░░░░] Prompts 30% | Listening 70%
Advanced (300+):        [██░░░░░░░░░░░░] Prompts 15% | Listening 85%
```

This isn't just about time efficiency - it reflects how acquisition actually works once the foundation is in place.

---

## Open Questions

1. How do we source/create Layer 2 conversational content?
2. What's the optimal Layer 2 segment length?
3. Should Layer 2 difficulty scale with learner progress?
4. How to handle subject-specific content generation?
5. **How do we detect "productive capacity" tipping point?**
6. **Should prompt/listening ratio be user-adjustable or automatic?**

---

*Last updated: 2025-12-03*
*Status: Design specification - not yet implemented*
