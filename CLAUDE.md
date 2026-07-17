# CLAUDE.md - Agent Onboarding Guide

> **Welcome, future agent!** This document contains everything you need to work effectively on the SSi Learning App without creating chaos.

## CRITICAL: Branch Policy

Three-tier promotion flow (set up 2026-05-24). **ALL work goes to `dev`. NEVER push to `staging` or `main` directly.**

```
dev  ──promote──▶  staging  ──promote──▶  main
(rapid)            (stable soak)          (production)
```

| Branch | Purpose | Deploys to | Who |
|--------|---------|------------|-----|
| `dev` | Rapid integration — Tom's rapid work + ALL `claude/**` web sessions auto-merge here | `ssi-learning-app-git-dev-zenjin.vercel.app` (stable Vercel git-branch alias — **there is NO `dev.saysomethingin.app`, it 404s**) | Tom + Claude |
| `staging` | Stable soak — frozen-ish candidate the external/Colombo test team vets | `staging.saysomethingin.app` | promoted from `dev` |
| `main` | Production — real users | `saysomethingin.app` | promoted from `staging` |

> **Dev URL note.** The only stable non-prod custom domain is `staging.saysomethingin.app`. The `dev` branch has **no** custom domain — use its Vercel git-branch alias `https://ssi-learning-app-git-dev-zenjin.vercel.app` (always tracks dev's latest build; dev auto-updates the SW so a reload gets fresh code). Per-commit hash URLs also work but rotate every push. Dev test cheats: append `?fc=1` (force interjections every boundary), `?stream` (bypass cache play), `?reset=1` (full state wipe).

At the start of every session, run:
```bash
git checkout dev
git pull origin dev
```

Then **read [`WORKLIST.md`](./WORKLIST.md) (repo root)** — the shared multi-agent worklist (the live "what's next"). Before starting anything substantial, **claim your item there** (`[ ]`→`[~] @you MM-DD`, one-line commit) so parallel agents don't double-grab it. The full protocol is in its header.

**Rules:**
- `dev` is the **default branch** — new `claude/**` branches cut from it and auto-merge back to it (`.github/workflows/auto-merge-claude.yml`).
- **Promotion is manual and deliberate** (Tom drives it): merge `dev → staging` only when green; merge `staging → main` weekly, after the external team has vetted staging.
- Do all feature/debug work on `dev` — it's the only environment that's safe to thrash. The external team and prod never see `dev`'s churn.
- If you find yourself on `staging` or `main`, switch to `dev` before making changes.

**Hotfix lane (production emergencies only):** a critical prod bug that can't wait for the promotion train goes straight to `main` via a `hotfix/<desc>` branch off `main`, then is **back-merged into `staging` AND `dev`** so the fix isn't lost on the next promotion. Use this sparingly — normal fixes ride the dev→staging→main train.

---

## Decision heuristic: the BSC test (Better × Simpler × Cheaper)

**Every decision to do *anything at all* must pass the BSC test.** Before you build, refactor, add a dependency, a table, a surface, or a routine — and before an agent commits to a course of action — write the narrative for how it is **Better × Simpler × Cheaper.**

- **Multiplicative, not additive.** It's `Better × Simpler × Cheaper`, so a near-zero on any one axis kills the score. This is the whole point: it filters out the things that are *good but complex*, or *good and simple but expensive to run*. "It's a great feature" is not enough if it's a maintenance and runtime tax forever.
  - **Better:** does it genuinely improve the learner / teacher / leader outcome?
  - **Simpler:** fewer moving parts, fewer concepts, less surface to maintain — ideally it *deletes* something (reuses an existing lens/primitive instead of adding a parallel one).
  - **Cheaper:** less build, less runtime/infra, less ongoing operational cost. No new signal before its consumer exists.
- **Be relentless about the narrative.** We don't just feel that something passes — we *write the three-bullet narrative* (see the worked example in `docs/methodology/tutor-insights.md` §6). If you can't write an honest Better/Simpler/Cheaper story, that's the signal to not do it, or to find the version that does pass.
- **This generalises an existing principle.** It is *Measuring Progress*' Principle 5 (`better × simpler × cheaper, and never build a signal before its consumer exists`), which already governs the metrics / Insight Engine work — now lifted to govern **all** decisions on this repo, not just analytics.

### Agent autonomy under BSC

Tom does not need to be the decision-maker for every call. **An agent may apply the BSC test itself and proceed without asking**, provided it:
1. has written the Better × Simpler × Cheaper narrative for the action, and
2. is **>90% confident** that narrative is reasonable.

Under those two conditions, just go ahead (within the usual rails: `dev`-branch hygiene, zero-tolerance schools quality bar). If you can't clear 90%, or it's a genuine scope change, *then* surface it — with your BSC narrative attached so the decision is fast.

**What does *not* need a heads-up: code and database changes.** Git makes any code change a revert away, and Tom's row-level DB provenance recovers any write — so inside those systems nothing is truly irreversible. Decide and go. **What does: outward-facing actions** that escape git and provenance because the effect lands *outside* the systems Tom can roll back — an OTP/email to real users, a real payment, a production deploy live learners immediately hit, a secret crossing the boundary. Git can revert the commit but can't unsend the email or uncharge the card. But notice those are all *intention*, not detail — "should we touch real people / real money / the outside world now" — so they fold into "surface intention" below rather than being a separate gate.

### Working cadence: the ≤3 checkpoint, alternating code and strategy

Autonomy is bounded so a loop can't drift too far out on a limb before a human re-confirms the direction. Two rules, which compose:

1. **At most three self-directed items per burst.** A "burst" is consecutive self-initiated work with no human turn between. After three, **stop and surface** — what shipped, what's next, the fork if there is one — and wait for an express go-ahead to continue. Reacting to Tom's direct instructions does **not** count toward the three; the counter is only for self-initiated work and **resets whenever Tom takes a turn**.
2. **Don't let all three be the same kind of work.** Alternate an isolated, modular **code** piece (a scoped 🔨 *To build* item — e.g. the curvature engine) with a **strategic** piece (a 🤔 *Areas to think through* design exploration, or advancing a 🧭 *Direction*). Cranking modular widgets back-to-back optimises a local thing while the strategic picture stalls; alternating keeps both moving and makes each checkpoint a natural place to re-aim.

> The worklist's three item-types are exactly these, and a healthy burst draws across them: **🧭 Directions / bets** (directional, change rarely) · **🔨 To build** (already-scoped work) · **🤔 Areas to think through** (open design / think-pieces). See [`WORKLIST.md`](./WORKLIST.md).

### Altitude: intention is Tom's, detail is the agent's

Tom works at the level of **intention** — what we're building, what matters, the priorities, the pedagogical and product bets. The agent works at the level of **the code and the detail**, and owns the *decisions* within that layer, made against Tom's intention and filtered through BSC. The test is almost tautological: **if evaluating a decision requires holding the detail Tom has delegated, it is below his altitude by definition, and it is the agent's to make.** "Extend this table vs add a new one," "which columns," "how to structure this function" are opaque to intention not because Tom couldn't follow them but because he shouldn't have to carry them. The agent's job is to *absorb* that load, not hand it back.

**The tell that you've mis-altituded:** you did the analysis, wrote the BSC narrative, reached >90% — and then handed Tom the conclusion as a question to ratify. If you've done the work, the decision is already made; proceed, and report at the intention level ("the sensors now have a persisted home"), rather than asking him to approve the plumbing. When a detail decision secretly carries an intention-level consequence, surface the *implication* in Tom's language and keep moving unless he stops you — not the detail itself. The counterweight to this autonomy is rigour: the >90% must be an honest self-assessment, not a stamp reached for to bless what you already wanted to do.

---

## TODO: Tighten RLS on the schools org tables (condition-gated)

**Current state (2026-07-04):** the learner-data spine (learners, sessions, course_enrollments, lego/seed_progress, daily_contributions, user_tags, class_sessions) has own-row RLS **live since 2026-06-10** — canaried, real-JWT verified. Content tables stay permissive by design. What remains RLS-off is the six org tables: `schools`, `classes`, `groups`, `govt_admins`, `invite_codes`, `entitlement_grants`. Grant hygiene shipped 2026-07-04 (classes DELETE, govt_admins DELETE/TRUNCATE, entitlement_grants anon SELECT all revoked; privileged bearer codes bounded), so the residual exposure is authenticated cross-reads of org structure — demo data today.

**Trigger to tighten (conditions, NOT the calendar):** run the org-table RLS pass when ALL THREE hold — do not wait for a paying school to be imminent, and do not run it before they hold:
1. **Demo schools data regenerated to conform** (real auth uids, not Clerk-fake ids — feat_17 toolkit exists) — otherwise the pass blacks out the dashboards being demoed, by design.
2. **Client org-table reads repointed** to server endpoints on the `resolveVisibleScope` pattern (`api/_utils/schoolScope.ts`) — every repoint shrinks the policy surface; the pass should find near-zero raw browser reads to police.
3. **Schools write path settled** — the class_teachers/user_tags model stable and the open forks (tutor billing shape; assessment-telemetry portability) resolved enough that policies won't be rewritten within weeks.

**Division of labour (the settled architecture — keep it):** RLS answers exactly one question, *"is this my row?"* (own-row + deny-by-default). ALL hierarchy/cross-user authz (teacher⊂school⊂govt) lives in server-mediated endpoints with tests — the deliberate alternative to RLS's silent-fail. Don't author clever RLS policies.

**Runbook when the conditions hold:**
1. Enable RLS on the six org tables (five carry dormant pre-authored policies — verify predicates use `auth.uid()::text`, not stale Clerk-era `jwt->>'sub'`, via `pg_get_expr` before trusting them; `groups` + `entitlement_grants` need policies written).
2. ~~Apply the gated migrations parked in `supabase/migrations/`~~ **DONE 2026-07-05:** both 20260704 gated migrations (`invite_codes` SELECT revoke; course-scoped progress unique keys) were canary-applied live after their code dependencies shipped to main (`6841adc7`) — do not re-apply.
3. Use `rlsGuard.assertScope()` (`packages/player-vue/src/composables/schools/rlsGuard.ts`) as the dev-loop net — extend from `useClassesData` to the other schools composables.
4. Canary method mandatory (toolkit + runbook: `supabase/secfix-toolkit/`): apply in one txn, replay real app queries as real roles, assert leak-closed AND every-legit-path-alive, COMMIT iff green.
5. Stage on `staging` for a full week minimum; every schools view × role (govt_admin, school_admin, teacher, student) exercised; merge to `main` only after zero `[RLS_VIOLATION]` logs for 48h.

**RLS doctrine (standing rules — these are why RLS stopped hurting):**
1. RLS = "is this my row?" only; hierarchy authz = endpoints. Never clever policies.
2. Every REVOKE or policy migration carries its GRANTs in the same file. Symptom split: "permission denied" = grant layer; silent empty = policy layer.
3. No DB-auth change without a canary run (rule 4 above). No exceptions — the March silent-empty era and the June one-night three-lane sweep differ only by this.
4. Identity casts live only in `current_learner_id()`; keep the direct `user_id = auth.uid()::text` disjunct on learners' own-row SELECT (INSERT..RETURNING can't see its row through a STABLE fn).
5. Every new view ships `security_invoker=on`; deliberate DEFINER objects go on a short audited allowlist with view-level GRANTs locked.
6. Every policy/grant migration ends with `NOTIFY pgrst, 'reload schema'`; never reference `auth.users` in a policy — JWT claims only.
7. Every new table gets an explicit posture at creation (RLS on + own-row, or service-role-only) — never Supabase's grant-open default.
8. Convert silent to loud: client code never swallows PostgREST write errors (the false-"Saved" class), and demo data expected to go dark is regenerated first or declared in the pass plan.

**Memory references:** `feedback_supabase_rls.md`, `project_ssi_live_db_security_state.md` in auto-memory carry the full burn history and live-state detail.

---

## Canonical RLS / auth pattern

User-id columns in this DB are mixed-type AND mixed-meaning — there is no single comparison pattern that works everywhere. **Before authoring a policy you must know TWO things about the column: its TYPE and WHICH IDENTITY its values hold.** Two different identities flow through same-shaped columns:

- **auth uid** (`auth.uid()`, the Supabase Auth user id — stored in `learners.user_id`)
- **learner PK** (`learners.id` — the operational identity used across all learner-data tables)

| Column | Type | Values hold | Correct predicate |
|---|---|---|---|
| `learners.user_id`, `schools.admin_user_id`, `classes.teacher_user_id`, `user_tags.user_id`, `govt_admins.user_id` | TEXT | auth uid | `column = auth.uid()::text` |
| every `learner_id` column (sessions, course_enrollments, lego/seed_progress, response_metrics, spike_events, learner_points…, 17 tables — consistent) | UUID | learners.id | `learner_id IN (SELECT id FROM learners WHERE user_id = auth.uid()::text)` — or the `current_learner_id()` helper once the Lane B identity bridge lands |
| `player_events.user_id` | UUID | **learners.id, NOT auth uid** (verified live 2026-06-10: 2000/2000 recent rows match the learner PK, 0 match auth uid; null for guests) | same learner-mapping predicate as above — `= auth.uid()` matches NOTHING despite the uuid type |
| `class_sessions.teacher_user_id` | TEXT | **MIXED — dirty** (81 rows learner.id / 76 auth uid / 8 `guest-<uuid>`, two writer generations) | do not write a policy against this column until the Lane B writer fix + backfill (see `~/Desktop/SSi-secfix-2026-06-09/LANE_B_identity_design.md`) |

**The trap that keeps biting:** the column TYPE does not tell you the identity. A uuid column can hold learner PKs (`player_events`). Verify the VALUES (join a sample against `learners.id` and `learners.user_id`) before writing any new policy.

**Why mixed:** A legacy auth migration (`20251219120000`, never shipped) converted `learners.user_id` from UUID to TEXT and several other columns with it. Those weren't reverted. Newer tables use UUID directly — but not always for the same identity.

**Do not** use any of:
- Wrong cast direction — throws `operator does not exist: uuid = text` (or vice versa) at policy creation time
- `auth.jwt()->>'sub'` — legacy pattern. Evaluates to the same value as `auth.uid()::text` today, but the two definitions could diverge under impersonation or future JWT-claims work. Migration `20260512_unify_user_id_auth_pattern.sql` converted every direct use to one of the two canonical patterns above.

After any policy change, end the migration with `NOTIFY pgrst, 'reload schema';`.

### Identity rationalisation (in progress — Phase 0 landed 2026-06-19)

**Rule: `learners.id` is the ONE canonical identity for all domain data. `auth.uid()` is a login token, translated to `learner.id` once at the edge and never used downstream.** The recurring confusion (player_events keyed on learner.id not auth uid; admin header showing the wrong id) comes from this rule not being *enforced* — so we're enforcing it via naming + one bridge.

- **Bridge function `current_learner_id()`** (migration `20260619_current_learner_id_bridge.sql`) = `auth.uid()` → `learners.id`. Use it in new RLS policies and server resolution instead of hand-rolling the join. It's the single translation point.
- **Naming convention (target):** a column holding the auth uid is named `auth_user_id`; a column holding the learner PK is named `learner_id`. The name must state the identity — type does not (a `uuid` column can hold either; `player_events.user_id` is `uuid` but holds learner.id).
- **Live inventory (2026-06-19):** `learner_id` (18 tables, all uuid, all learners.id — the clean pattern). Offenders to rename via expand-contract: `player_events.user_id` (uuid, learner.id → `learner_id`); the auth-uid `user_id`/`*_user_id`/`created_by`/`changed_by_uid` columns (learners, govt_admins, user_tags, schools.admin_user_id, classes/class_sessions.teacher_user_id, role_change_audit, content_feedback, conversations, tester_feedback → `auth_user_id`).
- **Sequencing:** renames are expand-contract (dev/staging/prod share ONE DB, so a bare rename breaks un-deployed code). Auth-uid renames touch ~20 RLS policies → gated to the "tighten RLS before first paying school" window. **Multiple accounts per person are intentional (tester accounts) — do NOT merge learners.**

---

## Project Overview

**SSi Learning App** is the language learning player application that delivers SSi courses to learners. It's built as a monorepo with a framework-agnostic TypeScript core and UI adapters.

### Quick Facts
- **Purpose**: Content delivery and learning experience (NOT content creation)
- **Architecture**: Monorepo with `@ssi/core` package + Vue 3 SPA
- **Current UI**: Vue 3 player (`player-vue`) — unified SPA serving learners + schools
- **Schools**: Fully implemented at `/schools` path within player-vue
- **Future**: PWA (`apps/web`) for community courses
- **Deployment**: Vercel (staging.saysomethingin.app / saysomethingin.app)
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
│  • Phase 9: Manifest compilation         • /schools in player-vue        │
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
  └→ Supabase: course_audio

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
│   │   │   ├── engine/          # Cycle types & interfaces (CyclePhase, ICycleOrchestrator)
│   │   │   ├── learning/        # TripleHelix, SpacedRepetition, Adaptation
│   │   │   ├── data/            # Type definitions for LEGOs, Seeds, Phrases
│   │   │   ├── config/          # Configuration defaults and types
│   │   │   ├── cache/           # (stale — does NOT exist; real offline stack is in player-vue: cache/AudioCache.ts, composables/useScriptCache.ts, useOfflineDownloadStatus.ts, useOfflineLease.ts)
│   │   │   └── persistence/     # ProgressStore, SessionStore, SyncService
│   │   └── package.json
│   ├── player-vue/              # Vue 3 unified SPA (learning + schools)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── LearningPlayer.vue   # Main player component
│   │   │   │   ├── SessionComplete.vue  # Session summary screen
│   │   │   │   └── schools/             # 21 schools UI components
│   │   │   ├── views/schools/           # 12 schools dashboard views
│   │   │   ├── composables/schools/     # 16 schools composables
│   │   │   ├── containers/SchoolsContainer.vue  # Schools layout + auth
│   │   │   └── App.vue
│   │   └── public/audio/        # Demo audio files (bundled)
│   ├── ui/                      # Shared UI components
│   └── demo/                    # Demo content
├── apps/
│   ├── web/                     # PWA for community courses (TODO — not yet created)
│   └── schools-dashboard/       # Doc-only dir (schools live in player-vue/src/views/schools/)
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

### Design: "Mist" — the single theme (light mode)
- **One theme, forced for everyone.** `composables/useTheme.ts` pins `data-theme="mist"`; `toggleTheme`/`setTheme` are no-ops and `isDark()` always returns false. The old dark theme (`cosmos`, formerly written up as "Moonlit Dojo" / "Deep Space Constellation") is **deprecated — do not reintroduce dark mode or a theme switcher.**
- Light palette: warm-grey canvas (`--bg-primary: #e8e3dd`), white elevated surfaces, browser chrome `#D9D6D2`. Tokens in `styles/design-tokens.css` under `[data-theme="mist"]`.
- A single belt-coloured accent (by current belt) carried through the UI — "Schindler's List" restraint.
- Management/admin surfaces (everything outside the player) follow the **Frostwell Courtyard** canon — see `docs/frostwell-courtyard.md`.

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

## Schools Dashboard (`/schools`)

The schools dashboard is **fully implemented** within `player-vue` as a path-based sub-application. It is NOT a separate app — it shares the same Vercel deployment.

### URL Structure
```
saysomethingin.app/schools              → Dashboard home
saysomethingin.app/schools/teachers     → Teachers view
saysomethingin.app/schools/students     → Students view
saysomethingin.app/schools/classes      → Classes (teacher view)
saysomethingin.app/schools/classes/:id  → Class detail
saysomethingin.app/schools/analytics    → Analytics & reporting
saysomethingin.app/schools/settings     → School settings
saysomethingin.app/schools/setup        → Admin setup (guarded)
saysomethingin.app/schools/all          → Govt admin view (all schools)
saysomethingin.app/schools/student-progress → Individual student view
```

### Architecture
- **Container**: `SchoolsContainer.vue` handles auth (OTP email login), role checks, and join codes
- **Roles**: govt_admin, school_admin, teacher, student
- **Data**: All composables query Supabase directly (schools, classes, students, analytics)
- **Demo mode**: All composables support demo data for testing without Supabase
- **Auth**: Email OTP signin inline (no modal), join codes for teacher/admin onboarding

### Features (Implemented)
- Class roster management
- Course assignment to classes
- Progress visualization (per-student, per-class, per-school)
- Analytics and daily activity reporting
- Teacher and student management
- School settings and admin setup
- Admin read-views at `/admin/schools/:id`, `/admin/groups/:id`, `/admin/classes/:id`, `/admin/users/:learnerId/progress` let ssi_admins see any school/group/class/user's dashboard under their own Supabase session — no client-side impersonation. RLS-ready: when policies tighten, admin access flows through admin-bypass rules, not a fake identity.
- Multi-tenant (each school manages own data)

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
-- course_audio = audio files (voice config lives on courses table)

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

-- Get audio
SELECT id, duration_ms, s3_key
FROM course_audio
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

> ⚠️ **Stale (last refreshed 2026-04-11).** For the live "what's next", see [`WORKLIST.md`](./WORKLIST.md) at repo root — that is the single source of truth for current directions, builds, and open questions. The list below is kept only as historical context.

### Completed
- [x] CycleOrchestrator state machine
- [x] 4-phase learning cycle
- [x] RealAudioController (mobile-compatible)
- [x] Vue player with the Mist theme (single forced light theme; dark mode deprecated)
- [x] Belt progression system
- [x] Session summary screen
- [x] Dynamic pause duration (2x target audio)
- [x] Real Italian/Spanish course audio integration
- [x] Database-first architecture (Supabase data provider)
- [x] IndexedDB cache layer
- [x] Audio caching with backend proxy (v2.2.0)
- [x] Lazy loading for instant startup (v2.3.0)
- [x] PriorityRoundLoader with belt-aware loading
- [x] Recovery mode (`?reset=1`)
- [x] PWA with service worker caching

### In Progress
- [ ] Schools dashboard integration testing
- [ ] Course Explorer QA mode refinements

### Next Up
- [ ] Triple Helix thread switching implementation
- [ ] A/B testing framework integration

### Future
- [ ] Speech recognition during PAUSE phase
- [ ] Adaptive difficulty based on response latency

---

## Critical Rules for Agents

### DO
- Use `@ssi/core` for all learning logic
- Reuse the single Audio element for mobile compatibility
- Respect the 4-phase cycle order
- Test audio playback on mobile Safari
- Follow the Mist theme (single light theme: warm grey, white surfaces, one belt-colour accent) — do NOT add dark mode or a theme switcher
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
| `packages/player-vue/src/playback/SimplePlayer.ts` | Main 4-phase cycle playback engine (state machine) |
| `packages/core/src/engine/types.ts` | Cycle phases (`CyclePhase`), events, `ICycleOrchestrator` interface |
| `packages/core/src/data/types.ts` | LEGO, Seed, Phrase types |
| `packages/player-vue/src/components/LearningPlayer.vue` | Main player UI |
| `packages/player-vue/src/components/SessionComplete.vue` | Session summary |
| `packages/player-vue/src/composables/useScriptCache.ts` | Script caching |
| `packages/player-vue/src/composables/useMetaCommentary.ts` | Intro messages |
| `packages/player-vue/src/composables/useBeltProgress.ts` | Belt progression tracking |
| `packages/player-vue/src/playback/computePauseDuration.ts` | Dynamic pause-duration calc (re-export shim → `@ssi/core`) |
| `packages/player-vue/src/playback/adaptationOverrides.ts` | Adaptation-v2 play-time overrides on SimplePlayer |
| `packages/player-vue/src/playback/bulkAudioDownload.ts` | Batch offline audio download (presigned S3) |
| `packages/player-vue/src/playback/silentWav.ts` | Silent WAV `data:` URIs for background/lock-screen gaps |
| `packages/player-vue/src/types/Cycle.ts` | Atomic Cycle type definition |
| `packages/player-vue/src/containers/SchoolsContainer.vue` | Schools layout + auth + routing |
| `packages/player-vue/src/views/schools/DashboardView.vue` | Schools dashboard home |
| `packages/player-vue/src/views/schools/SetupView.vue` | Admin school setup |
| `packages/player-vue/src/composables/schools/` | Schools data layer (16 composables) |
| `packages/player-vue/src/router/index.ts` | All route definitions incl. /schools |
| `apml/ssi-learning-app-master.apml` | Full APML specification |
| `apml/playback/lazy-loading.apml` | Lazy loading architecture spec |
| `apml/cache/audio-architecture.apml` | Audio caching spec |
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
> **Historical (Jan 2026 plan snapshot).** As-shipped, only `types/Cycle.ts` and `composables/useCyclePlayback.ts` exist; `utils/validateCycle.ts` and `components/CyclePlayer.vue` were never created — the playback engine landed as `playback/SimplePlayer.ts` instead.
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
- **IMPORTANT**: All AWS env vars use `.trim()` to handle trailing newlines from copy-paste

### Two-Layer Caching
1. **IndexedDB (`cache/AudioCache.ts`)**: App-controlled, readable blobs for offline play (tier-aware store `ssi-audio-cache-v2`)
2. **Service Worker (Workbox)**: Browser-controlled, CacheFirst strategy for `/api/audio/*`

### Prefetch / Cache-Ahead
- **Files**: `packages/player-vue/src/cache/AudioCache.ts`, `composables/useScriptCache.ts`, `composables/useOfflinePlay.ts` (the standalone `usePrefetchManager.ts` was removed; cache-ahead now lives across the offline/cache stack)
- **Target**: cache ahead during active play (the historical "30 minutes ahead" figure predates the current stack — needs owner confirmation)
- **Silent**: Never interrupts playback on prefetch errors

### Graceful Degradation
- **File**: `packages/player-vue/src/composables/useOfflinePlay.ts`
- **Hierarchy**:
  1. Normal: Play scheduled cycle
  2. Belt-only: Play any cached cycle
  3. USE phrases: Play mastered content
  4. Repeat: Loop last successful cycle

### Offline / Bulk Downloads
- Bulk offline download resolves a batch of audio ids to presigned S3 URLs in one request, then fetches directly (`playback/bulkAudioDownload.ts`), bypassing the per-file `/api/audio/:id` proxy.
- Download status is shared via `composables/useOfflineDownloadStatus.ts`; offline leases via `composables/useOfflineLease.ts`.
- (The older resumable-download / "persist across restarts, resume within 24h, belt/2h/5h/full-course" options described a removed `DownloadManager` — needs owner confirmation against the current bulk-download flow.)

### Analytics (player_events.audio_play)
Every audio play is tracked client-side via `player_events`:
- user_id, course_code, session_id, occurred_at on the event row
- payload: { url, role, legoId, cycleId, cycleType, playbackSpeed }
- `audio_plays` was dropped 2026-05-19 — SW CacheFirst means the proxy only sees cache misses, useless as a play log. `player_events.audio_play` is the source of truth.

### Key Files
| File | Purpose |
|------|---------|
| `api/audio/[audioId].ts` | Vercel serverless proxy |
| `packages/player-vue/src/cache/AudioCache.ts` | Tier-aware IndexedDB audio cache |
| `packages/player-vue/src/cache/resolvePlaybackUrl.ts` | Audio id → playable (lock-screen-safe) URL |
| `packages/player-vue/src/composables/useScriptCache.ts` | Script + cache-ahead |
| `packages/player-vue/src/composables/useOfflinePlay.ts` | Graceful degradation |
| `packages/player-vue/src/config/audioConfig.ts` | URL builder & config |
| `packages/player-vue/src/playback/bulkAudioDownload.ts` | Batch offline audio download |
| `apml/cache/audio-architecture.apml` | Full architecture spec |

---

## Lazy Loading Architecture (v2.3.0)

Instant startup with smart background loading based on user intent probability. **Core principle: first play in < 2 seconds.**

### The Problem (Before)
```
App starts → Load ALL LEGOs (1000) → Build ALL rounds → PLAY
              └── 5-7 seconds of waiting
```

### The Solution (After)
```
App starts → Load Round N → PLAY     Background: load rest by priority
              └── < 2 seconds        └── seamless continuation
```

### Instant playback / incremental round loading
- **File**: `packages/player-vue/src/composables/useInstantPlayback.ts` (sub-second time-to-first-play); rounds are built via `providers/generateLearningScript.ts` → `providers/toSimpleRounds.ts` → `SimplePlayer.initialize()`, and added incrementally with `SimplePlayer.addRounds()` / `appendRounds()`.
- **Purpose**: play the first round fast, then extend the queue in the background.

> **Historical note**: the standalone `PriorityRoundLoader.ts` (belt-priority background loading — round N → N+1 → first-of-next-belt → rest) was removed. Background loading now rides `useInstantPlayback` + the round-builder pipeline above; the exact priority ordering below is historical and needs owner confirmation against the current pipeline.
>
> 1. Round N (BLOCKING) 2. Round N+1 3. First of next belt 4. Rest of current belt 5. Rest of next belt 6. Belt-by-belt forward

### Belt Thresholds
```
White (1-7) → Yellow (8-19) → Orange (20-39) → Green (40-79) →
Blue (80-149) → Purple (150-279) → Brown (280-399) → Black (400+)
```

### CourseDataProvider Lazy Methods
```typescript
// Single item load (~50ms)
loadLegoAtPosition(seedNumber: number): Promise<LearningItem | null>

// Range load (~100-200ms for 10 items)
loadLegoRange(startSeed: number, endSeed: number): Promise<LearningItem[]>

// Batch basket load (one query instead of N)
getBasketsBatch(legoIds: string[]): Promise<Map<string, ClassifiedBasket>>
```

### SimplePlayer Incremental Methods
```typescript
// packages/player-vue/src/playback/SimplePlayer.ts
addRounds(newRounds: Round[])       // Add rounds (dedupes by legoId)
appendRounds(newRounds: Round[])    // Append without dedupe (infinite-play)
hasRound(roundNumber: number)       // Check if round exists
```

### Course End Detection
When `loadLegoAtPosition(seed)` returns null:
1. Detect course end once
2. Clear loading queue
3. Log summary: "Course end detected at seed 305"
4. No spam logging for seeds beyond course end

### Key Files
| File | Purpose |
|------|---------|
| `packages/player-vue/src/composables/useInstantPlayback.ts` | Sub-second time-to-first-play |
| `packages/player-vue/src/playback/SimplePlayer.ts` | Incremental round management (`addRounds`/`appendRounds`) |
| `packages/player-vue/src/providers/toSimpleRounds.ts` | ScriptItem[] → SimplePlayer Round[] |
| `packages/player-vue/src/providers/CourseDataProvider.ts` | Lazy loading methods |
| `apml/playback/lazy-loading.apml` | Full architecture spec |

---

## Recovery Mode

For users stuck in broken states (corrupted cache, infinite loops, etc.).

### URL Parameter: `?reset=1`
Navigate to `https://app.saysomethingin.com?reset=1` to:
- Clear localStorage
- Clear sessionStorage
- Clear IndexedDB
- Unregister all service workers
- Clear all caches
- Reload clean

**File**: `packages/player-vue/src/App.vue` (lines 12-42)

### When to Use
- App won't load or shows blank page
- Audio won't play despite being online
- PWA update stuck
- "Google new tab" behavior reported

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

*Last updated: 2026-07-17 (Key Files / playback / cache file map corrected to the real SimplePlayer + AudioCache stack)*
*Status: v2.3.0 - Lazy loading for instant startup | Schools dashboard fully implemented at /schools*
