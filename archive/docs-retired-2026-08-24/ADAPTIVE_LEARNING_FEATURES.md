# Adaptive Learning Features

*A plain-language guide to what makes SSi's learning app intelligent*

---

## The Big Picture

Traditional language learning apps treat everyone the same. SSi doesn't. Our app watches how *you* learn and adjusts itself to help *you* learn better.

Think of it like a patient tutor who notices when you're struggling and slows down, or when you're flying through material and speeds up. Except our tutor never gets tired, never judges, and remembers everything about your learning patterns.

---

## What We're Building

### 1. Learner Tempo Profile (Global Adaptation)

**What it does:** In your first session, we observe your natural learning pace. Are you a quick processor or do you need more time? Are you consistent or variable?

**Why it matters:** A naturally fast learner who responds in 1.5 seconds needs different timing than someone who takes 4 seconds. Both are perfectly valid ways to learn - but the app should match YOUR tempo.

**What we adjust:**
- Pause duration (shorter for fast learners, longer for slow)
- Sensitivity to struggles (tighter for consistent learners, looser for variable)
- Transition timing between phases

**In plain English:** We figure out your natural pace, then adjust the whole app to match it. Fast learners get a faster experience. Thoughtful learners get more breathing room.

---

### 2. Personal Pattern Detection (Moment-by-Moment)

**What it does:** Watches your response times to understand YOUR normal pace, moment to moment.

**Why it matters:** A "slow" response isn't based on some universal standard. If you normally respond in 2 seconds but suddenly take 4, that's significant. If someone else normally takes 3 seconds and responds in 4, that's less of a change. We measure YOUR patterns, not abstract ideals.

**In plain English:** The app learns your rhythm. When something disrupts that rhythm, we pay attention.

**How this differs from Tempo Profile:** The tempo profile is your overall pace (established early, changes slowly). Pattern detection is moment-to-moment variation (what's happening right now compared to your baseline).

---

### 3. Struggle Detection (without judgment)

**What it does:** Notices when you hesitate, stumble, or seem less confident than usual.

**Why it matters:** Hesitation is a signal, not a failure. It tells us this phrase might need more practice. Instead of just moving on, we can:
- Give you more time on similar phrases
- Bring this phrase back sooner in the rotation
- Break down complex phrases into simpler parts

**In plain English:** When you struggle, we notice. Then we help. No red marks, no "wrong" sounds. Just gentle adjustment.

---

### 4. Mastery Tracking (the journey to fluency)

**What it does:** Tracks each phrase through four stages:

1. **Acquisition** - You're learning it (practice it often)
2. **Consolidating** - You're getting it (practice it regularly)
3. **Confident** - You've got it (practice occasionally)
4. **Mastered** - It's yours (light maintenance)

**Why it matters:** New phrases need lots of attention. Phrases you know well don't need constant drilling. We spend your practice time where it helps most.

**In plain English:** Fresh material gets intensive focus. Familiar material gets lighter touch. Your time is precious.

---

### 5. Smart Selection (what to practice next)

**What it does:** When choosing what to show you next, we consider:

- **Freshness** - How long since you practiced this?
- **Difficulty** - Did you struggle with it before?
- **Variety** - Have you seen this recently? (no hammering one phrase)

**Why it matters:** Not all phrases need equal attention. Struggling phrases get more practice. Phrases you haven't seen in a while get prioritized. Phrases you just practiced can rest.

**In plain English:** We pick your next challenge thoughtfully, like a good tutor would.

---

### 6. Pause Adjustment

**What it does:** When you're struggling, we extend the pause between hearing a phrase and responding.

**Why it matters:** Struggle often means "I need more processing time." Instead of rushing you, we give you space. This is automatic and temporary - once you're flowing again, pauses return to normal.

**In plain English:** When things get hard, we slow down. When you're in flow, we keep pace.

---

### 7. Voice Detection (knowing you're there)

**What it does:** Listens for your voice during the pause to know if you're actively practicing.

**Why it matters:** If you're silent during multiple pauses, something might be wrong - maybe you're confused, or the microphone isn't working, or you're distracted. This lets the app notice and potentially help.

**In plain English:** We can tell if you're speaking (not *what* you're saying - just that you're participating).

---

## What We DON'T Do

### No Grading
We don't mark you right or wrong. We notice patterns.

### No Universal Standards
We don't compare you to other learners. Only to yourself.

### No Punishment
Struggle triggers help, not penalties.

### No Surveillance
Voice detection happens in your browser. Nothing goes to servers. Your voice stays private.

---

## The Philosophy Behind It

SSi's approach comes from a simple insight: **learning is personal**.

What trips up one person is easy for another. What takes you a week might take someone else a day, or a month. This isn't good or bad - it just is.

Traditional apps pretend everyone learns the same way at the same pace. They're wrong.

Our app watches *you*, learns *your* patterns, and adapts to *your* needs. It's like having a tutor who knows you well, remembers everything, and never has a bad day.

---

## Technical Implementation

For those interested in the engineering behind these features:

| Feature | Implementation | Status |
|---------|---------------|--------|
| Learner Tempo Profile | Assessment phase → tempo/consistency bands → global parameter adjustments | Specified |
| Pattern Detection | Rolling window of response metrics with standard deviation analysis | Integrated |
| Struggle Detection | Differential-based discontinuity detection (measures deviation from personal baseline) | Integrated |
| Mastery Tracking | Four-state machine with smooth advancement and regression on difficulty | Integrated |
| Smart Selection | Weighted random selection factoring staleness, struggle history, and recency | Integrated |
| Pause Adjustment | Multiplicative factor applied for configurable number of items after difficulty | Integrated |
| Voice Detection | Web Audio API energy analysis, entirely client-side | Implemented |

**Everything is a parameter.** Every threshold, multiplier, and window size can be tuned - either by us finding good defaults, or by the system adapting itself based on observed learner populations.

All algorithms are documented in APML specifications (see `apml/learning/adaptation-engine.apml`).

---

## The Two Levels of Adaptation

```
┌─────────────────────────────────────────────────────────────────────┐
│  HIERARCHICAL ADAPTATION                                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Level 1: LEARNER TEMPO PROFILE (Global)                            │
│  ════════════════════════════════════════                           │
│  "What kind of learner are you?"                                    │
│  • Established in first session                                     │
│  • Changes slowly (session-scale)                                   │
│  • Sets baseline timing for everything                              │
│                                                                      │
│           ↓ Tempo Profile sets the STAGE ↓                          │
│                                                                      │
│  Level 2: DIFFERENTIAL DETECTION (Local)                            │
│  ════════════════════════════════════════                           │
│  "How is this moment different from your pattern?"                  │
│  • Runs every response                                              │
│  • Changes quickly (item-scale)                                     │
│  • Triggers moment-by-moment adjustments                            │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Status

| Component | Status |
|-----------|--------|
| Core adaptation engine | Built and tested |
| Mastery state machine | Integrated |
| Weighted selection | Integrated |
| Voice activity detection | Implemented |
| Learner Tempo Profile | Specified, ready for implementation |

Current test coverage: **589 tests passing**

The features live in the `@ssi/core` package, ready to be connected to the user interface.

---

*Last updated: December 2025*
*APML Specification: v1.3.0*
