# Walkthrough engine — scout + bill of materials

**Status: SCOUT, 2026-07-28. No code. This becomes the build spec once the founder reads the shape.**

> Founder ruling (2026-07-28): user-visible documentation is dead. Every verb a user can
> perform in the schools dashboard gets, where it earns one, a guided in-app WALKTHROUGH —
> the same genre as the PWA install walker. Walkthroughs are COMPILED artifacts like the
> explainer pack: step sequences anchored to real UI elements, drift-gated so a broken
> anchor FAILS THE BUILD. Product tours normally rot; ours must be structurally unable to.
> Zero runtime LLM calls, ever.

---

## 1. The walker mechanism — how the install walker actually works

The "walker" the founder rates is `packages/player-vue/src/views/InstallGuide.vue` (707
lines, route `/install`), reached from `InstallBanner.vue` (`router.push('/install')`).
Precise anatomy:

### Step model
Implicit, not data-driven: a `currentStep` ref + a platform-dependent `totalSteps`
computed (`isSafari ? 4 : 3`), with each step a `v-if` branch inside a `<Transition
name="fade" mode="out-in">`. Step indicators are a row of dots (`.step-dots`, active dot
scaled + belt-red). Navigation is explicit **Back / Next / Done** buttons — no timers, no
auto-advance, learner-paced throughout. The one auto behaviour is the already-installed
flow: a 2-second countdown then `router.replace('/')`.

### Branching
Two layers, and this is the part that is genuinely well set up:

1. **Platform detection** (UA + display-mode): `installed / android / android-manual /
   ios / desktop` — five flows from one `flow` computed.
2. **Capability-first, guide-fallback**: on Android/desktop it *prefers doing over
   telling* — if the injected `beforeinstallprompt` event is available it renders one
   real **Install** button that triggers the native prompt; only after a 3-second
   fallback timer with no prompt does it degrade to the manual 3-step guide. Inside iOS,
   Safari vs Chrome further branches the share-button location (`bottom-center` vs
   `top-right`) and the step count.

### Anchoring
**There is none — and that's the key structural fact.** The install walker's targets
(Safari's share button, the OS share sheet, the Add dialog) live outside our DOM, so it
compensates with two devices:

- an **animated pointer** — `.share-pointer` with a `pulse-ring` + bouncing arrow,
  positioned by *heuristic* ("it's at the bottom of Safari"), not by element reference;
- **mock UI** — a hand-built replica of the iOS share sheet and confirm dialog
  (`.mock-share-sheet`, `.mock-confirm`), with the target row highlighted in belt-red and
  siblings faded to 35% opacity.

### Persistence / dismissal
`localStorage['ssi-install-dismissed']` timestamp; a quiet close ×, "Not now" skip links
on every flow. Never modal-trapped.

### What generalises vs what is install-specific

| Generalises into the engine | Install-specific (leave behind) |
|---|---|
| Learner-paced Next/Back + step dots idiom | Mock UI replicas — needed only because the target UI is the OS's; schools targets are OUR OWN DOM |
| Capability-first, guide-fallback (do the thing for them when the platform allows; guide when it doesn't) | UA sniffing / `beforeinstallprompt` plumbing |
| Branch-by-context (one walk, several flows, one `flow` computed) | The installed-redirect countdown |
| Pulse-ring pointer + highlight-the-row, fade-the-siblings visual grammar | Heuristic positioning — schools anchors position by `getBoundingClientRect` on a real element |
| Dismiss persistence in localStorage, skip always visible | Full-screen takeover (`position:fixed; inset:0; z-index:9999`) — schools walks overlay the live page instead |

The schools engine is *easier* than install in the one way that matters: every target is
an element we render, so anchors can be real references — verifiable at compile time —
and steps can advance on the user's *actual* interaction rather than on trust.

## 2. The verb inventory

*Compiled from 9 parallel read-only scouts over every file in scope, plus a direct
re-scout of the schools self-service tail. Personas: **group leader** (govt_admin, manages
a group of schools) / **school admin** / **teacher** / **ssi admin** (internal, `/admin/*`
and read-view mounts). Verdicts are deliberately stingy — over-tutorialising is a failure
mode; most verbs get NOTHING.*

### Route map (context)

- `/schools/*` → self-service surface (`SchoolsContainer.vue`): group leader, school admin, teacher, student.
- `/admin/*` → internal ssi_admin tooling (`AdminContainer.vue`).
- `/admin/schools/:id` etc. → ssi_admin **read-views** reusing `NodeHomeView`, `TeachersView`, `StudentsView`, `TeacherDashboard`, `NodeInsightsView`, gated read-only via injected `isAdminView`.

### 2.1 Admin: Structure tree (`AdminStructure`, `StructureTreeNode`, `GroupTreeNode`, `NodeChildrenList`, `NodeMapRail`, `WaysInLedger`, `HowThisWorks`, `NoticingInvitations`)

| Verb | Where | Personas | Verdict | Reason |
|---|---|---|---|---|
| Switch Tree/Table lens | AdminStructure.vue:367 | ssi_admin | NOTHING | Plain toggle |
| Search / quick-filter chips | AdminStructure.vue:379 | ssi_admin | NOTHING | Standard filters |
| + Add organisation | AdminStructure.vue:392 | ssi_admin | ONE-LINE HINT | Label picker affects hierarchy semantics |
| Drill into a subtree ("→ N more groups") | StructureTreeNode.vue:191 | ssi_admin | ONE-LINE HINT | Refocuses the WHOLE tree root, not just an expand |
| Rename (row menu / table row) | StructureTreeNode.vue:169 | ssi_admin | NOTHING | Plain field save |
| **Change label** (row menu → select) | StructureTreeNode.vue:138–151 | ssi_admin | **WALKTHROUGH** | Looks like it converts entity type; per label-not-type doctrine it's cosmetic unless a `commercial` attachment exists — genuine confusion risk |
| **Delete** (group/school/org) | StructureTreeNode.vue:171, GroupTreeNode.vue:242 | ssi_admin | **WALKTHROUGH** (point-at only) | Cascades to every descendant; impact lines + typed-confirm exist but blast radius isn't explained until the modal opens |
| Row click → node dashboard | StructureTreeNode.vue:108 | ssi_admin | NOTHING | Standard nav |
| Pagination / refresh | AdminStructure.vue:337, 484 | ssi_admin | NOTHING | Standard |
| Child row → open node/class/person | NodeChildrenList.vue:167 | all node-home viewers | NOTHING | Row-as-link |
| Map-rail breadcrumb nav | NodeMapRail.vue:35–96 | all node-home viewers | NOTHING | Standard breadcrumb |
| Copy link (Ways in) | WaysInLedger.vue:182 | leader / school admin / ssi_admin | NOTHING | Standard copy |
| **Re-mint (rotate) a personal link** | WaysInLedger.vue:183, 100–124 | same | **WALKTHROUGH** | Silently kills the old link — someone who already shared/bookmarked it loses access, no warning |
| Revoke / Put back a link | WaysInLedger.vue:184–185 | same | ONE-LINE HINT / NOTHING | Revoke is undoable via "Put back", already danger-styled |
| Role/Where filter chips | WaysInLedger.vue:135 | same | NOTHING | Standard filters |
| "How this works" expand | HowThisWorks.vue:31 | admin + leader | NOTHING | This IS the in-app-doc surface — not itself a candidate |
| Dismiss / tap a noticing invitation | NoticingInvitations.vue:26–51 | admin + leader | NOTHING | Plain dismiss / nav |

### 2.2 Admin: Node home & action bar (`NodeHomeView`, `NodeInsightsView`, `NodeActionBar`, `AdminTopBar`, `AdminStatsView`)

| Verb | Where | Personas | Verdict | Reason |
|---|---|---|---|---|
| Lens chips (Directly below / groups / schools / teachers / classes) | NodeHomeView.vue:427 | ssi_admin + member | NOTHING | Standard tabs |
| See insights / Overview / All boards | NodeHomeView.vue:326, NodeInsightsView.vue:129 | all (All boards admin-only) | NOTHING | Plain nav |
| **Invite a person** (mints account now) | NodeActionBar.vue:363 | ssi_admin + member | ONE-LINE HINT *(and the anchor of walk #1)* | "Link = live login now" is non-obvious |
| **Get a shareable link** | NodeActionBar.vue:364 | ssi_admin + member | ONE-LINE HINT | Reuses the existing live link per role — non-obvious |
| Add a group / Add a school | NodeActionBar.vue:365–366 | ssi_admin only | NOTHING | Self-evident create-with-name |
| Mint a demo org | NodeActionBar.vue:367 | ssi_admin only | ONE-LINE HINT | Creates a full org + shareable leader login link |
| **Courses (entitlement control)** | NodeActionBar.vue:368 | ssi_admin only | **WALKTHROUGH** | Commercial control panel, high stakes |
| Rename | NodeActionBar.vue:369 | ssi_admin only | NOTHING | Standard |
| Refresh demo activity | NodeActionBar.vue:370 | ssi_admin, demo nodes | ONE-LINE HINT | Writes fake session data — surprising if unaware it's demo-only |
| **Delete** (school/group) | NodeActionBar.vue:373 | ssi_admin only | **WALKTHROUGH** (point-at only) | Same destructive class as §2.1 |
| Copy share chip | NodeActionBar.vue:435 | ssi_admin + member | NOTHING | Standard copy |
| AdminTopBar tabs | AdminTopBar.vue:51–116 | ssi_admin | NOTHING | Self-labelled nav |
| Board-switch tabs | AdminStatsView.vue:73 | ssi_admin | ONE-LINE HINT (Rate compare + Difficulty turns only) | Non-obvious picker semantics on two of seven boards |

### 2.3 Admin: User management (`AdminUserDetail`, `AdminUsers`, `AdminAttention`, `AdminAnalytics`)

| Verb | Where | Verdict | Reason |
|---|---|---|---|
| **Change Platform role** (commits on select, no confirm) | AdminUserDetail.vue:480 | **WALKTHROUGH**† | Grants/revokes platform-wide admin power silently |
| **Change Educational role** (same pattern) | AdminUserDetail.vue:490 | **WALKTHROUGH**† | Reassigns real authz with no confirm |
| **Create sign-in link** | AdminUserDetail.vue:517 | **WALKTHROUGH**† | Mints a real magic link that logs in AS the user |
| Grant / revoke entitlement | AdminUserDetail.vue:588, 684 | ONE-LINE HINT / NOTHING | Grant self-explanatory; revoke has native confirm |
| **Skip to end of trial** | AdminUserDetail.vue:715 | **WALKTHROUGH**† | Backdates real trial windows, no confirm, "QA only" by the authors' own caveat |
| Restore trial (+30d) | AdminUserDetail.vue:718 | ONE-LINE HINT | Lower risk, restorative |
| Disclosure toggles, search/filter/sort, row navs | AdminUserDetail/AdminUsers/AdminAttention | NOTHING | Standard |

All ssi_admin only. †See the synthesis note below §2.6 — for these, guard copy likely beats a tour.

### 2.4 Admin: Invites & entitlement creation (`AdminInvites` + `components/admin/invites/*`)

*The single highest-blast-radius cluster on the whole surface — every verb mints real access. All ssi_admin only.*

| Verb | Where | Verdict | Reason |
|---|---|---|---|
| Switch create mode (org/direct/demo) | InviteCreateCard.vue:37 | ONE-LINE HINT | Three mental models on one tab strip |
| **Select "Who" for org invite** | OrgInviteForm.vue:220 | **WALKTHROUGH** | Two of four options surface a *standing* code, two mint fresh — the button label silently switches |
| **Submit org invite (leader)** | OrgInviteForm.vue:258 | **WALKTHROUGH** | Mints a real govt_admin invite — a leaked link makes a stranger a group leader |
| Direct-access sub-modes, person/duration/course fields | DirectAccessForm/IndividualAccessForm | ONE-LINE HINT / NOTHING | Mostly plain forms; submit mints a real redeemable code (hint) |
| **Submit magic link for one person** | EmailAllowlistForm.vue:300 | **WALKTHROUGH** | Single-use full/course grant tied to one real email |
| **"Grant access" — bulk email allowlist** | EmailAllowlistForm.vue:357 | **WALKTHROUGH**† | Highest blast radius in the app: silent bulk lifetime access, applies instantly to existing accounts on a paste error |
| **Create demo org** | DemoOrgCreateForm.vue:123 | **WALKTHROUGH** | One click provisions a real org tree AND mints two live links |
| Expire now / Extend 30d (demo org) | DemoOrgsPanel.vue:386 | NOTHING / ONE-LINE HINT | Extend safe; Expire has no confirm |
| **Purge (demo org)** | DemoOrgsPanel.vue:397 | **WALKTHROUGH**† (point-at only) | Irreversible deletion of tree, learners, progress — most destructive verb found anywhere |
| Delete a group (Demos tree) | DemoOrgsPanel.vue:214 | point-at only | Impact preview + typed-confirm already exist |
| Create preview/try link | PreviewLinkForm.vue:83 | NOTHING | Guest-only, least consequential mint |
| **Toggle invite Active/Disabled** | UnifiedInviteList.vue:217 | **WALKTHROUGH** | Looks like a status badge; is a live kill-switch spanning 4 underlying access mechanisms |

### 2.5 Admin: Onboarding messages, board reports, misc

| Verb | Where | Verdict | Reason |
|---|---|---|---|
| **Save draft** (onboarding message) | AdminOnboardingView.vue:292 | **WALKTHROUGH**† | Save = publish; the send system reads this table live, no staging step |
| Toggle message Active/Inactive | AdminOnboardingView.vue:219 | ONE-LINE HINT | Non-obvious it flips live send copy |
| **Freeze & share report** | BoardReportView.vue:238 | **WALKTHROUGH** | Mints a public unauthenticated `/board/:code` link — data leaves the admin-gated surface |
| Copy share link / Revoke snapshot | BoardReportView.vue:272 | NOTHING / ONE-LINE HINT | Revoke danger-styled; no expiry though |
| Release-notes edit/publish/delete, course sort, methodology link | AdminCourses/AdminReleaseNotes/AdminMethodology | NOTHING | Well-guarded already; charts are display-only |

All ssi_admin only.

### 2.6 Schools self-service: dashboard, settings, setup, people, classes

*(Sections below re-scouted directly from source after the worker delivery truncated.)*

| Verb | Where | Personas | Verdict | Reason |
|---|---|---|---|---|
| Create class (dashboard + teacher dashboard + modal) | DashboardView.vue:381, TeacherDashboard.vue:358, CreateClassModal | teacher, school admin | NOTHING | Standard modal form; the *aftermath* (join code, play) is walk #2's job |
| Save group/school name (first-run cards) | DashboardView.vue:660–691 | invite-born leader / school admin | NOTHING | Self-evident first-run field |
| Setup wizard (steps, add/remove class rows, back/save-exit/continue) | SetupView.vue:330–551 | school admin | NOTHING | It IS already a guided flow — don't tour a wizard |
| Settings section tabs, save profile, save localisation | SettingsView.vue:346–442 | school admin | NOTHING | Standard forms |
| Export school data | SettingsView.vue:459–470 | school admin | ONE-LINE HINT | What the include-toggles actually cover is non-obvious |
| **Delete school** | SettingsView.vue:482 | school admin | point-at only | Destructive; modal guard exists; a walk may name it, never advance through it |
| Open billing portal | SettingsView.vue:502 | school admin | ONE-LINE HINT | Leaves the app for Stripe — say so |
| Export CSV (teachers/students/classes) | TeachersView.vue:156, StudentsView.vue:170, TeacherDashboard.vue:355 | all staff | NOTHING | Standard |
| Bulk import teachers | TeachersView.vue:159 | school admin | ONE-LINE HINT | Format expectations |
| Invite teacher / invite students | TeachersView.vue:162, StudentsView.vue:173 | school admin / teacher | *anchor of walk #1* | The join-code/link model is the product's core non-obvious idea |
| Show/copy join code | TeachersView.vue:284–303, ClassDetail.vue:556–574 | staff | ONE-LINE HINT | A standing code — anyone holding it joins, until rotated |
| Remove teacher / remove student | TeachersView.vue:228, ClassDetail.vue:483 | school admin / teacher | NOTHING | Confirmed, reversible by re-invite |
| Rename class / delete class | ClassDetail.vue:388–403 | teacher | NOTHING / point-at only | Rename trivial; delete has modal |
| **Play as class** | ClassDetail.vue:426, TeacherDashboard.vue:491 | teacher (canPlayAsClass) | **WALKTHROUGH** | The most conceptually novel verb on the teacher surface — one device leading a whole class through a session |
| Copy class share link | TeacherDashboard.vue:486 | teacher | ONE-LINE HINT | Same standing-link semantics as join codes |
| View student → StudentProgressView; "Keep going" | StudentsView.vue:280, StudentProgressView.vue:291 | staff | NOTHING / ONE-LINE HINT | Row nav; Keep going launches the player in the student's context — one line suffices |

### Synthesis note (the opinionated bit)

The scouts flagged ~20 WALKTHROUGH-grade verbs, but they split into two different
problems with two different fixes:

1. **First-time competence on the member surface** (leader / school admin / teacher) —
   invite flows, Ways in semantics, Play as class, insights. These are the true
   walkthrough candidates: the personas are external, first-time, and the concepts
   (standing links, one-device class play, rate-compare) are genuinely novel.
2. **Danger on the internal ssi_admin surface** (role changes committing on select,
   bulk allowlist grants, save-is-publish, purge). The users are *us*; the failure mode
   isn't ignorance of the flow but a missing guard at the moment of commit. For the
   rows marked †, the Better×Simpler×Cheaper fix is **inline guard copy / a confirm
   step**, not a tour — a walkthrough you saw once doesn't protect the hundredth use.
   These go on a separate small worklist item, not into the walkthrough pack.

### Top 5 walkthroughs (value to a first-time leader/school admin/teacher × non-obviousness)

1. **"Bring your first teacher in"** — school admin, node home. Steps: point at
   `verb` "Invite a person" (NodeActionBar) → *click* opens the `verb-form` → point at
   the role choice ("the link carries the role") → point at submit ("this mints a live
   login link — send it any way you like") → point at the Ways in ledger row that
   appears ("revoke or re-mint it here; re-mint kills the old link"). Anchors:
   `verb-invite-person`, `invite-form-role`, `invite-form-submit`, `ways-in-row`.
2. **"Run your first class session"** — teacher, class detail. Steps: point at the
   join-code reveal (`ClassDetail` `.showCode` button — "students join with this
   standing code") → point at copy → point at **Play as class** (`.btn-play-lg` —
   "one device, the whole class follows; sessions count for every student") → done.
3. **"Ways in — who can get in, and how to change it"** — leader + school admin, node
   home. Steps: ledger overview → copy vs **re-mint** ("re-mint rotates: the old link
   dies the moment you tap") → revoke / put back. This is the one member-surface verb
   with a genuine silent trap; the walk exists mostly to carry that sentence.
4. **"Reading your insights"** — leader + school admin, node insights. Steps: measure
   picker (what each measure means, from the pack's derived truth) → window chips →
   the compare frame ("rates, not raws — fair across different-sized groups") →
   back-to-home. Pairs with the existing How-this-works text rather than replacing it.
5. **"The invites desk"** — ssi_admin, `/admin/invites`. The one internal cluster that
   earns a walk (new internal staff onboard onto it cold): create-mode strip → the
   org-invite "Who" selector (standing vs fresh — the silently switching button) →
   the unified list's Active toggle ("a live kill-switch across four mechanisms").
   Explicitly show-and-point only; every submit here mints real access.

## 3. The engine shape

The design copies the explainer pack's compiler split exactly (decisions hand-authored,
derivables regenerated, drift gate between them — `docs/self-explaining-dashboard.md`
§2/§4). Same directory grammar, same lockstep checks, same zero-runtime-token rule.

### 3.1 Files

```
tools/walkthrough/walks/*.json          # hand-authored walkthroughs (the DECISIONS)
tools/walkthrough/compile.mjs           # drift gate + pack assembly (cribbed from tools/explainer/compile.mjs)
packages/player-vue/src/walkthrough/pack.json        # compiled pack, bundled static
packages/player-vue/src/walkthrough/useWalkthrough.ts # runtime state machine (~120 lines)
packages/player-vue/src/components/admin/WalkOverlay.vue # the one overlay component (~250 lines)
```

### 3.2 Walkthrough-as-data schema (minimal, v1)

```jsonc
{
  "id": "invite-a-teacher",
  "title": "Invite a teacher",
  "personas": ["leader", "school_admin", "admin"],
  "place": { "route": "node-home", "kinds": ["school"] },  // semantic place, resolved via nodeSurfacePaths — same trick as rules.json CTA targets
  "steps": [
    {
      "anchor": "verb-invite-person",                       // a data-walk id that must exist in source
      "say": "People join through here — tap **Invite a person**.",
      "advance": { "on": "click" }                          // the user's REAL tap advances
    },
    {
      "anchor": "invite-form-role",
      "say": "Pick teacher — the link carries the role with it.",
      "advance": { "on": "next" }
    },
    {
      "anchor": "invite-form-submit",
      "say": "This creates a link you can send any way you like.",
      "advance": { "on": "next" },
      "terminal": "Their link appears in Ways in below — you can revoke it there any time."
    }
  ]
}
```

Three advance conditions only, and no fourth until a real walk needs it:

- **`next`** — explicit tap on the overlay's Next (default; pure show-and-point).
- **`click`** — the anchored element's own click advances (the user does the real thing;
  the overlay never intercepts, it just listens).
- **`visible`** — waits for the anchor to appear (e.g. the `verb-form` that only exists
  after the verb button opens it). A `visible` step that never resolves within ~5s shows
  its text anyway with Next — a walkthrough must never hang.

No timers, no scroll-jacking beyond `scrollIntoView` on the current anchor, Skip on every
step, step dots — the install walker's exact grammar.

### 3.3 Anchor binding + the drift gate

Anchors are **`data-walk="<id>"` attributes on the real elements** (the repo currently
has zero `data-testid`s, so this is a fresh, single-purpose namespace — nothing to
collide with, and grep-able).

Compile-time gate (`compile.mjs --check`, CI-wired like the explainer):

1. **Anchor existence** — every step's `anchor` must appear as `data-walk="<id>"`
   somewhere in `packages/player-vue/src/**/*.vue`. Missing → **build fails**. Orphan
   anchors (attribute with no walk referencing it) → warning.
2. **Persona visibility** — an anchor sitting inside a `v-if="!member"` guard (the
   admin-only marker the explainer compiler already parses out of `NodeActionBar.vue`)
   must not be referenced by a walk offered to `leader`/`school_admin`/`teacher`.
   Violation → build fails. This is the check no off-the-shelf tour library has.
3. **Place validity** — `place.route` must be one of the runtime's semantic places
   (lockstep list checked against `useWalkthrough.ts` source, exactly like the
   explainer's `KNOWN_TARGETS` check).
4. **Offer validity** — every `walk:<id>` CTA target in `tools/explainer/rules.json`
   must name a walk in the pack, and vice-versa lockstep in `evaluateRules.ts`.
5. *(v1.1, optional)* **Live walk in CI** — a Playwright script in the existing
   `packages/player-vue/e2e/*.mjs` idiom loads a demo org against a preview deploy and
   drives each walk headlessly, asserting every anchor resolves and every `click` step's
   element is actually clickable. Static grep catches renames; the live walk catches
   "renders but unreachable".

### 3.4 Where walkthroughs are offered

**No new surface.** A walkthrough is a new semantic CTA target (`walk:<id>`) reachable
from the two offering surfaces that already exist:

- **Noticing invitations** — the natural home. "This school has no teachers yet — want a
  30-second tour of inviting one?" is just a rule in `rules.json` whose CTA is
  `walk:invite-a-teacher` instead of a path. Dismissal (14 days per rule × node),
  the ≤3 cap, and never-modal all come free.
- **How this works** — the inline card gains an optional quiet "Show me" link per
  persona×place, launching the relevant walk from the reference text.

Invitations, not missions: nothing auto-plays, ever — including on first visit. A walk
runs only because the user tapped an invitation or a Show-me. The user is the selector.

### 3.5 Real data vs demo data

Ruling proposed: **walks run on the real page over real data** — pointing at the user's
own school is the whole value; a demo sandbox rebuild would fail Simpler and Cheaper.
Safety comes from three cheap rules instead:

1. **Show-and-point by default** (`next` steps): the walk highlights and explains;
   nothing happens unless the user does it.
2. **`click` steps only on safe/reversible verbs** — invites (revocable in Ways in),
   navigation, lens switches, refresh. Destructive or heavyweight verbs (Delete,
   entitlement changes) are never `click` steps; a walk may *point at* Delete while
   saying what it does, but never advances through it. Enforceable as a compiler
   denylist on anchors (`verb-delete`, `entitlement-*`) — gate check 6.
3. **Admins already have demo orgs** ("Mint a demo org" + demo refresh) — an admin who
   wants to rehearse a write-heavy flow end-to-end runs the same walk inside a demo org.
   No engine work needed; it's a property of where you stand when you start the walk.

## 4. Cost

Rough estimate, in focused agent-sessions (the explainer pack — same architecture, same
compiler pattern — was designed and shipped in roughly two):

| Piece | Estimate |
|---|---|
| Engine: `WalkOverlay.vue` (spotlight + card + dots + skip), `useWalkthrough.ts` (state machine, anchor resolution, advance listeners), mount in node-surface container | 1 session (~350–400 lines total, install-walker CSS grammar reused) |
| Compiler: `tools/walkthrough/compile.mjs` + CI `--check` wiring | ½ session (crib ~60% from `tools/explainer/compile.mjs`) |
| `walk:<id>` target in `evaluateRules.ts` + offer link in `HowThisWorks.vue` | ¼ session |
| `data-walk` attributes on the first 5 walks' anchors | ¼ session (mechanical) |
| First 5 walkthroughs authored + drift-gate green | 1 session |
| *(v1.1)* Playwright live-walk CI job | 1 session, optional |

**Total v1: ~3 sessions.** Zero new endpoints, zero new queries, zero runtime tokens,
one new JSON pack in the bundle (a few KB).

BSC: **Better** — every schools verb gets discoverable, in-place, persona-correct
guidance that cannot desync from the UI (a renamed button fails the build, not the
user). **Simpler** — one overlay component, one pack, one compiler; deletes the entire
"write and maintain user docs" surface; offering rides the two surfaces that already
exist. **Cheaper** — compile-time-only maintenance; authoring a walk is editing one JSON
file; no tour library dependency, no docs CMS, no support burden from stale screenshots.

**Adjacent, not in this build:** the †-marked ssi_admin danger verbs (role change
commits on select, bulk allowlist, save-is-publish, purge) want inline guard
copy/confirm steps — a separate, smaller worklist item (~½ session), because a tour
seen once doesn't protect the hundredth use.

*Scout: 2026-07-28. Sources: `views/InstallGuide.vue`, `components/InstallBanner.vue`,
`docs/first-boot-experience.md`, `docs/self-explaining-dashboard.md`,
`tools/explainer/compile.mjs`, `explainer/evaluateRules.ts`,
`components/admin/{HowThisWorks,NoticingInvitations,NodeActionBar}.vue`.*

---

## Addendum — the learner persona at the Library (A-159, 2026-08-18)

**Founder instruction, 2026-08-18:** the same protocol the schools and organisation
dashboards use — the subtle throbbing "How this works", with hand-authored JSON walks that
show what actually happens rather than a video — is to be used "for anything we want to show
them about how the app works either how the methodology itself works or how features of the
app work. And basically a way to make the library more useful."

This **supersedes** the founding ruling in `docs/self-explaining-dashboard.md` (2026-07-27)
that the learner level is "deliberately nothing". The bar that ruling set still holds: the
explanation stays optional, quiet, and never something a learner has to get past.

What changed in the engine:

- **`learner` is a persona**, and it is a **member** persona (`MEMBER_PERSONAS` in
  `tools/walkthrough/lib.mjs`) — the furthest thing there is from an admin, so gate 2 refuses
  any learner walk anchored behind an `v-if="!member"` guard.
- **`library` is a place** (`KNOWN_PLACES` in `useWalkthrough.ts`), in lockstep with the
  compiler's gate 3.
- **The offering surface** is `components/me/HowThisWorksLibrary.vue`, mounted in
  `BrowseScreen.vue` beneath *Your Progress*, closed by default. Practical first: it opens on
  the walks, with the two existing methodology sections collapsed beneath it. The prose is the
  existing `learnerExplainers.ts` content, reused unchanged.
- **Three walks**, all anchored inside the Library overlay:
  `where-you-are-in-this-course`, `choose-something-else-to-learn`, and (guests only, via
  `place.kinds`) `save-your-progress`.

**Anchoring, first slice.** Every learner walk anchors to an element inside the Library
overlay. The Library is drawn *over* the player, so an anchor in the player behind it may be
covered or unmounted; where the doing genuinely lives in the player, the walk says "close this
and press play" in its terminal line rather than pointing at something the learner cannot see.
Whether walks should reach through into the player is a founder call, not an engine limit.

**Over-tutorialising is still the named failure mode.** Three walks, not a tour of everything.
Most learner surfaces should get nothing.

**Content laws.** Learner walk prose obeys the `learnerExplainers.ts` header laws exactly as
the profile sections do — no streaks, no days-since, no guilt, no points, no score, no
leaderboard, no internal terminology. Unit-tested in `useWalkthrough.test.ts`. The thirty-hour
promise stays in "Why this works" and appears in no walk.
