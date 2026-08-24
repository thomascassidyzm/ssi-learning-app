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

### 1.10 Ways-in live ON the node — the invites page dies (ruled later on 2026-07-18)

> "all the invite link info to pop up directly in the Structures page... maybe we don't even need
> the Invites page."

**THE INVITES PAGE DIES.** Clicking a group in Structure shows, in its panel, the actual shareable
**LINKS** — grouped by role — with mint-new-invite right there (role + limits, group pre-filled =
the node). **The URL is the artifact**: copyable in one tap; the code is internal plumbing and
never leads. The global `/admin/invites` list is demoted to at most a hidden audit view — not a
nav destination. (The observed regression — a node panel saying "Manage in Invites →" with no
links shown — is exactly the wrong shape.)

**Links-first everywhere:** anywhere a code is displayed, show the shareable URL with copy; demo
join links must be as prominent and functional as they were in the old demo flow.

### 1.11 Entitlements are binary (ruled later on 2026-07-18)

> "there are only two options: all courses (if paid up), X_for_Y (if on a trial)."

A node is either **TRIAL** — exactly ONE course, chosen X_for_Y; expiry auto-derived (30 days if
premium, 365 days otherwise) — or **PAID** — all courses, no list. **Kill the 150-course checkbox
wall**: one trial/paid state, a single course picker visible only in trial state. (This is the
schools instance of the standing ALL-LANGUAGES-ON-PAID direction: no per-course entitlement state
for paid.)

### 1.12 Design law — VERBS ON TOP, MODEL UNDERNEATH (ruled later on 2026-07-18)

> "better — yes, for sure; simpler in some ways but a lot less intuitive... cheaper — not really,
> since more to think about and manage and communicate. The average end user is decently smart but
> not necessarily tech-savvy — we have got to make it idiot proof."

**Structural simplicity must NOT become cognitive load.** The one-node model stays as substrate;
every surface leads with plain-language TASK actions, not concepts. Concretely:

1. **The node panel opens with 3–4 big task buttons** — *Invite a teacher* / *Add a school* /
   *Share the join link* / *See progress* — each a short guided gesture ending with the artifact
   in hand (link copied, person invited). (Group/school nodes have learner **join** links, so the
   verb is *Share the join link*; "class link" language belongs only to a class context, which
   must name its owner teacher — ruled 2026-07-19.)
2. **Tree, labels, entitlements, staff lists are progressive disclosure BELOW the verbs.**
3. **Empty states are teaching buttons** ("No teachers yet → Invite one"), never captions.
4. **Plain words everywhere** — no "node", "entitlement", "primitive", "subtree" in user-facing
   copy; say *school*, *group*, *courses*, *everyone below this*.
5. **ACCEPTANCE TEST:** a decently smart non-techy school leader completes the top five jobs first
   try, no training, no tour.

Quality over speed from here — founder: "I want it done well: better × simpler × cheaper."

### 1.13 The link IS the credential — straight-in, no sign-in ceremony (ruled 2026-07-19)

> "given that the email is not even verified before they get access, [the OTP step] is just an
> unnecessary friction point."

**Possession of an invite/access link already grants the account.** An OTP or email screen after the
click re-proves possession of something the click *just proved* — it is ceremony, not security.
Nothing checks the typed email against who the invite was meant for, and access is granted before any
email is verified, so the sign-in step protects nothing while it taxes every teacher/admin/leader.

**Straight-in on click is the DESIGN, not a convenience shortcut.** The email/OTP flow exists
ONLY as the fallback for someone who has no link. This is the standing shape: **no future
"standardisation" or "sign-in hardening" pass may reintroduce an OTP or email round-trip on a valid
link** — that is a regression, pinned by I12.

**Refined 2026-07-20 (founder-ruled, with screenshot evidence): there are TWO link species.**

**Species 1 — PERSONAL links (what "straight in" has always meant).** The account is
**PRE-PROVISIONED at mint** (role + node + a display name like "IME Programme Leader", optional
email) and the link token IS the login: click → authenticated as THAT account → role-matched
dashboard. **ZERO interstitial screens** — no name/email form, nothing. This is what gets emailed
to known partners. Repeatable until revoked/expired; per-code + per-IP rate limits and the
`possession_mint_attempts` audit apply (outcome `personal_signin`). Mechanism: the code row carries
`metadata.personal_auth_user_id`, written ONLY by the admin/leader-gated mint
(`api/groups/:id/invites` POST `{personal:{name,email?}}` → `provisionPersona`), never
client-supplied; `possession-redeem.ts` mints the session for the bound account. The
already-registered takeover rail deliberately does not apply to this branch — signing into the
bound account is the link's entire purpose, authorized at mint.

**Species 2 — OPEN shareable links (person unknown at mint).** The one-screen identity capture:

- **Named roles: ONE identity-capture screen on first redeem** — "You've been invited as a
  **teacher** at **<School>**. Your name / your email" — then IN, on the role surface. No OTP, no
  email round-trip; email recorded unverified (`needs_verification` handles the later round-trip).
  The capture screen is the account's identity being born — and it is the ONLY screen permitted.
- **Pupil links (student → class, learner → group): name-only capture** — young learners have no
  email to give; the placeholder address survives for them only, now with a real name.
- **Zero link-UUID ghosts for named roles** — server-enforced (`possession-redeem.ts` refuses
  `linkAuth` outside code_type `student`, outcome `identity_required`).

**Both species:** subsequent redeems under a session that already holds the link's identity go
**straight to the person's surface** — no confirm screen, no second code spend (validate reports
`alreadyRedeemed`). The minting UI offers the two verbs distinctly: *Invite a person (personal
link)* vs *Get a shareable link*.

**Where the security budget actually goes** (it does real work only here): link **revocability**
(the unified invite list / node panel toggle), **expiry and single-use** where configured, and the
**unified audit trail** (`invite_codes` redemption + `possession_mint_attempts`). Spend there; never
on re-proving the click.

*Implemented 2026-07-19 (`075dd2ba`): `linkAuth` mode on `api/auth/possession-redeem.ts`; the link's
code is the token, the session is minted from possession alone, real email collected first-run via
`needs_verification`. Full rationale + the diagnosed drift-off history in `docs/DECISIONS.md`.*


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
- **I2b — A school and its node carry ONE name (added 2026-08-07).** `groups.name` on
  `schools.node_group_id` and `schools.school_name` are the same name in two homes, and every
  writer of either writes both (`api/_utils/schoolNodeName.ts`, wired into
  `school/update-profile`, `onboarding/profile`, and `PATCH /api/groups/:id`). The node is
  synthesised lazily on first dashboard open and the dashboard HEADING reads the node, so a
  one-sided rename left a leader who opened her dashboard before naming her school reading the
  replaced name for ever — verified live on production, 2026-08-06. Node→school renames run
  AFTER the duplicate-name warning, never around it. Healer for pre-existing drift:
  `tools/backfill-school-node-names.mjs`.
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
- **I12 — The link is the credential; two species, never an OTP (§1.13, refined 2026-07-20).**
  A **PERSONAL** link (pre-provisioned account) clicked in a **fresh context** shows **ZERO
  screens** — authenticated as the bound account, landed on the role surface. An **OPEN** link
  shows at most ONE screen — identity capture (name + email for named roles; name only for
  pupils) — and lands the user authenticated on the role surface: leaders on their node home,
  teachers on their school surface, students in the player on their class course, learners in the
  player. No OTP, no email round-trip, no "sign in to continue", and **no link-UUID ghost accounts
  for named roles** (server-refused). A session that already holds the link's identity goes
  **straight to the surface** with zero screens. The email/OTP flow appears ONLY when there is no
  link, when the mint can't proceed (rate-limited/transient), or when a typed email already has an
  account. A **revoked/expired/exhausted** link fails **friendly** (no session, plain "this link is
  no longer valid"), never a hard error. Pinned in `RedeemCode.test.ts` (personal zero-screens;
  capture-then-in; pupil name-only; re-click straight-to-surface) + `possession-redeem.test.ts`
  (personal bound-account mint; named-role linkAuth refusal). Any change that adds a screen to a
  personal link, a SECOND screen to an open link, an OTP, or a ghost account fails these pins.

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
- **Rollups are SUBTREE totals (founder ruling 2026-07-18 — "every lens tells the same story as the
  group dashboard").** A node's teacher/class/learner counts aggregate the node + every descendant,
  DISTINCT (a user shared across two schools counts once at their shared ancestor), so a programme
  shows its schools' combined 6 teachers / 80 learners rather than the 0/0/0 of its own direct
  affiliations. `childGroupCount` stays DIRECT (the fan-out at this node). One resolver
  (`api/_utils/groupRollups.computeNodeExtras`) serves tree + table; commercial attachment is the
  node's OWN school, never rolled up.
- **School-node duality bridge (I2).** Facets keyed on a node id must resolve the school row behind a
  school node (`schools.node_group_id`), because pre-node data — invite codes, entitlement grants,
  SCHOOL:/CLASS: tags — still references `schools.id`. `api/_utils/schoolScope.ownSchoolIdForNode` is
  that single bridge; the node-panel "ways in" GET matches `grants_group_id = node OR grants_school_id
  = its own school`, so a school node's demo codes surface instead of "No invite links yet".
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
- **SUPERSEDED 2026-07-19 — rows are links, verbs live on node home.** The Structure side-panel
  (`NodePanel.vue`) is retired. A row click now opens the node's home page directly (no side
  panel, no "Open" chip); the verbs it used to carry moved to `NodeActionBar.vue` across the top
  of node home (see docs/THE-VIEW.md §1.5 / §2). The bullet below describes the retired panel and
  is kept only as design history. (Also fixed same day: ssi_admins deleting a class from within a
  school's dashboard were bounced to Structure — ClassDetail's back-nav now routes through
  `useSchoolsNav` so admins stay on `/admin/schools/:id` instead of falling into the member
  `/schools` guard.)
- **Node panel = the ways-in surface (§1.10), VERBS FIRST (§1.12).** The panel OPENS with 3–4 big
  task buttons in plain language — *Invite a teacher* / *Add a school* / *Share the join link* /
  *See progress* — each a short guided gesture ending with the artifact in hand. The shareable
  invite LINKS grouped by role (URL first, one-tap copy; codes are plumbing, never lead) +
  mint-new-invite inline sit with those verbs; tree mechanics, labels, entitlement state, staff
  lists are progressive disclosure below. Empty states are teaching buttons ("No teachers yet →
  Invite one"). No "Manage in Invites →" indirection. `/admin/invites` is demoted to a hidden
  audit view at most. User-facing copy never says node/entitlement/subtree — it says school,
  group, courses, everyone below this. Acceptance: §1.12.5.
- **Node entitlement control (§1.11):** one binary state on the panel — TRIAL (single course
  picker, X_for_Y, auto expiry 30d premium / 365d otherwise) or PAID (all courses, no list). No
  per-course checkboxes anywhere.
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

## 9. Commercial layer (founder-ruled 2026-07-18 — answers the tutor-billing fork)

**Tutors ARE a distinct commercial classification but NOT a structural one — same plumbing,
different money routing.** The structural model stays exactly as §2 (tutor = groupless teacher,
derived); billing is a **PROFILE on the arrangement**, never a type.

The **AnyoneCanTeach** model (numbers verbatim):

- **Revenue-share lane (tutor):** tutor pays **£15/month**, creates a class, signs up students at a
  discounted **£10/month**, and **receives £5 per student per month** for running the teaching
  experience.
- **Pass-through lane (schools):** same model but the school passes ALL discount to students, who
  pay **£5/month** joining through their school.

So: ONE structural model, plus a billing profile of **revenue-share** (tutor keeps the £5 margin)
vs **pass-through** (learners get it).

**Implementation status:** this ruling **de-risks the shell dissolution** (no billing behaviour
change is needed for the merge — billing paths stay byte-identical) and it does **not** commission
billing work. No new billing plumbing gets built until the profile model is explicitly picked up as
its own scoped piece.

---

*Last updated: 2026-07-20 (§1.13 refined + I12 re-pinned: role-shaped links with ONE
identity-capture screen for named roles, name-only for pupils, zero link-UUID ghosts, re-click
straight-to-surface. Previous: §1.13 straight-in ruling 2026-07-19; §1.10/§1.11 + §9 2026-07-18)*
