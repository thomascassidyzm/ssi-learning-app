# Backlog - Ideas & Fixes for Later

Items to address later, including cross-repo concerns (Popty/Dashboard).

---

## Popty / Dashboard Changes

### 1. Smarter Introduction Context
**Date:** 2026-01-19
**Context:** Discussing learning UX with Aaron

Currently, introductions use the full seed sentence pattern ("say the Japanese for: I want to speak Japanese") for all LEGOs.

**Proposal:** Only use the seed sentence context when the LEGO is short (1-2 words). For longer phrases/whole sentences, the LEGO itself provides enough context - skip the seed framing.

**Why:**
- Short word: "speak" → needs context → "say the Japanese for: I want to speak Japanese"
- Full phrase: "I want to speak Japanese" → self-explanatory → just introduce directly

**Action:** Modify introduction generation logic in Popty to check LEGO length/word count and conditionally include seed context.

---

## Learning App Changes

*(Add items here)*

---

## UX Ideas to Explore

### Persistent Navigation in Player
**Date:** 2026-01-19
**Status:** Discussing - Chesterton's fence

Consider showing main nav bar during learning sessions for consistency. Would need to move transport controls up. Possible middle grounds: fade in on pause, minimal icons only, swipe to reveal.

---
