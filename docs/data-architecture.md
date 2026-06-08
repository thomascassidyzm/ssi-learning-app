# SSi data architecture — the two categories

> The reference that replaces folklore. If you're about to touch a table, an RLS
> policy, or a dashboard query and you're not sure "whose data is this and who's
> allowed to see it" — start here. Drafted 2026-06-08.

## The category error (read this first)

Most of the pain in this database comes from one mistake: **two completely
different jobs are forced through the same tables with the same access rules.**

1. **Operational — the learner's own record.** What the player writes every few
   seconds while someone learns: progress, cursor, session, the welcome flag.
   One writer. One owner. Wants to be *trivial*: a learner writes their own row.

2. **Observability — the inspection surface.** What **admins, teachers,
   school-leaders, tutors** need to *see* about learners: progress reports,
   class/school rollups, cross-tenant analytics. Many readers, role-scoped,
   tenant-aware. A completely different access shape.

These are not the same thing. A *database for a learner doing a course* is not a
*reporting system for the people who oversee them*. When you make one table
(`lego_progress`, `sessions`) be **both** — the learner's private scratchpad
**and** the teacher's report source — no single access policy makes both
pleasant. That conflation is why RLS here feels like a knife fight. It is not RLS
that's broken; it's that the two jobs were never separated.

## The shape that fixes it

One direction of flow. The learner writes **once**, to their own record. The
inspection surface is **derived** from that — observers read the derived model,
never the raw record.

```
   learner acts
        │  writes their OWN record         ← operational (own-row, trivial)
        ▼
  ┌─────────────────┐     emits      ┌──────────────────────┐
  │ learner record  │ ─────────────▶ │  player_events        │  append-only spine
  │ (progress, etc.)│                │  (every action, kept) │
  └─────────────────┘                └───────────┬──────────┘
                                                  │ derive
                                                  ▼
                                   ┌──────────────────────────┐
                                   │ observability read-model  │ ← role-scoped
                                   │ (rollups / reporting views)│
                                   └───────────┬──────────────┘
                                               │ read (scoped)
                                  admins · teachers · leaders · tutors
```

The key move: **observers read the derived model, not the operational tables.**
Then each side has exactly one job and one coherent access rule:

| | Owner | Writers | Readers | Access rule |
|---|---|---|---|---|
| **Operational** | the learner | the learner (one) | the learner (+ admin bypass) | own-row by `auth.uid()` |
| **Observability** | the org / platform | the system (derived) | many roles, scoped | role/tenant scope on the read-model |

## SSi already has the spine

`player_events` is append-only, captures every learner action, and is keyed to
the learner. **That is the natural substrate for all inspection.** The error
today is that the schools dashboards read the *raw operational tables*
(`lego_progress`, `sessions`, `class_activity_stats` over live joins) directly,
with hierarchy RLS bolted on — i.e. the conflation. The fix is to derive the
observability read-model from events (and/or maintained rollups), and let the
operational tables go back to serving only the learner.

## Mapping today's tables

| Category | Tables | Notes |
|---|---|---|
| **Operational (learner-owned)** | `lego_progress`, `sessions`, `course_enrollments`, `learner_points/milestones`, `response_metrics`, `spike_events`, `learners` (the learner's own record incl. `welcome_played_at`) | Want own-row RLS keyed on `auth.uid()`. The learner writes these; nobody else needs to. |
| **Observability (read-model)** | `player_events` (the spine), `class_activity_stats`, `demographic_cycle_averages`, the schools reporting views, future rollups | Role-scoped reads. Should be **derived**, not the raw operational tables. ⚠ the views currently bypass RLS (`security_invoker=off`) — a leak; see the identity-architecture doc. |
| **Content (neither)** | `course_seeds/legos/audio/courses`, `canonical_*` | Shared, public-read, permissive by design. Not learner data; no RLS. |
| **Reference / config** | `regions`, `classes`, `schools`, `user_tags` (membership) | Defines the tenancy graph the observability scope walks. Admin/server-written. |

## Why this dissolves the everyday pain

- **The welcome flag** (worked example, shipped 2026-06-08): it's the learner's
  own record → `learners.welcome_played_at`, written through a controlled bridge
  (service-role endpoint, because `learners` is column-locked today). Under the
  clean model with real identity, that's just an own-row write — no endpoint
  needed. The friction we hit was the tax of being half-way.
- **Teacher reports** never touch the learner's write path → no "make one table
  do two jobs" RLS. They read a scoped read-model.
- **Identity is the keystone.** Operational own-row only works if every writer
  has a real `auth.uid()`. Today most learner rows have synthetic ids and the
  app writes as the anon key — which is the actual root cause behind the RLS
  thrash. Fixing identity (see `SSi-rls-on-identity-architecture` design) makes
  the operational side trivially correct and lets the observability side be
  built cleanly on top.

## One Postgres or two?

**Two models, not necessarily two boxes.** For now both live in one Postgres:
operational tables + the `player_events` log + derived rollup tables/views. A
separate physical **reporting/analytics store** can come later *if it earns it*
(heavy analytical load, different scaling, warehouse tooling). Don't pay for a
second database before the *model* is clean — pay for the conceptual split first.
The split is what removes the pain; the second box is just an optimisation.

## Rules of thumb (use these when adding anything)

1. **"Whose record is this?"** If it's the learner's own state → operational,
   own-row, the learner writes it. If it's something an overseer reads about
   learners → observability, derived, role-scoped.
2. **Never let an overseer read the operational table directly.** Give them the
   read-model. If the read-model doesn't have it yet, that's the gap to fill —
   don't widen access to the raw table.
3. **Emit an event for anything inspectable.** `player_events` is the spine; if a
   new behaviour matters to a teacher/admin, emit it, then derive the view.
4. **A learner writes their own row.** If that's currently blocked (column locks,
   RLS off), the right bridge is a server endpoint *today* and own-row RLS *after
   identity is fixed* — not widening client grants on shared tables.

## Related
- `cold-start-and-playback.md` — the player's operational read/write path.
- `SSi-rls-on-identity-architecture.md` (Desktop) — the identity model that makes
  operational own-row real and closes the anon-key exposure. The views-bypass-RLS
  leak is a hard prerequisite flagged there.
