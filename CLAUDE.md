# CLAUDE.md - Agent Onboarding Guide

> **Welcome, future agent!** This document contains everything you need to work effectively on the SSi Learning App without creating chaos.

## Project Overview

**SSi Learning App** is the language learning player application that delivers SSi courses to learners. It's built as a monorepo with a framework-agnostic TypeScript core and UI adapters.

### Quick Facts
- **Purpose**: Content delivery and learning experience (NOT content creation)
- **Architecture**: Monorepo with `@ssi/core` package + UI adapters
- **Current UI**: Vue 3 player (`player-vue`) - working demo
- **Future UI**: PWA (`apps/web`) - for community courses
- **Schools UI**: Chrome PWA (`apps/schools-dashboard`) - for classroom use
- **Deployment**: Vercel
- **Related Project**: `ssi-dashboard-v7-clean` (Popty) handles content creation

---

## TRANSITION STATE (December 2025)

We are in a transition from **manifest-first** to **database-first** architecture:

### Current State (Working)
- `player-vue` loads from static `course_manifest.json`
- Audio fetched from S3 CDN at runtime
- Works, but requires app rebuild for content updates

### Target State (In Progress)
- App queries Supabase directly for course structure
- Audio UUIDs resolved on-demand from database
- Hot-swappable content (typo fixes, A/B testing without rebuild)
- IndexedDB cache for offline with background sync

### Backwards Compatibility
- Dashboard still generates `course_manifest.json` for legacy native app
- New PWA can use either manifest OR database (fallback pattern)
- Both paths will coexist until native app migration complete

---

## Ecosystem: Two Repositories

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          SSi ECOSYSTEM                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ssi-dashboard-v7-clean (Popty)          ssi-learning-app               │
│  ═══════════════════════════════         ═══════════════════            │
│  Content CREATION                         Content DELIVERY               │
│                                                                          │
│  • Phase 1-3: Translation, LEGOs,        • @ssi/core: Engine            │
│    Basket generation                      • player-vue: Demo UI          │
│  • Phase 8: Audio generation (TTS)       • apps/web: PWA (TODO)         │
│  • Phase 9: Manifest compilation         • apps/schools-dashboard        │
│  • Production API: QA, recording                                         │
│  • Supabase: seeds, legos, audio         • Supabase: learner progress   │
│                                                                          │
│  Dashboard → S3/Supabase → Learning App → Learner                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Dashboard (Popty)                    Learning App
═══════════════════                  ═══════════════════
Phase 1-3
  └→ lego_baskets.json

Phase 8: Audio Gen
  └→ S3: mastered/{uuid}.mp3    ──→  AudioController fetches
  └→ Supabase: audio_samples

Phase 9: Manifest
  └→ course_manifest.json       ──→  Legacy: loads manifest
                                ──→  Future: queries Supabase
```

---

## Repository Structure

```
ssi-learning-app/
├── packages/
│   ├── core/                    # @ssi/core - Framework-agnostic TypeScript
│   │   ├── src/
│   │   │   ├── engine/          # CycleOrchestrator, AudioController
│   │   │   ├── learning/        # TripleHelix, SpacedRepetition, Adaptation
│   │   │   ├── data/            # Type definitions for LEGOs, Seeds, Phrases
│   │   │   ├── config/          # Configuration defaults and types
│   │   │   ├── cache/           # OfflineCache, DownloadManager, AudioSource
│   │   │   └── persistence/     # ProgressStore, SessionStore, SyncService
│   │   └── package.json
│   ├── player-vue/              # Vue 3 learning player (WORKING DEMO)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── LearningPlayer.vue   # Main player component
│   │   │   │   └── SessionComplete.vue  # Session summary screen
│   │   │   └── App.vue
│   │   └── public/audio/        # Demo audio files (bundled)
│   ├── ui/                      # Shared UI components
│   ├── demo/                    # Demo content
│   ├── vue-adapter/             # Vue 3 adapter (stub)
│   └── react-adapter/           # React adapter (stub)
├── apps/
│   ├── web/                     # PWA for community courses (TODO)
│   └── schools-dashboard/       # Schools/classroom version (TODO)
├── apml/                        # APML specifications
│   ├── core/                    # Core data types
│   ├── engine/                  # CycleOrchestrator spec
│   ├── learning/                # Learning algorithm specs
│   ├── persistence/             # Storage specs
│   ├── interfaces/              # UI specs
│   └── ssi-learning-app-master.apml  # Master APML
├── docs/                        # Documentation
├── supabase/                    # Database schema
├── vercel.json                  # Deployment configuration
└── package.json                 # Workspace root (pnpm)
```

---

## The 4-Phase Learning Cycle

The core learning mechanic is a **4-phase prompt-response cycle**:

```
┌─────────────────────────────────────────────────────────────────┐
│  PROMPT → PAUSE → VOICE_1 → VOICE_2 → [next item]              │
│    │        │        │         │                                │
│  Known    Learner  Target    Target                             │
│  audio    speaks   audio     audio                              │
│  plays    aloud    (no text) + text                             │
└─────────────────────────────────────────────────────────────────┘
```

### Phase Details

| Phase | What Happens | Text Visibility |
|-------|--------------|-----------------|
| **PROMPT** | Play KNOWN language audio | Known only |
| **PAUSE** | Learner attempts TARGET (timed gap) | Known only |
| **VOICE_1** | Play TARGET audio, voice A | Known only |
| **VOICE_2** | Play TARGET audio, voice B | Known + Target |

### Timing (validated)
- Cycle duration: ~11 seconds (prompt 2s + pause 4s + target1 2s + target2 2s)
- ~5 cycles per minute
- 12 new LEGOs introduced per 30-min session
- Spaced rep (N-1: 3x, N-2: 1x, N-3: 1x, N-5: 1x) reuses cached audio

### Key Design Principles
- **No target text until VOICE_2** - Forces recall, not reading
- **Two voices for target** - Variety helps with recognition
- **Dynamic pause duration** - 2x target audio length by default
- **Seamless transitions** - Audio plays continuously

---

## Core Package (`@ssi/core`)

### Engine Module

**`CycleOrchestrator`** - State machine for one learning cycle
```typescript
import { CycleOrchestrator, CyclePhase } from '@ssi/core'

const orchestrator = new CycleOrchestrator(audioController, config)
orchestrator.addEventListener((event) => {
  // Handle phase_changed, item_completed, pause_started, etc.
})
await orchestrator.startItem(learningItem)
```

**`IAudioController`** - Interface for audio playback
```typescript
interface IAudioController {
  play(audioRef: AudioRef): Promise<void>
  stop(): void
  preload(audioRefs: AudioRef[]): Promise<void>
  onEnded(callback: () => void): void
  offEnded(callback: () => void): void
}
```

### Learning Module

**`TripleHelixEngine`** - Three parallel learning "tubes" with card-dealt distribution
- SEEDs dealt like cards: SEED 1→Tube A, SEED 2→Tube B, SEED 3→Tube C, SEED 4→Tube A...
- Learner rotates through tubes: A, B, C, A, B, C...
- Creates natural spaced repetition - by time you return to Tube A, material has settled
- Tubes can collapse to make room for content injection (new vocabulary)

**`SpacedRepetitionQueue`** - Fibonacci-based skip numbers
- LEGOs start at position 0 (skip=1)
- Progress through: 1, 1, 2, 3, 5, 8, 13, 21, 34...
- Eventually retire to "eternal" rotation

**`AdaptationEngine`** - Real-time difficulty adjustment
- Tracks response latency during PAUSE phase
- Detects "spikes" (hesitation/struggle)
- Adjusts pause duration and content ordering

### Data Types

**Core Hierarchy:**
```
SEED (full sentence) → LEGO (learning unit) → PracticePhrase (practice item)
```

**LEGO Types:**
- **A-type (Atomic)**: Single words, cannot be split
- **M-type (Molecular)**: Multi-word phrases, have components

**Basket Cycle Sequence (for M-type LEGOs):**
1. Components (`is_component: true`) - Individual words
2. LEGO Debut (`is_debut: true`) - Complete LEGO phrase
3. Practice sentences - LEGO used in context

### Cache Module (PWA Critical)

**`OfflineCache`** - IndexedDB-based audio storage
**`DownloadManager`** - Smart pre-fetching
**`AudioSource`** - Unified local/remote audio access

**PWA Caching Math (validated):**
- ~4.8 MB per 30-min session (198 unique audio files)
- Spaced repetition reuses already-cached audio
- Safari 1GB limit = 200x headroom for full course
- 17 seconds to buffer 30 mins ahead on 3G

### Persistence Module

**`ProgressStore`** - LEGO/Seed progress persistence
**`SessionStore`** - Session state snapshots
**`SyncService`** - Supabase sync (pending integration)

---

## Vue Player (`player-vue`)

### Design: "Moonlit Dojo"
- Dark sanctuary theme with belt-colored accents
- Japanese landscape silhouettes
- Firefly particles that match belt color
- "Schindler's List" restraint - single color accent

### Belt Progression System
8 martial arts belts tracking seed completion:
```
White (0) → Yellow (8) → Orange (20) → Green (40) →
Blue (80) → Purple (150) → Brown (280) → Black (400)
```

### Audio Controller Implementation

**Critical for mobile compatibility:**
```javascript
class RealAudioController {
  constructor() {
    this.audio = null  // Single reusable Audio element
    this.endedCallbacks = new Set()
  }

  async play(audioRef) {
    // Reuse Audio element - don't create new ones!
    // This preserves the "user gesture unlock" on mobile
    if (!this.audio) {
      this.audio = new Audio()
    }
    this.audio.src = audioRef.url
    this.audio.load()
    await this.audio.play()
  }
}
```

---

## Audio Architecture: Atomic Files vs Pre-Rendered Sessions

### DECISION: Atomic Audio Files (Not Pre-Rendered)

The PWA uses **individual audio files per phrase** orchestrated by CycleOrchestrator, NOT pre-rendered session audio files.

#### Why NOT Pre-Rendered Long Audio Files

The legacy native app renders 30-minute audio+video files with baked-in timing. This causes:

```
PROBLEMS WITH PRE-RENDERED APPROACH:
┌─────────────────────────────────────────────────────────────────────────┐
│  audio.mp3 (30 min) ←──sync──→ video.mp4 (30 min)                      │
│                         ↑                                               │
│                    DRIFT HAPPENS                                        │
│                                                                         │
│  • Rigid - can't skip, repeat, adapt to learner                        │
│  • Huge files - 30-50MB per session                                    │
│  • No personalization - everyone gets same sequence                    │
│  • Sync nightmare - audio/video drift apart over time                  │
│  • Regeneration hell - fix one phrase, re-render entire session        │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Why Atomic Files Work

```
ATOMIC APPROACH:
┌─────────────────────────────────────────────────────────────────────────┐
│  Individual files in IndexedDB cache:                                   │
│                                                                         │
│  {uuid-prompt}.mp3  (~25KB, 1-3s)                                      │
│  {uuid-target1}.mp3 (~25KB, 1-3s)                                      │
│  {uuid-target2}.mp3 (~25KB, 1-3s)                                      │
│                                                                         │
│  CycleOrchestrator: play → timer → play → timer → play → next          │
│                                                                         │
│  ✓ Flexible - adapt sequence in real-time                              │
│  ✓ Small files - cache only what you need                              │
│  ✓ Reusable - same audio across multiple contexts                      │
│  ✓ Hot-swappable - fix a phrase, only that UUID changes                │
│  ✓ No sync issues - text is state, not a file                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Browser Audio: Solved Problems

**Gap between audio files?**
```javascript
// Use single Audio element with preloading
const audio = new Audio()  // Reuse, never recreate

// While current plays, next is preloaded
// Gap is imperceptible (<50ms) and absorbed by deliberate pauses
```

**Mobile audio unlocking?**
```javascript
// First play must be in user gesture
startButton.onclick = () => {
  audio.play()  // Unlocks audio context
  // All subsequent plays work automatically
}

// KEY: Reuse same Audio element - new Audio() requires new unlock on iOS
```

**Preloading strategy:**
```javascript
// Always keep next 2-3 items ready
async function preloadAhead(queue) {
  const next3 = queue.slice(0, 3)
  for (const item of next3) {
    const audio = new Audio(item.url)
    audio.preload = 'auto'
    // Browser caches it, ready for instant play
  }
}
```

#### Why Gaps Don't Matter

The learning cycle has **built-in pauses** that absorb any loading jitter:

```
PROMPT (2s) → PAUSE (4s) → VOICE_1 (2s) → gap (1s) → VOICE_2 (2s)
                ↑                            ↑
            Timer (no audio)            Timer (no audio)

If loading next file takes 50ms, learner doesn't notice -
they're already in a deliberate pause.
```

#### Text Sync is Trivial

No karaoke-style word highlighting. Text visibility is phase-based:

```
Phase         | Known Text | Target Text
─────────────────────────────────────────
PROMPT        | visible    | hidden
PAUSE         | visible    | hidden
VOICE_1       | visible    | hidden
VOICE_2       | visible    | visible    ← Appears here only
```

Text update is instantaneous on phase change. No drift possible.

**The screen is theater for the sale. The ears do the work.**

---

## PWA Strategy (Community Courses)

### Why PWA for Community Courses
- **Zero friction**: Link sharing, no app store
- **Instant updates**: Hot-swap content without rebuild
- **Free forever**: Community courses always free
- **Language activists**: Share links to their communities

### PWA Implementation Plan (`apps/web`)

1. **Service Worker**
   - Precache app shell
   - Cache-as-you-go for audio (not pre-download entire course)
   - Background sync for progress

2. **IndexedDB Layer**
   - Course data (seeds, legos, baskets)
   - Audio blobs (cached during learning)
   - Learner progress (sync to Supabase when online)

3. **Supabase Data Provider**
   - Query course structure on startup
   - Resolve audio UUIDs by text+role
   - Sync learner progress

4. **Offline Flow**
   ```
   App loads → Check IndexedDB (< 24h fresh?) → Yes: use cached
                                              → No: fetch Supabase
   Learning → Cache audio as played
   Offline  → Spaced rep reuses cached audio
   Online   → Background sync progress
   ```

### Safari Limitations (Acceptable)
- 1GB storage limit (200x more than needed for one course)
- No push notifications (not needed for learning)
- No background audio control (acceptable)

---

## Schools Dashboard (`apps/schools-dashboard`)

### Target: Chrome PWA
- Classroom use on Chromebooks
- Teacher dashboard for class progress
- Real-time Supabase subscriptions for live updates
- Student progress tracking

### Features (Planned)
- Class roster management
- Assignment of courses
- Progress visualization
- Real-time "who's learning now" view

---

## Business Model Context

### Pricing Logic
- **Big 10 Languages**: English, Spanish, French, German, Italian, Portuguese, Chinese, Japanese, Arabic, Korean
- **Paid**: SSi official courses involving Big 10 (either direction)
- **Free forever**: Community courses (regardless of language pair)
- **Community trumps everything**: If it's community-created, it's free

### Success Metric
- ~£30k/month subscribers + ~£30k/month government contract
- Success despite tech, not because of it
- Language activists as evangelists

---

## Content Format

### Legacy: Course Manifest (JSON file)
```json
{
  "course_id": "spa_for_eng_v2",
  "title": "Spanish for English Speakers",
  "known_language": "en",
  "target_language": "es",
  "version": "2.0.0",
  "slices": [{
    "seeds": [...],
    "samples": {...}
  }]
}
```

### Future: Supabase Direct Queries
```sql
-- Table naming convention:
-- course_* prefix = course-specific (course_seeds, course_legos, course_practice_phrases)
-- No prefix = global (audio_samples, voices)

-- Get seeds for a session
SELECT * FROM course_seeds
WHERE course_code = 'spa_for_eng_v2'
  AND position >= 1 AND position <= 30;

-- Get LEGOs for seeds
SELECT * FROM course_legos
WHERE seed_id IN ('S0001', 'S0002', ...)
ORDER BY seed_id, lego_index;

-- Get practice phrases for LEGOs
SELECT * FROM course_practice_phrases
WHERE lego_id IN ('S0001L01', 'S0001L02', ...)
ORDER BY lego_id, sort_order;

-- Get audio (global - shared across courses)
SELECT uuid, duration_ms, s3_key
FROM audio_samples
WHERE text_normalized = lower(trim('quiero aprender'))
  AND role = 'target1';
```

---

## Development

### Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run player dev server
pnpm --filter player-vue dev

# Run core tests
pnpm --filter @ssi/core test

# Run web PWA (when implemented)
pnpm --filter @ssi/web dev
```

### Vercel Deployment

```json
{
  "buildCommand": "pnpm --filter @ssi/core build && pnpm --filter player-vue build",
  "outputDirectory": "packages/player-vue/dist",
  "installCommand": "npm install -g pnpm && pnpm install",
  "framework": "vite"
}
```

---

## What's Built vs What's Next

### Completed
- [x] CycleOrchestrator state machine
- [x] 4-phase learning cycle
- [x] RealAudioController (mobile-compatible)
- [x] Vue player with Moonlit Dojo design
- [x] Belt progression system
- [x] Session summary screen
- [x] Dynamic pause duration (2x target audio)
- [x] Real Italian/Spanish course audio integration

### In Progress
- [ ] Database-first architecture (Dashboard done, App pending)
- [ ] Supabase data provider for app
- [ ] IndexedDB cache layer

### Next Up
- [ ] `apps/web` PWA implementation
- [ ] Service worker for offline
- [ ] Supabase sync for learner progress
- [ ] `apps/schools-dashboard` for classroom use

### Future
- [ ] Speech recognition during PAUSE phase
- [ ] Triple Helix thread switching
- [ ] A/B testing framework integration

---

## Critical Rules for Agents

### DO
- Use `@ssi/core` for all learning logic
- Reuse the single Audio element for mobile compatibility
- Respect the 4-phase cycle order
- Test audio playback on mobile Safari
- Follow the Moonlit Dojo design aesthetic
- Query Supabase for new implementations (not manifest)
- Cache audio in IndexedDB as it's played

### DON'T
- Create new Audio elements per playback (breaks mobile)
- Show target text before VOICE_2 phase
- Pre-download entire courses (cache-as-you-go instead)
- Break backwards compatibility with manifest loading
- Add excessive logging to production
- Modify belt thresholds without discussion

### Audio Playback Rules
1. **Single Audio element** - Reuse, don't recreate
2. **Snapshot callbacks** - When iterating ended callbacks
3. **Handle errors gracefully** - Continue cycle on failure
4. **Preload ahead** - Next 2-3 items minimum
5. **Cache after play** - Store in IndexedDB for offline

### APML Documentation Rules (MANDATORY)
**Every commit that changes functionality MUST include corresponding APML updates.**

1. **Before committing**: Check if your changes affect any documented specs in `apml/`
2. **Update APML files** if you:
   - Add new components or views
   - Change data flow or state management
   - Modify the learning cycle or phases
   - Add new composables or utilities
   - Change UI architecture or interactions
3. **APML location**: `apml/` directory - find the relevant spec file
4. **Keep specs current**: Document what EXISTS NOW, not historical changes
5. **Update timestamps**: Change the "Last updated" date in modified APML files

**This is non-negotiable. Out-of-date documentation causes chaos.**

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/core/src/engine/CycleOrchestrator.ts` | Main cycle state machine |
| `packages/core/src/engine/types.ts` | Cycle phases, events, interfaces |
| `packages/core/src/data/types.ts` | LEGO, Seed, Phrase types |
| `packages/player-vue/src/components/LearningPlayer.vue` | Main player UI |
| `packages/player-vue/src/components/ConstellationNetworkView.vue` | Pre-built network visualization |
| `packages/player-vue/src/components/SessionComplete.vue` | Session summary |
| `packages/player-vue/src/composables/usePrebuiltNetwork.ts` | Network position pre-calculation |
| `packages/player-vue/src/composables/usePrebuiltNetworkIntegration.ts` | Network-session integration |
| `packages/player-vue/src/composables/useScriptCache.ts` | Script caching |
| `packages/player-vue/src/composables/useMetaCommentary.ts` | Intro messages |
| `packages/player-vue/src/composables/useBeltProgress.ts` | Belt progression tracking |
| `apml/ssi-learning-app-master.apml` | Full APML specification |
| `apml/interfaces/constellation-network.apml` | Network visualization spec |
| `apml/interfaces/learning-player.apml` | Player UI spec |
| `new_vision/LEARNING_APP_DATA_FLOW.md` (in Dashboard) | Database-first architecture |
| `new_vision/LEGO_SESSION_SPECIFICATION.md` (in Dashboard) | Session structure spec |

---

## Related Documentation

### In This Repo
- `apml/` - Full APML specifications for learning engine
- `docs/` - Additional documentation

### In Dashboard Repo (`ssi-dashboard-v7-clean`)
- `new_vision/LEARNING_APP_DATA_FLOW.md` - How app will query Supabase
- `new_vision/LEGO_SESSION_SPECIFICATION.md` - Session structure & parameters
- `new_vision/COURSE_CREATION_MASTER_OVERVIEW.md` - Full system overview
- `new_vision/VOICE_CONFIGURATION_SPEC.md` - Voice configuration
- `CLAUDE.md` - Dashboard onboarding guide

---

## Cycle Refactor (January 2026)

### The Core Problem
Text and audio can desync. This is unacceptable for a learning app - teaching the wrong thing is worse than teaching nothing.

### The Solution: Cycles as Atomic Units
A **Cycle** is an immutable, pre-validated learning unit:
- `known`: { text, audioId, durationMs }
- `target`: { text, voice1AudioId, voice2AudioId, durations }
- Audio bound by **ID**, never by text lookup
- Cycle is complete or doesn't exist

### Quality Expectations for This Refactor

**Non-Negotiable:**
- Text and audio MUST come from the same Cycle object
- No audio lookup by text string - always use IDs
- A Cycle is complete (all 3 audio IDs valid) or it doesn't play
- Pre-validate sessions before starting - never assemble at runtime

**For Schools:**
- Teachers have zero tolerance for bugs
- Students must never hear audio that doesn't match displayed text
- System must work offline with cached content
- "Downloading..." is acceptable; mismatched audio is not

**Code Quality:**
- Small, focused changes
- One logical commit per task
- All feedback loops must pass (types, tests, lint) before commit
- Keep new components under 300 lines

### Feedback Loops
Before every commit:
```bash
pnpm --filter player-vue typecheck  # Must pass
pnpm --filter player-vue test       # Must pass
pnpm --filter player-vue lint       # Must pass
```

### Files Being Created
- `/packages/player-vue/src/types/Cycle.ts` - Type definitions
- `/packages/player-vue/src/utils/validateCycle.ts` - Validation functions
- `/packages/player-vue/src/composables/useCyclePlayback.ts` - Playback logic
- `/packages/player-vue/src/components/CyclePlayer.vue` - Simple player component

### Progress Tracking
- See `ralph-prd.json` for task list
- See `progress.txt` for iteration history

---

## Audio Caching Architecture (v2.2.0)

Best-in-class audio system with backend proxy and graceful degradation. **Core principle: audio must NEVER stop - user never sees connection errors.**

### Backend Proxy
- **Endpoint**: `GET /api/audio/:audioId`
- **File**: `api/audio/[audioId].ts`
- **Purpose**: Entitlement verification, analytics, CORS bypass, future CDN flexibility
- **Response**: Streams audio from S3 with 1-year cache headers

### Two-Layer Caching
1. **IndexedDB (OfflineCache)**: App-controlled, readable blobs for offline play
2. **Service Worker (Workbox)**: Browser-controlled, CacheFirst strategy for `/api/audio/*`

### Prefetch Manager
- **File**: `packages/player-vue/src/composables/usePrefetchManager.ts`
- **Target**: 30 minutes cached ahead during active play
- **Trigger**: After each cycle completes
- **Silent**: Never interrupts playback on prefetch errors

### Graceful Degradation
- **File**: `packages/player-vue/src/composables/useOfflinePlay.ts`
- **Hierarchy**:
  1. Normal: Play scheduled cycle
  2. Belt-only: Play any cached cycle
  3. USE phrases: Play mastered content
  4. Repeat: Loop last successful cycle

### Resumable Downloads
- Downloads persist across app restarts (localStorage)
- Resume within 24 hours of interruption
- Options: Current belt, 2 hours, 5 hours, entire course (up to 10 hours)

### Analytics (audio_plays table)
Every audio request is tracked:
- user_id, audio_id, course_id, seed_id
- audio_role (known/target1/target2)
- device_type, is_offline, ip_country

### Key Files
| File | Purpose |
|------|---------|
| `api/audio/[audioId].ts` | Vercel serverless proxy |
| `packages/player-vue/src/composables/usePrefetchManager.ts` | 30-min buffer |
| `packages/player-vue/src/composables/useOfflinePlay.ts` | Graceful degradation |
| `packages/player-vue/src/config/audioConfig.ts` | URL builder & config |
| `packages/core/src/cache/AudioSource.ts` | Proxy URL support |
| `packages/core/src/cache/DownloadManager.ts` | Resumable downloads |
| `apml/cache/audio-architecture.apml` | Full architecture spec |

---

## Ralph Loop Methodology

We use Ralph loops for autonomous, overnight coding tasks.

### What is Ralph?
A self-correcting loop where Claude picks tasks from a PRD, implements them, runs feedback loops (tests), and commits - repeating until complete.

### Files
- `ralph-prd.json` - Task list with pass/fail status
- `progress.txt` - Iteration history and notes
- `ralph-prompt.md` - Core prompt with context and rules
- `ralph-once.sh` - Single iteration (HITL mode)
- `ralph-afk.sh` - Loop mode (overnight/AFK)

### Running Ralph

**HITL (watch and learn):**
```bash
./ralph-once.sh
```

**AFK (overnight):**
```bash
./ralph-afk.sh 25  # max 25 iterations
```

### Key Principles
1. **Small tasks** - One logical change per iteration
2. **Feedback loops** - Tests must pass before commit
3. **Progress tracking** - progress.txt carries context between iterations
4. **Clear completion** - PRD items have pass/fail, not ambiguity

### Results
First run (2026-01-22): Completed 7 items in ~4 minutes, 10 tests passing, clean code.

---

*Last updated: 2026-01-25*
*Status: v2.2.0 - Audio caching architecture implemented*
