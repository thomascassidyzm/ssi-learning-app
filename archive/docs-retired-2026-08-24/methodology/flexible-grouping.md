# Flexible grouping — the tag vocabulary above the class, and how a leader declares scope

*The open design area left by `tutor-insights.md` §5/§7: once the class is a first-class learner-equivalent, how do the levels **above** the class — year, department, faculty, key stage, whole school, chain — get expressed and read, without inventing a rigid hierarchy per shape. Built to be argued with.*

**Status:** Think-piece — Claude, 2026-06-14. Depends on nothing new; the teacher↔class relationship (`class-first-class-citizen.md`) is the prerequisite and is independent of this. The two engine boards this feeds (coverage, and the leader roll-up of it) already exist demo-first (`CoverageBoard.vue`); this is the design for *scoping* them above one class.
**Companions:** `tutor-insights.md` (the two lanes; §2 coverage, §5 the data-model sketch), `class-first-class-citizen.md` (teacher↔class + class→school + the grouping follow-on), `insight-engine.md` (the roll-up = same query at a higher `GROUP BY`).

---

## 1. The cut: one *belonging*, many *groupings*

There are two genuinely different relationships above the class, and conflating them is the trap.

- **Belonging is singular and hard.** A class belongs to exactly one school; a school sits in (at most) one chain/authority of record. This is a real FK — `classes.school_id`, kept NOT NULL except for the ACT no-school tutor. It is *not* a tag, because it carries entitlement, billing, and the data-ownership boundary. There is one true answer to "whose class is this," and it must not be expressible two ways.
- **Grouping is plural and soft.** *Above* the belonging, a school cuts its own classes many ways **at once**: by year (Year 7), by department (MFL), by faculty (Humanities), by key stage (KS3), by a pastoral house, by an intervention cohort ("catch-up Spanish"), by whole-school. None of these is *the* hierarchy; a class is legitimately in several at once (Year 7 **and** MFL **and** KS3). So grouping must be **overlapping membership**, never a folder path.

The whole point: **belonging is a tree-of-one (an FK); grouping is a set-of-many (tags).** The schema already leans this way — students relate to classes via `user_tags`, classes belong to schools via FK — and §5 of tutor-insights asks us to finish it for the layer above the class.

## 2. The decision: tags, not a tree (and lean off the `groups` path-tree)

There is a rigid `groups` path-tree in the schema today (the `groups.path LIKE ...` subtree the demo-suite and govt-admin scoping use). **Do not build the year/department/faculty layer on it.** A path-tree forces every class into exactly one position in exactly one hierarchy, which is precisely the false constraint — a class can't be both "under Year 7" and "under MFL" in a single tree without duplicating the node or picking a winner. Every school that has ever used a VLE has felt this.

Instead, a class (and, one level up, a school) carries **overlapping group memberships** expressed as relationship rows of the same shape we already use for teachers and students:

```
group_tags(
  subject_type   text   -- 'class' | 'school'   (what is being grouped)
  subject_id     uuid   -- the class.id or school.id
  group_kind     text   -- 'year' | 'department' | 'faculty' | 'key_stage' | 'house' | 'cohort' | 'whole_school' | 'chain'
  group_value    text   -- 'Year 7' | 'MFL' | 'Humanities' | 'KS3' | ...   (free-ish, per-school vocabulary)
  added_at, removed_at  -- time-bounding, same as user_tags (a class moves up a year; a cohort dissolves)
  added_by
)
```

This is deliberately the **third instance of the one pattern** — `user_tags(role='student')`, `user_tags(role='teacher')` (the class-first-class-citizen move), and now `group_tags`. Same shape, same time-bounding, same merge-trivial additive posture. We are not inventing grouping machinery; we are applying the relationship primitive one level up. (Whether this is literally a new `group_tags` table or a widened `user_tags` with `subject_type` is a detail for the build doc; the *shape* — overlapping, time-bounded, kind+value — is the decision here.)

> **Note on `group_kind` vocabulary.** The *kinds* (`year`/`department`/…) are a small closed-ish enum we own (so the UI and the roll-up can reason about them); the *values* (`Year 7`/`MFL`/…) are the school's own free vocabulary. A school never has to fit its departments into our names — only into our **shapes**. That split is what lets one engine serve a Welsh primary's "Blwyddyn 5" and an English secondary's "Humanities faculty" without a schema change.

## 3. How a leader declares scope

A leader's question is always "show me *my* scope, rolled up." Scope is **not** a position in a tree; it's a **predicate over group_tags** the leader is entitled to:

- A **head of MFL** has scope = `group_kind='department' AND group_value='MFL'` within their school → every class tagged into MFL, regardless of year.
- A **head of Year 7** has scope = `group_kind='year' AND group_value='Year 7'` → every Year-7 class across departments.
- A **school leader** has scope = the school (the FK belonging) → all its classes.
- A **chain / multi-academy-trust lead** has scope = `group_kind='chain' AND group_value=<their chain>` over *schools* → every school in the chain, each rolled up.

So "declaring scope" is two moves: (1) the leader is **granted** a scope predicate (an entitlement row — *this user leads MFL at this school*), and (2) the engine renders the coverage/attention boards `GROUP BY` the entity at that scope. Crucially the leader picks from **their own school's actual group vocabulary** (the distinct `group_value`s that exist), never a free-text box — the vocabulary is discovered from the data, so there's no "MFL" vs "M.F.L." drift.

This is the `insight-engine.md` §5 promise made literal: `learner → class → group → school → chain` is **the same coverage query at a higher `GROUP BY`**, where "group" is just "the set of classes matching the leader's scope predicate." No new board per level; one board, parameterised by scope.

## 4. Sovereignty / privacy carries up unchanged

The `insight-engine.md` §7 sovereignty rule applies verbatim, just at a higher entity: a leader has **visibility over entities within their own scope**, so named within-scope comparison is fine (a head of MFL may see "Year 7 Blue is the fastest of my MFL classes"). Anything shown **across** a leader's scope boundary — a department head peering at another department, a class ranked against a national aggregate — stays **entity-vs-aggregate with the k-floor**, never named. The scope predicate *is* the privacy boundary: inside it, named; outside it, aggregate-only. This falls out for free because the predicate already defines "mine."

And per tutor-insights §2, the rolled-up view carries **only coverage-lane data** (the class's own pace/dosage/efficiency, which is legitimately the class's). It never fabricates per-pupil execution out of collective class play; the attention lane stays homework-sourced and per-pupil, and does not roll up into a leader's coverage scope.

## 5. What this deliberately does NOT do

- **No new hierarchy table, no path strings, no per-shape schema.** Adding "group by house" later is *data*, not a migration.
- **No second source of truth for belonging.** A class's school stays the FK; `group_kind='chain'` over *schools* is the only place chain membership lives, and it's read-only roll-up scope, not ownership.
- **No grouping for the ACT tutor.** An ACT class has `school_id = null` and exactly one tutor; it has no department or year. Grouping is a schools-only concern (same reasoning as co-teaching/supply being schools-only in tutor-insights §5).
- **No build before a consumer.** The only consumer today is the coverage board's roll-up scope. Ship the `group_tags` shape + the school-leader scope first (it needs *zero* grouping rows — the school FK already defines it), then add the department/year scope when a real school asks to cut it that way. Earn-it, per BSC.

## 6. Better × Simpler × Cheaper

- **Better:** every way a real school actually organises (year × department × key stage × house, overlapping) becomes legible to the coverage roll-up, and a leader sees exactly *their* scope named, everyone else's aggregated — without us guessing their org chart in advance.
- **Simpler:** it is the *same* relationship primitive as students and teachers, applied once more above the class; it **deletes** a dependency (leans off the rigid `groups` path-tree rather than extending it), and adds zero new boards — the roll-up is the coverage board at a higher `GROUP BY`.
- **Cheaper:** no per-shape migrations (new groupings are data), no new instrumentation (it rides the same `class_sessions` aggregate as coverage), and the first useful scope (school leader) needs no grouping rows at all — so the cheapest slice ships first.

## 7. Open questions (for Tom / a school pilot)

1. **`group_tags` table vs widen `user_tags`.** A dedicated table reads cleaner (subject is a class/school, not a user); widening `user_tags` reuses an existing RLS surface. Detail for `class-first-class-citizen.md`'s build map — both are additive.
2. **Where the leader-scope *entitlement* lives.** Probably an extension of the existing role/`user_tags` admin grants ("leads MFL@school X"), mirroring how school-admin is granted today. Needs the real auth pattern (CLAUDE.md canonical RLS table) before any policy.
3. **Chain as `group_kind` vs a real FK.** Chains/MATs may eventually want hard belonging + billing (like school↔class), at which point chain graduates from a tag to an FK. Start it as a tag (read-only roll-up scope); promote only if a chain becomes a paying entity. Don't pre-build it.
4. **Vocabulary seeding.** Do we offer a school a starter set of `group_kind` values on setup, or purely discover from what they create? Lean discover-first; offer gentle defaults only if onboarding shows people stall on a blank slate.

---

*This is the follow-on tutor-insights §7 named as "the next design area, not yet specced." It does not block the teacher↔class migration; it's the same shape, one level up, and ships consumer-first behind the coverage board.*
