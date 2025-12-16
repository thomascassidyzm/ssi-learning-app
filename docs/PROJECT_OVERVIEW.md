# SSi Learning App - Project Overview

*For SSi Leadership | December 2025*

---

## What This Project Is

The **SSi Learning App** is the player that delivers SSi courses to learners. It's the "front end" - what learners see and interact with.

This is separate from the **Dashboard (Popty)** which is where courses are created, audio is generated, and content is managed. The Dashboard makes the courses; the Learning App plays them.

---

## The Learning Experience

### The 4-Phase Cycle

Every learning item follows the same pattern - the core SSi methodology encoded into software:

```
PROMPT → PAUSE → VOICE 1 → VOICE 2
```

| Phase | What Happens | What Learner Sees |
|-------|--------------|-------------------|
| **PROMPT** | Play the known language audio | Known text only |
| **PAUSE** | Learner attempts the target language | Known text only |
| **VOICE 1** | Play target audio (first voice) | Known text only |
| **VOICE 2** | Play target audio (second voice) | Known + Target text |

**Key design decision:** The target text is hidden until VOICE 2. This forces recall, not reading. The learner must attempt from memory before seeing confirmation.

### The Triple Helix

Three parallel "tubes" of content, with SEEDs distributed equally across them:

**Card-Dealt Distribution:**
```
SEED 1 → Tube A
SEED 2 → Tube B
SEED 3 → Tube C
SEED 4 → Tube A
SEED 5 → Tube B
SEED 6 → Tube C
...and so on
```

The learner experiences: A, B, C, A, B, C, A, B, C...

This creates natural spaced repetition through interleaving. By the time they return to Tube A, time has passed working on B and C. The material has had a chance to settle.

**Dynamic Reorganisation:**

The tubes can collapse to make room for new content:
- New SEEDs can be injected into any tube
- Existing content collapses into 2 tubes (or even 1) to make space
- This allows targeted vocabulary injection without disrupting flow

### Spaced Repetition

Each LEGO (learning unit) has a "skip number" that increases as mastery grows:

```
1 → 1 → 2 → 3 → 5 → 8 → 13 → 21 → 34...
```

New items: seen every rotation. Mastered items: seen occasionally for maintenance.

---

## What We've Built

### The Core Engine (`@ssi/core`)

A framework-agnostic TypeScript library that handles all learning logic:

| Component | What It Does |
|-----------|--------------|
| **CycleOrchestrator** | Manages the 4-phase cycle, timing, transitions |
| **TripleHelixEngine** | Manages the three interleaved threads |
| **SpacedRepetitionQueue** | Tracks skip numbers, determines what's "due" |
| **AdaptationEngine** | Detects struggles, adjusts difficulty (see below) |
| **AudioController** | Handles audio playback, preloading, mobile quirks |

This is pure logic - no UI. It can power any interface.

### The Vue Player (`player-vue`)

A working demo player with the "Moonlit Dojo" design:

- Dark sanctuary theme
- Belt progression system (white → black, 8 levels)
- Session summary screen
- Mobile-compatible audio handling

This is functional and demonstrates the full learning experience.

### Offline Support (designed)

- **IndexedDB** for caching course data and audio
- **Cache-as-you-go** strategy (not download-everything-upfront)
- **Background sync** for learner progress
- PWA-ready architecture

---

## The Adaptive Learning Layer

This is the intelligence we've been building. The app doesn't just play content - it watches and responds.

### What It Detects

**Struggles (Discontinuities)**
- Learner normally responds in 2 seconds
- This time they took 5 seconds
- That's a signal - something was harder

**Mastery Progression**
- Consistent smooth responses → advance
- Consistent fast responses → fast-track
- Struggles → hold position or regress

**Learner Tempo (new)**
- Some learners are naturally fast processors
- Some need more time
- We detect this early, adjust the whole experience

### What It Does

| When This Happens | The App Does This |
|-------------------|-------------------|
| Learner hesitates | Extends pause for next few items |
| Learner struggles repeatedly | Boosts priority for that phrase |
| Learner is consistently smooth | Advances mastery state |
| Learner is consistently fast | Fast-tracks to higher mastery |
| Learner is naturally slow | Lengthens all pauses (global adjustment) |

### The Philosophy

**We measure differences, not absolutes.**

"Slow" doesn't mean slower than some universal standard. It means slower than *this learner's* pattern. The system is self-calibrating and personal.

---

## Data Flow

```
Dashboard (Popty)                    Learning App
═══════════════════                  ═══════════════════

Creates courses                      Plays courses
Generates audio                      Fetches audio
Stores in Supabase/S3         →      Queries Supabase/S3
                                     Caches locally
                                     Tracks learner progress
                              ←      Syncs progress back
```

The Dashboard is the "factory". The Learning App is the "delivery vehicle".

---

## Current Architecture

```
ssi-learning-app/
├── packages/
│   ├── core/              ← All learning logic (TypeScript)
│   │   ├── engine/        ← Cycle, audio control
│   │   ├── learning/      ← Helix, repetition, adaptation
│   │   ├── config/        ← All parameters
│   │   └── ...
│   └── player-vue/        ← Working demo player
├── apps/
│   ├── web/               ← PWA for community courses (planned)
│   └── schools-dashboard/ ← Classroom version (planned)
├── apml/                  ← Specifications (design docs)
└── docs/                  ← Documentation
```

---

## Status Summary

### What's Working

| Component | Status | Notes |
|-----------|--------|-------|
| 4-phase cycle | ✅ Complete | Fully implemented, tested |
| Triple helix | ✅ Complete | Thread interleaving works |
| Spaced repetition | ✅ Complete | Fibonacci skip numbers |
| Audio playback | ✅ Complete | Mobile-compatible |
| Vue demo player | ✅ Complete | Moonlit Dojo design |
| Struggle detection | ✅ Complete | Differential-based |
| Mastery tracking | ✅ Complete | 4-state machine |
| Smart selection | ✅ Complete | Weighted algorithm |
| Pause adjustment | ✅ Complete | Extends on difficulty |
| Voice detection | ✅ Complete | Browser-based, private |
| Learner tempo profile | 📋 Designed | Ready to implement |

**Test coverage:** 589 automated tests, all passing

### What's Next

1. **Implement Learner Tempo Profile** - The global adaptation layer
2. **Wire adaptation to player** - Connect the intelligence to the UI
3. **Database-first architecture** - Query Supabase directly (not static manifests)
4. **PWA for community courses** - Free, shareable, offline-capable
5. **Schools dashboard** - Classroom version with teacher features

---

## The Business Context

### Two Revenue Streams

1. **Paid courses** - SSi official courses involving major languages
2. **Free community courses** - Created by language activists, always free

### Success Metric

~£30k/month subscribers + ~£30k/month government contract. Success despite the tech, not because of it. The method is what works; we're just making the delivery better.

### Why This Matters

The SSi method already produces results. What we're building:

- **Scales the personal touch** - Adaptation that would require a human tutor
- **Enables community courses** - PWA that language activists can share freely
- **Supports classroom use** - Dashboard for schools and teachers
- **Works offline** - Critical for learners without reliable internet

---

## Key Design Principles

1. **The method is sacred** - We don't change what works. We enhance how it's delivered.

2. **Everything is a parameter** - No magic numbers. Every threshold can be tuned.

3. **Measure differences, not absolutes** - Personal baselines, not universal standards.

4. **Privacy by design** - Voice detection stays in the browser. No surveillance.

5. **Offline-first** - The app should work without internet after initial load.

---

## Documentation

| Document | Audience | Purpose |
|----------|----------|---------|
| `CLAUDE.md` | Developers/AI | Technical onboarding |
| `PROJECT_OVERVIEW.md` | Leadership | This document |
| `ADAPTIVE_LEARNING_OVERVIEW.md` | Leadership | Deep dive on adaptation |
| `ADAPTIVE_LEARNING_FEATURES.md` | Anyone | Plain-language feature guide |
| `ADAPTATION_ENGINE_SUMMARY.md` | Developers | Technical reference |
| `apml/*.apml` | Developers | Full specifications |

---

*Last updated: December 2025*
