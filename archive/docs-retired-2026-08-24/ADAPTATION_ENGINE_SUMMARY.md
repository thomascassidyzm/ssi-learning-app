# Adaptation Engine - Technical Summary

*A developer-friendly overview of the adaptive learning system*

**APML Version:** 1.3.0

---

## Architecture

The Adaptation Engine is the intelligence layer of the SSi learning app. It sits between the content structure (Triple Helix) and the playback engine (Cycle Orchestrator), making real-time decisions about how to personalize the learning experience.

### Hierarchical Adaptation (v1.3.0)

The system operates at two levels:

| Level | What | Timescale | Purpose |
|-------|------|-----------|---------|
| **Global** | Learner Tempo Profile | Session-scale | Set baseline parameters for this learner |
| **Local** | Differential Detection | Item-scale | Detect moment-to-moment anomalies |

The tempo profile sets the STAGE. Differential detection runs the SHOW.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Learning Flow                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TripleHelixEngine          AdaptationEngine       CycleOrchestrator│
│  ══════════════════         ════════════════       ═════════════════│
│  • Thread rotation          • Pattern detection    • Audio playback  │
│  • LEGO sequencing          • Mastery tracking     • Phase timing    │
│  • Interleaving             • Weighted selection   • Pause control   │
│                             • Pause adjustment                       │
│                                                                      │
│        "What's eligible?"         "What's best?"      "Play it!"    │
│              │                          │                  │         │
│              └────────────→ ────────────┴──────────→──────┘         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 0. LearnerTempoProfile (Global Layer - v1.3.0)

**Purpose:** Establishes the learner's overall pace and adjusts global parameters accordingly.

**Status:** Specified in APML, ready for implementation.

**Assessment Phase (first ~20 items):**
- Capture mean normalized latency (ms per character)
- Capture variance coefficient (stddev / mean)
- Classify into tempo band and consistency band

**Tempo Bands:**
| Band | Threshold | Pause Multiplier |
|------|-----------|------------------|
| Very Fast | < 80 ms/char | 0.7x |
| Fast | < 120 ms/char | 0.85x |
| Medium | < 180 ms/char | 1.0x |
| Slow | < 280 ms/char | 1.2x |
| Very Slow | ≥ 280 ms/char | 1.4x |

**Consistency Bands:**
| Band | Variance Coefficient | Stddev Threshold Adjustment |
|------|---------------------|----------------------------|
| Very Consistent | < 0.15 | -0.3 (tighter) |
| Consistent | < 0.25 | 0 (default) |
| Variable | < 0.40 | +0.3 (looser) |
| Highly Variable | ≥ 0.40 | +0.5 (much looser) |

**Key Insight:** A fast, consistent learner needs very different app behavior than a slow, variable learner. Both are valid - the app adapts to match.

**Refinement:** Profile slowly updates over sessions (not items) with stability constraints.

---

### 1. MetricsTracker

**Purpose:** Maintains rolling statistics of learner responses.

**Key Data:**
- Response latency per item
- Rolling average (mean of last N responses)
- Rolling standard deviation (variance in response times)
- Normalized latency (adjusted for phrase length)

**Why It Matters:** Everything else depends on these metrics. We can't detect "unusual" without knowing "usual."

---

### 2. SpikeDetector

**Purpose:** Detects when a response deviates significantly from the learner's pattern.

**Algorithm:**
```
latency_differential = current_latency - rolling_average
discontinuity = |differential| > (threshold * rolling_stddev)
```

**Severity Levels:**
| Level | Condition | Response |
|-------|-----------|----------|
| None | Within normal variance | Continue normally |
| Mild | 2-2.5 standard deviations | Note it, continue |
| Moderate | 2.5-4 standard deviations | Hold mastery position |
| Severe | >4 standard deviations | Regress mastery state |

**Key Insight:** This is self-calibrating. A consistent learner triggers on smaller absolute deviations than a variable learner.

---

### 3. MasteryStateMachine

**Purpose:** Tracks each LEGO through four mastery stages.

**States and Typical Skip Values:**
| State | Skip | Description |
|-------|------|-------------|
| Acquisition | 1 | Learning it - see it every rotation |
| Consolidating | 3 | Getting it - see it every 3rd rotation |
| Confident | 8 | Know it well - see it every 8th rotation |
| Mastered | 21 | Fluent - maintenance only |

**Transitions:**
- **Advance:** 3 consecutive smooth responses
- **Fast-track:** 5 consecutive fast responses (skip a state)
- **Hold:** Moderate discontinuity (reset counters)
- **Regress:** Severe discontinuity (go back one state)

---

### 4. WeightedSelector

**Purpose:** Probabilistically selects which LEGO to practice next.

**Weight Formula:**
```
weight = base × staleness × struggle × recency

where:
  staleness = 1 + (days_since_practice × 0.1)
  struggle  = 1 + (discontinuity_count × 0.5)
  recency   = 0.5 to 1.0 based on minutes since practice
```

**Selection:** Weighted random - higher weight = more likely, but not guaranteed. This maintains variety while prioritizing items that need attention.

---

### 5. VoiceActivityDetector

**Purpose:** Detects whether the learner is speaking during the pause phase.

**Implementation:** Web Audio API (AnalyserNode) monitoring energy levels.

**Output:**
- `speech_detected`: Boolean - was there speech?
- `activity_ratio`: 0-1 - what fraction of pause had speech?
- `peak_energy_db`: Maximum energy level

**Privacy:** All processing happens in-browser. No audio is stored or transmitted.

---

## The Main Loop

When a learning cycle completes, `AdaptationEngine.processCompletion()` orchestrates:

```typescript
// 1. Record the metric
metricsTracker.recordResponse(lego.id, latencyMs, phraseLength);

// 2. Update selection tracking (mark as practiced)
weightedSelector.updateAfterPractice(lego.id);

// 3. Detect discontinuity
const { detection, response, spike } = spikeDetector.processResponse(...);

// 4. Update mastery state
if (spike) {
  masteryStateMachine.recordDiscontinuity(lego.id, detection.severity);
  weightedSelector.recordDiscontinuity(lego.id);  // Boost priority
  triggerPauseExtension();                         // Slow down
} else {
  masteryStateMachine.recordSmooth(lego.id, wasFast);
}

// 5. Return action and transition
return { action: 'continue' | 'repeat' | 'breakdown', masteryTransition };
```

---

## Key Design Principles

### 1. Differential-Based (Not Absolute)

We never compare to universal thresholds. "Slow" means slower than *this learner's* pattern. This makes the system self-calibrating and personal.

### 2. Parameterized (Everything Is Configurable)

Every threshold, window size, and multiplier is a parameter with documented defaults and ranges. This enables experimentation and personalization.

### 3. Gradient-Based (Not Binary)

Instead of hard pass/fail decisions, we use probabilities and factors. A struggling LEGO gets higher weight, not mandatory repetition. Mastery progresses gradually, not in sudden jumps.

### 4. Privacy by Design

Voice detection happens client-side. Audio never leaves the browser. We detect *that* you're speaking, not *what* you're saying.

---

## Configuration

All parameters live in `LearningConfig`:

```typescript
{
  spike: {
    rolling_window_size: 10,      // Items for rolling stats
    stddev_threshold: 2.0,        // Sigmas for discontinuity
    pause_extension_factor: 0.3,  // How much to extend pause
    pause_extension_duration: 3,  // Items to maintain extension
  },

  // Mastery thresholds set in MasteryStateMachine defaults
  // Selection weights set in WeightedSelector defaults
}
```

---

## File Reference

| File | Purpose |
|------|---------|
| `AdaptationEngine.ts` | Main orchestrator, unified API |
| `MetricsTracker.ts` | Rolling statistics |
| `SpikeDetector.ts` | Discontinuity detection |
| `MasteryStateMachine.ts` | Four-state progression |
| `WeightedSelector.ts` | Probabilistic selection |
| `VoiceActivityDetector.ts` | Speech detection |
| `types.ts` | Shared type definitions |

---

## Testing

589 tests cover all components:

- MetricsTracker: Rolling averages, stddev calculation
- SpikeDetector: Threshold detection, severity classification
- MasteryStateMachine: State transitions, edge cases
- WeightedSelector: Weight calculation, selection distribution
- AdaptationEngine: Integration of all components
- VoiceActivityDetector: Web Audio API mocking

Run with: `pnpm --filter @ssi/core test`

---

## Next Steps

The Adaptation Engine is built and tested. Integration points:

1. **CycleOrchestrator** - Call `processCompletion()` at cycle end
2. **CycleOrchestrator** - Use `getPauseDurationMultiplier()` for pause timing
3. **TripleHelixEngine** - Use `selectFromCandidates()` for LEGO selection
4. **CycleOrchestrator** - Integrate `VoiceActivityDetector` during pause phase
5. **LearnerTempoProfile** - Implement assessment phase and global adjustments (v1.3.0)

### Learner Tempo Profile Implementation Tasks

When ready to implement the tempo profile:

1. Create `LearnerTempoProfile.ts` with assessment logic
2. Add tempo profile to persistence layer (store per learner)
3. Load profile on session start, apply global adjustments
4. Update AdaptationEngine to use tempo-adjusted parameters
5. Add refinement logic at session end

---

*Version: 1.3.0 | December 2025*
