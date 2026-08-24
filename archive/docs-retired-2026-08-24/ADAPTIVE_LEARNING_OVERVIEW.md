# The Adaptive Learning App

*A brief overview for SSi leadership*

---

## What We're Building

An app that watches how each learner responds and adjusts itself to help them learn better. Not a one-size-fits-all player, but a system that becomes personal to each learner.

The SSi method already works brilliantly. What we're adding is the ability for the app to **notice** and **respond** - like a good tutor would, but at scale.

---

## The Core Insight

**Every learner has their own rhythm.**

Some people process quickly. Others need more time. Some are consistent; others vary. None of these are better or worse - they're just different.

Traditional apps ignore this. They give everyone the same pause length, the same timing, the same experience. That's a missed opportunity.

Our app learns each person's rhythm, then adapts to match it.

---

## Two Levels of Adaptation

### Level 1: "What kind of learner are you?"

In the first session, the app observes the learner's natural pace:
- How quickly do they typically respond?
- How consistent are they?

Based on this, we adjust the **baseline experience**:
- Fast learners get shorter pauses (they don't need to wait)
- Slower learners get longer pauses (they need the processing time)
- Consistent learners trigger on small hesitations (something's wrong)
- Variable learners need bigger signals before we intervene

This happens once, early on, then refines slowly over time.

### Level 2: "How is this moment different?"

Every single response, the app asks: "Was that different from their usual pattern?"

If someone who normally responds in 2 seconds suddenly takes 5 seconds - that's a signal. Not a failure, a **signal**. Something about that phrase was harder.

When we detect these moments, we can:
- Give them more time on similar material
- Bring that phrase back sooner
- Extend the pause slightly for the next few items

This happens continuously, responding to the learner in real-time.

---

## The Four Stages of Mastery

Each phrase moves through four stages:

| Stage | What It Means | How Often They See It |
|-------|---------------|----------------------|
| **Acquisition** | Learning it | Every rotation |
| **Consolidating** | Getting it | Every few rotations |
| **Confident** | Know it well | Occasionally |
| **Mastered** | It's theirs | Light maintenance |

The app tracks where each phrase is for each learner. New material gets intensive focus. Familiar material gets lighter touch.

Crucially: if someone struggles with a "confident" phrase, it can move back to "consolidating". The system responds to reality, not assumptions.

---

## What This Means for Learners

**For the fast learner:** The app doesn't make them wait. Pauses are shorter, the experience is snappier. They're not held back.

**For the slower learner:** The app gives them space. Pauses are longer, there's no rush. They're not overwhelmed.

**For everyone:** When they struggle, the app notices and helps. When they're flying, the app keeps pace. The experience feels personal because it *is* personal.

---

## What This Means for SSi

**The method stays the same.** The prompt-pause-voice cycle, the spaced repetition, the interleaving - all of that is preserved exactly as designed.

**The delivery becomes intelligent.** Instead of rigid timing, the timing breathes with the learner. Instead of fixed schedules, the schedule responds to actual performance.

**Scale without sacrifice.** A human tutor adapts naturally. Now the app can too - for every learner, automatically.

---

## Privacy

One thing worth noting: the app can optionally listen for whether the learner is speaking during the pause (not *what* they're saying, just *that* they're participating).

This happens entirely in the browser. No audio is ever sent to servers or stored anywhere. We can tell if someone's engaged without any surveillance.

---

## Where We Are Now

| Component | Status |
|-----------|--------|
| Core learning engine | Built and tested |
| Struggle detection | Working |
| Mastery tracking | Working |
| Smart phrase selection | Working |
| Pause adjustment | Working |
| Voice activity detection | Working |
| Learner tempo profiling | Designed, ready to build |

The foundations are solid. 589 automated tests verify everything works correctly.

---

## What's Next

1. **Connect to the player** - Wire these systems into the actual learning experience
2. **Build tempo profiling** - Implement the "what kind of learner" assessment
3. **Observe and tune** - Watch real learners, adjust the parameters

The parameters themselves are all configurable. We can tune thresholds, adjust sensitivities, experiment with timing - all without rebuilding anything. The system is designed for iteration.

---

## The Philosophy

This isn't about making the app "smarter" for its own sake. It's about honouring what we already know: **learning is personal**.

The SSi method works because it respects how memory and language acquisition actually function. This adaptive layer respects how *individuals* actually function.

Same method. Personal delivery. Better outcomes.

---

*December 2025*
