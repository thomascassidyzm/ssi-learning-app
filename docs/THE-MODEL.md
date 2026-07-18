# THE MODEL — the one-node data model

**Status: CANONICAL CONTRACT. Founder-ruled 2026-07-18. Every worker builds against this doc; redlines from Tom land here first, code follows.**

This document is the single source of truth for the organisational data model unpick. It states the
founder's rulings verbatim, the principles they imply, the invariants every surface must hold, the
expand-contract migration plan, and the API contract. Anything not in here is a detail decision the
implementing worker owns.

---

## 1. The founder model (verbatim rulings, 2026-07-18)

### 1.1 One recursive node

> "There is no in-principle difference between a group, a school or an organisation."

A **GROUP** can belong to a group and can have child groups, teachers, classes and learners directly
affiliated. School / organisation / district / LEA are **LABELS** on a group — zero behavioural
difference. Example shape:

```
Ireland > Irish Gov > Department of Education > LEA > School
```

— all just nested groups.

### 1.2 Teachers

Teachers must belong to a group, and must have at least one class to *functionally* be a teacher:

> "they might be labelled as a teacher, but they can't play as class until they have at least one class"

The **label is free; the CAPABILITY gates on structure.**

### 1.3 Tutors

**Tutors are teachers with at least one class and no parent group (or no group) — NOT a separate
type.** The tutor/schools shell split dissolves.

### 1.4 Classes and learners

**CLASSES are "learners"** with their own class learning ID, manifested through play-as-class mode.
**LEARNERS** are individuals or class-affiliated; learners and classes have their own learning
accounts.

### 1.5 Affiliation

Learners, classes and teachers can affiliate **DIRECTLY to ANY group** — any node in the tree, not
just leaves. *This supersedes the 2026-07-17 leaf-only-join rule.*

### 1.6 Demo orgs

Demo org = **any structure at mint time, flexibly extended later.**

> "The bottom line is FLEXIBILITY."

### 1.7 Invites

**Invites are for PEOPLE ONLY** (role × group × limits). Structure creation lives only in the tree.
The "new demo org" flow moves to the tree: create group + demo flag + invite leader **in one gesture
AT THE NODE**.

### 1.8 View-as

**REMOVED from product UI** (founder: "too complicated... should probably go"). The audit-logged
minted-session harness stays as an **internal support tool only** (scripts, not UI). Tree drill-in
replaces it for data questions.

### 1.9 Structure UI

Two lenses on the same data — a proper **paginated TABLE** of organisations and a **TREE** view;
**search plus FILTER chips** (by label, status, demo). The current single-view is unwieldy and
confusing.

---

## 2. The four types

| Type | What it is | Identity | Affiliation |
|---|---|---|---|
| **GROUP** | The one recursive structural node. School, organisation, district, LEA, government are labels on it. | `groups.id` | `parent_id` → another group, or NULL (root) |
| **TEACHER** | A person with the teacher role in some group context. Functionally a teacher only once they have ≥1 class. | `learners.id` (a person) | role-tag → any group; class-tag → their classes |
| **CLASS** | A learner-equivalent with its own learning account (`is_class_entity` learner), played through play-as-class. | `classes.id` + `classes.class_learner_id` | → any group directly |
| **LEARNER** | An individual human with a learning account. | `learners.id` | individual (no group), or → any group directly, or class-affiliated |

### 2.1 Label-not-type (the load-bearing principle)

`groups.type` (nation, region, district, programme, school, organisation, LEA…) is **display
vocabulary only**. No query, policy, endpoint or component may branch behaviour on it. The moment
code says `if (label === 'school')` for anything other than choosing a word or an icon, it has
recreated the school/group split the founder dissolved.

The same principle applies to people: `educational_role` values (including `tutor`) are labels.
Behaviour gates on **structure**, never on the label:

| Capability | Gates on | NOT on |
|---|---|---|
| Play-as-class | has ≥1 class (a class row where they are a teacher) | the "teacher" label |
| Teacher dashboard with classes | has ≥1 class | label |
| Tutor experience (groupless shell) | teacher with ≥1 class AND no group affiliation | a stored `tutor` type |
| Leader view of a subtree | admin/leader role-tag at that node | entity type of the node |

### 2.2 Derived, never stored

"Tutor" is a **derived condition** (teacher + ≥1 class + no group), recomputed from structure at
read time. `learners.educational_role = 'tutor'` remains as a legacy label during transition but no
new behaviour may key on it; the shells merge.

---

## 3. Invariants (testable — the regression pins and new suites assert these)

- **I1 — One tree.** The group graph is a forest: `parent_id` chains never cycle; `path` stays
  consistent with `parent_id`.
- **I2 — Every school is a node.** Every live `schools` row is represented by exactly one group node
  (label `school`). No org object exists outside the tree.
- **I3 — Labels are free.** Changing a group's label changes zero behaviour (only display).
- **I4 — Capability gating.** A person tagged teacher with zero classes: sees teacher shell, cannot
  play-as-class, is prompted to create/join a class. The gate flips the moment they have one class.
- **I5 — Tutor = derived.** A teacher with ≥1 class and no group affiliation gets the full teacher
  experience (same shell); nothing reads a stored tutor type to decide behaviour.
- **I6 — Class is a learner.** Every active class has a `class_learner_id` → a `learners` row with
  `is_class_entity = true`; play-as-class records progress against it.
- **I7 — Direct affiliation anywhere.** A learner, class or teacher can affiliate to ANY group node,
  interior or leaf. No leaf-only check survives.
- **I8 — Invites mint people, never structure.** Redeeming any invite code creates/updates
  affiliations and roles only. Group/class creation happens only through tree (or class-management)
  endpoints.
  *Known expand-phase exceptions (audited 2026-07-18, compat-locked under I10):* two legacy
  redemption branches still self-mint structure — `school_admin` codes mint the `schools` row, and
  group-less `govt_admin` codes mint a `groups` row. Both are live, tested leader/school-admin
  onboarding, not demo debris. I8 is fully true for every invite **creation** path now; these two
  **redemption** paths migrate to tree-created-structure + join-invites in the contract phase.
- **I9 — Demo is a flag, not a shape.** A demo org is ordinary structure with `is_demo` propagation;
  it can be extended later like any other subtree.
- **I10 — Expand-contract safety.** Until the new UI ships, deployed prod code reading
  `schools`/`classes`/`user_tags` in their current shapes keeps working unchanged. Nothing
  destructive in tonight's migrations.
- **I11 — View-as is not a product surface.** No product UI path mints or overlays another
  identity; the support harness lives in scripts, audit-logged (`admin_impersonation_audit`).

---

## 4. Current state → target mapping

Grounded in `supabase/schema.sql` as of 2026-07-18.

| Today | Target | How (expand phase) |
|---|---|---|
| `groups` (id, name, type, parent_id, path, is_demo, is_test, name_confirmed) | **THE node.** Already recursive — keep. | Widen `type` vocabulary (add `school`, `organisation`, `lea`…); it is a label. |
| `schools` (commercial state: platform_status, trial_*, teacher_seats, provider_*, join codes; group_id → parent) | A group node with label `school`, carrying a **commercial attachment** | Add `schools.node_group_id` (the school's OWN node). Backfill: mint one group per school (parent = current `schools.group_id`). `schools` row survives as the commercial/compat record; a compatibility view keeps every current read shape working. |
| `classes.school_id` → schools | class affiliates to ANY group node | Add `classes.group_id` → groups. Backfill from school's node. Dual-write during transition; `school_id` stays populated for old code. |
| `user_tags` tag_type ∈ (school, class), value `SCHOOL:<id>` / `CLASS:<id>` | affiliation to ANY node: tag_type `group`, value `GROUP:<id>` | Expand the CHECK to allow `group`; dual-write school+group tags for school-shaped nodes; old readers see the school tags untouched. |
| `invite_codes.grants_school_id / grants_class_id / grants_group_id` | role × **group** × limits (people only) | `grants_group_id` becomes the primary grant; school/class grants keep working via the school's node mapping. No invite path creates structure. |
| `demo_orgs` + `/admin/demo-schools` flow | demo-mint **at the node** in the tree UI | New endpoint: create child group (+ optional subtree) with `is_demo`, + leader invite, one gesture. `demo_orgs` keeps recording mints for expiry cron. |
| `learners.educational_role = 'tutor'`; tutor shell vs schools shell | one teacher shell; tutor = derived groupless teacher | Shell dissolution in UI; role value left in place (label), behaviour keys removed. |
| View-as UI (admin overlay; `api/admin/view-as.ts`) | removed from product UI; script harness only | Delete UI entry points; keep audit-logged mint path callable from scripts. |

**Identity rules (unchanged, standing):** `learners.id` is the canonical identity for all domain
data; `auth.uid()` is a login token translated once at the edge (`current_learner_id()`). Multiple
accounts per person are intentional. Class learner accounts are `is_class_entity` rows, excluded
from human counts.

---

## 5. Migration plan (expand-contract — dev/staging/prod share ONE database)

**Hard constraint: production code runs against this database tonight and until its UI ships.
Additive only. No renames, no drops, no CHECK tightening that rejects existing writes.**

Expand phase (tonight, committed migrations, canary-applied per the RLS doctrine — every migration
carries its GRANTs, ends `NOTIFY pgrst, 'reload schema'`, never direct psql ad hoc):

1. `groups`: widen the `type` comment/vocabulary; no structural change needed (already recursive).
2. `schools.node_group_id uuid REFERENCES groups(id)` + backfill script minting one node per school
   (label `school`, parent = `schools.group_id`, `is_demo`/`is_test` copied). Idempotent.
3. `classes.group_id uuid REFERENCES groups(id)` + backfill from the school's node. `school_id`
   untouched.
4. `user_tags`: expand `tag_type` CHECK to include `group`; expand `role_in_context` if the leader
   vocabulary needs it (keep `admin` as the leader role — no new synonym without need).
5. Dual-write triggers or endpoint-level dual-writes (implementer's choice, BSC: prefer
   endpoint-level — visible, testable, no hidden trigger magic) keeping school-tag ↔ group-tag and
   `classes.school_id` ↔ `classes.group_id` consistent during transition.
6. Compatibility views only if a worker finds a read that would otherwise break — do not pre-build.

Contract phase (**NOT tonight** — after the new UI has soaked through staging→main): repoint
readers to nodes, then deprecate `schools` behavioural columns, school-tags, leaf checks.

**Canary rule:** each migration applied via the secfix-toolkit pattern — apply in txn, replay real
app queries (code redemption, class join, dashboard reads, play-as-class), assert every legit path
alive, commit iff green.

---

## 6. API contract (target surface — expand phase keeps all existing endpoints working)

All new org reads/writes are **server-mediated** (service-role + authz in code, the settled
`resolveVisibleScope` pattern). No new client-direct org-table reads.

### Structure (the tree)
- `GET  /api/groups/tree?root=<id>&depth=<n>` — subtree with per-node rollups (children, teachers,
  classes, learners, demo/status flags). Root defaults to caller's highest node.
- `GET  /api/groups/table?filters=<label,status,demo>&search=&page=` — the paginated table lens.
  Same data, flat.
- `POST /api/groups` — create node: `{ name, label, parent_id, is_demo? }`. The ONLY way structure
  is born (plus existing class-creation endpoints for classes).
- `PATCH /api/groups/:id` — rename, relabel, re-parent (cycle-checked), flag changes.

### People (invites — the only people-minting path)
- `POST /api/groups/:id/invites` — `{ role: teacher|leader|student, limits: {max_uses, expires_at} }`
  → code. Role × group × limits, nothing else.
- Redemption (existing `/api/code` lane): affiliates the person to the node with the role.
  Creates no structure. Existing school/class codes keep redeeming exactly as today (I10).

### Demo mint (at the node)
- `POST /api/groups/:id/demo-mint` — `{ name, shape?, leader_email? }` → child group (+ optional
  subtree), `is_demo` set, leader invite minted, one gesture. Records to `demo_orgs` for expiry.

### Capability
- `GET /api/me/teaching-context` — `{ groups: [...], classes: [...], can_play_as_class }` — the one
  read the shell uses to gate (I4/I5). Tutor-ness is `groups.length === 0 && classes.length > 0`,
  computed here, never stored.

---

## 7. UI contract

- **Structure view** (admin + leader): TABLE lens (paginated, sortable) + TREE lens (drill-in),
  toggle between them, state-shared search + filter chips (label, status, demo). Node actions:
  create child, invite people, demo-mint, relabel. Tree drill-in is the replacement for view-as.
- **Teacher shell**: one shell for all teachers. No class → "create/join your first class" prompt,
  play-as-class gated off. ≥1 class → full experience. Group or no group changes *content*
  (school context panels) not *shell*.
- **Invites UI**: people-only (role × group × limits). All structure-creation affordances removed
  from invite flows.
- **View-as**: all product UI entry points removed. `scripts/` harness + audit table remain.

---

## 8. Delivery phases (tonight)

1. ✅ This doc, committed early — the contract. Tom redlines here.
2. **Regression pins FIRST** (worker): pin current live-school behaviour — code redemption, class
   join, play-as-class, dashboards — as tests that must stay green through every later step.
3. **Schema expand** (worker): §5 migrations + backfills + canary.
4. **Parallel builds** (workers, off this doc): Structure table+tree; invites people-only;
   demo-mint at node; tutor-shell dissolution; view-as UI removal.
5. **Integrate on dev**, full suites, verify on the deployed dev build with real sessions
   (teacher-with-class, teacher-without-class gating, tutor-as-groupless-teacher, Nick-style demo
   mint). Screenshots → `docs/the-model/`.

**No staging/main tonight.** Founder tests on the dev deployment and ships when satisfied.

---

*Last updated: 2026-07-18 (initial canonical version — architect session)*
