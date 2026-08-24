# SSi data architecture — records, relationships, and the inspection surface

> The reference that replaces folklore. Before you touch a table, an RLS policy,
> or a dashboard query and you're unsure "whose data is this and who's allowed to
> see it" — start here. Drafted 2026-06-08; reworked 2026-06-08 to make ownership
> a **relationship, not a column** (the schools + tutoring reality forced it).

## The category error (read this first)

Most of the pain in this database comes from one mistake: **different jobs forced
through the same tables with the same access rules.**

1. **Operational — someone's own record.** What the player writes while learning:
   progress, cursor, session, the welcome flag. Wants to be *trivial*: a clear
   owner writes their own row.
2. **Observability — the inspection surface.** What overseers (admins, teachers,
   school-leaders, tutors) need to *see* about learners: reports, class/school
   rollups, cross-tenant analytics. Many readers, role-scoped, tenant-aware — a
   different access shape entirely.

A *database for someone doing a course* is not a *reporting system for the people
who oversee them*. When one table is **both** — the private scratchpad **and** the
report source — no single policy makes both pleasant. That's why RLS here feels
like a knife fight. It isn't RLS that's broken; the jobs were never separated.

But there's a subtler conflation underneath — the one schools and tutoring expose:

## Ownership is a relationship, not a column

The first draft said "operational = the learner owns their own row." Too simple.
In the real product **who "owns" a learner's data changes**: a kid moves class,
changes school, leaves, gets taken on (or dropped) by a tutor. If ownership is a
*column on the record*, every one of those is a painful migration. So split it:

- **The learning RECORD** — progress, mastery, history. Belongs to a *persistent
  identity* and is **portable**: it survives moving class, changing school,
  leaving, being orphaned. Never owned by a teacher, a class, or a tutor.
- **The AFFILIATION** — "this learner is in Ms X's class" / "this student belongs
  to tutor Y." A **mutable, time-bounded relationship**, not ownership. It grants
  *visibility* and drives *billing*.

**Ownership isn't a column on the record — it's an edge in a relationship graph
that can change without the record moving.** Move class / change school / finish /
get-orphaned = an edge ends (maybe a new one begins). The record stays put.
Visibility and price **recompute from the current edges**.

## Three layers

1. **Record** — the learning asset. Own-row, keyed to a *persistent person*, not
   an affiliation. (Two kinds — see below.)
2. **Affiliation graph** — who-relates-to-whom, with **role + validity**. The
   single source of *both* observability scope *and* billing.
3. **Entitlement** — derived from {affiliation graph} × {payment state}. Reads the
   graph; never lives on the learner's row. (e.g. ACT: £10/mo under a paying tutor
   vs £15 independent; £5/student/active-month payout; orphaning when a tutor stops
   paying → edge expires → entitlement recomputes.)

## Two kinds of record (the schools insight)

Class progress and individual progress are **different objects**, not the same
thing at different zoom. Class play is *collective by nature* — a choral
chant-along can't honestly be attributed to one kid, and the teacher doesn't want
it to be. So:

- **Class record** — collective, **teacher/class-owned**, written by class play.
  *The class's journey.* No per-student identity needed in class — kids just play.
  (Zero per-student onboarding friction, which is what makes schools viable.)
- **Personal record** — **person-owned, portable, optional**, written by solo /
  catch-up / homework. Exists only once someone has an account. *This* is what
  survives leaving.

So "don't lose your progress when you leave" **dissolves**: the class record was
never the individual's to lose; their personal account — what's genuinely theirs —
persists. (Chosen by **better × simpler × cheaper**: collective wins on all three —
no attribution of un-attributable group play, no 30-account provisioning, and it
matches what class play actually *is*.)

## The inspection surface is derived — `player_events` is the spine

`player_events` is append-only, captures every action, keyed to the learner.
**That is the natural substrate for inspection.** Observers read a **derived
read-model** (rollups / reporting views) scoped by walking the affiliation graph —
*never the raw operational tables*. Today's error: schools dashboards read
`lego_progress` / `sessions` / live joins directly with hierarchy RLS bolted on —
the conflation. Fix: derive the read-model from events + the graph; let the
operational tables serve only their owner.

(Honest note: the spine genuinely buys append-only + one read-model, but the
tenancy scope-walk — learner → class → school — is the same work either way. The
win is *where* it lives and that it's read-only, not that the join vanishes.)

```
   acts (class OR solo)
        │  writes the owning record        ← operational
        ▼
  ┌──────────────────┐   emits   ┌──────────────────────┐
  │ class / personal │ ─────────▶ │  player_events        │  append-only spine
  │ record           │           │  (every action, kept) │
  └──────────────────┘           └───────────┬──────────┘
            ▲ affiliation edges              │ derive (scoped by the graph)
            │ (role + validity)              ▼
   class · school · tutor         ┌──────────────────────────┐
   (the tenancy graph) ─────────▶ │ observability read-model  │ ← role-scoped
                                  └───────────┬──────────────┘
                                              │ read (scoped)
                                 admins · teachers · leaders · tutors
```

## Mapping today's tables

| Layer | Tables | Notes |
|---|---|---|
| **Record — personal** (person-owned, portable) | `lego_progress`, `sessions`, `course_enrollments`, `learner_points/milestones`, `response_metrics`, `spike_events`, `learners` (own record incl. `welcome_played_at`) | Own-row, keyed to a *persistent person*; survives affiliation changes. |
| **Record — class** (collective, teacher-owned) | *(target)* one class-scoped journey owned by the teacher | Today this is fragmented / entangled with per-student tables (e.g. `class_student_progress`) — **reconcile to a single class record**; no per-student identity. |
| **Affiliation graph** | `classes`, `schools`, `user_tags` (membership), `regions`; tutor↔student rosters *(ACT — to build)* | Edges with role + validity. Source of *both* observability scope *and* billing. |
| **Entitlement** | subscription / payment state (Paddle) + derived price/payout | Reads the graph; not on the learner's row. ACT pricing/payout/orphaning = future. |
| **Observability** (read-model) | `player_events` (spine), `class_activity_stats`, `demographic_cycle_averages`, schools reporting views, future rollups | Role-scoped, **derived**. ⚠ views currently bypass RLS (`security_invoker=off`) — a leak; see identity doc. |
| **Content** (none of the above) | `course_seeds/legos/audio/courses`, `canonical_*` | Shared, public-read, permissive. Not learner data; no RLS. |

## Identity is the keystone

The keystone isn't "an `auth.uid()` per writer" — it's **a persistent *person*
identity the record hangs off, independent of any school/class/tutor.** That's what
makes portability *automatic* rather than a migration. Today most learner rows have
synthetic ids and the app writes as the anon key — the actual root cause behind the
RLS thrash. And the guest-first reality is fine, not a problem: **a learner needn't
have an account at all** (class play, casual use) — they're simply part of the
collective with no personal record until they claim one. See
`SSi-rls-on-identity-architecture`.

## Play to the stalls — the 95%, and the tail we deliberately park

This model nails the common cases. The long tail is **named and parked, not
legislated** — the last few percent of coverage costs a fortune (Pareto +
diminishing returns):

- **No-account class kid leaves school** → carries no personal record. Honest —
  they never had a personal track. *Parked sweetener (later, not now): on making an
  account, let them claim a starting snapshot seeded from their class's level.*
- **Tutor stops paying → students orphaned** → affiliation edges expire; entitlement
  recomputes (revert to £15, or join another roster). The *mechanics* (grace period,
  re-home flow) are graph operations — specified when ACT ships, not now.
- **A learner in two places at once** (class + own tutor) → multiple concurrent
  edges; scope is the union. Fine in the model; UI/billing details deferred.

## One Postgres or two?

**Two models, not necessarily two boxes.** For now it all lives in one Postgres:
the records + the `player_events` spine + derived rollups. A separate
reporting/analytics store can come later *if it earns it* (heavy analytical load,
warehouse tooling). Pay for the **conceptual split first** — that's what removes the
pain; the second box is just an optimisation.

## Rules of thumb (use these when adding anything)

1. **"Whose record is this — collective or personal?"** Class play → class record
   (teacher-owned). Solo/catch-up → personal record (person-owned, portable).
   Overseer reading about learners → observability (derived, scoped).
2. **Ownership is an edge, not a column.** Moving / orphaning / re-homing ends or
   begins an affiliation edge — it never rewrites the record.
3. **Never let an overseer read the operational table directly.** Give them the
   read-model. Missing data there is the gap to fill — don't widen access to the raw
   table.
4. **Emit an event for anything inspectable.** `player_events` is the spine; new
   inspectable behaviour → emit it, then derive the view.
5. **A persistent person owns their record.** Portability is automatic once identity
   is real; until then, a server bridge — not widened client grants on shared tables.
6. **Don't legislate the tail.** Cover the 95%; name-and-park the edge cases.

## Related
- `cold-start-and-playback.md` — the player's operational read/write path.
- `SSi-rls-on-identity-architecture.md` (Desktop) — the persistent-person identity
  that makes portability + own-row real and closes the anon-key / views-bypass-RLS
  leak. A hard prerequisite.
