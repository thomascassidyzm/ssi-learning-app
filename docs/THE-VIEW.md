# THE VIEW — one recursive node home

**Status: DESIGN CONTRACT. Companion to [THE-MODEL.md](./THE-MODEL.md) — the model gave us one
recursive node; this gives that node ONE face. Founder-ruled 2026-07-19.**

> "Every level/group within an org should have the same consistency of look… a single page as a
> dashboard, but with a consistent nav up and down the levels of inspection, with total clarity
> about what we're in and where we're looking — kind of like a MAP of the org and a visual
> indicator of where we are in it."

The pain this kills: the group summary page, the Full-schools list and the Structure panel were
three different designs — a legacy of the three-node-type era. From now there is **one page — the
NODE HOME — with the same grammar at every level of the tree.**

---

## 1. The grammar (same five parts, every level)

Every node home is the same page, top to bottom:

1. **MAP RAIL** — the org map, always present. The ancestor path from the org root down to here,
   you-are-here clearly lit, siblings one tap away, children below. The whole org is navigable up
   and down from any node without leaving the page. This is the spine of the design.
2. **IDENTITY HEADER** — the node's name + its label badge (school, programme, class…) + its
   demo / trial / paid state. You always know what you're in.
3. **STATS ROW** — the same rollup cards at every level: **learners · teachers · classes ·
   practice hours**. Always subtree totals ("everyone below this"), via the same shared resolver
   the tree and table lenses use — every level tells the same story.
4. **CHILDREN LIST** — whatever this node's children are (groups → schools → teachers → classes →
   learners), rendered in the same row grammar at every depth. The founder's lenses are **filters
   over this one list, not separate pages**:
   - **All groups** — every group below this node, all the way down
   - **All schools** — every school below, with its teachers
   - **All teachers** — every teacher below, with their classes
   - **All classes** — every class below, with student counts
5. **VERBS** — the plain-language task buttons (THE-MODEL §1.12), same corner at every level,
   scoped to the node: invite someone, add a school/group, share the links, see analytics.

## 2. Navigation rules

- **Clicking any node NAME anywhere in the app goes to that node's HOME** — this page. One rule,
  no exceptions, no learning three behaviours.
- **The Structure page stays as the quick-actions flyout** (the node panel with its verbs), but
  its "open"/"see progress" action always lands on node home.
- **The old pages die but their URLs live:**
  - `/admin/groups/:id` **IS** node home for that group.
  - `/admin/schools/:id` **IS** node home for that school's node (deep tools — classes, students,
    analytics — stay one tap below).
  - `/admin/classes/:id` **IS** node home at class level.
  - `/admin/groups/:id/schools` (the old Full-schools list) redirects to node home with the
    **All schools** lens preselected.
- The map rail is the up/down nav: parent names go up, child rows go down, siblings switch
  sideways. URL query `?lens=` carries the active lens so any view is linkable.
- **One continuous surface (founder ruling 2026-07-19):** "the root org page should stay; group
  pages should appear from within, same as schools and teachers and classes, rather than paint a
  whole new page." Drilling any node — org → group → school-node → class — swaps content in place:
  the rail stays mounted, no blank-page flash, no scroll-to-top jolt. Mechanically:
  `/admin/groups/:id` and `/admin/classes/:id` share the same container + view component pair (Vue
  reuses the mounted instances across the navigation), the container never re-blanks to a spinner
  after first paint, school rows open their NODE id, and `scrollBehavior` holds position between
  `nodeSurface` routes. Pinned in `router/theViewContinuity.test.ts`.

## 3. Levels

| Level | Children shown by default | Notes |
|---|---|---|
| Organisation / group | Its child groups & schools | Any interior node, however deep |
| School | Its teachers (with their classes) | Deep school tools stay at `/admin/schools/:id/…` |
| Class | Its learners | Header shows the lead teacher + the teachers list (co-teacher model), read-only for now. **Carries the full teaching density** (founder, 2026-07-19: "we need this level of data that we used to have"): per-student rows show belt · LEGOs · practice hours · last active · needs-attention flag, and the class home adds the Course Journey, Belt distribution and practice-min/student/week cards the old class page had — same five-part grammar, the cards sit between STATS ROW and CHILDREN LIST. |
| Learner | — | **There is no individual learner page** (founder, 2026-07-19: "there's no need for an individual learner page"). A student row expands IN PLACE on the class home — journey progress, streak, last-7-days — and collapses back. `/admin/users/:id/progress` redirects to the user admin page so old links never 404. |

A school is just a node with a commercial attachment (THE MODEL) — its home is the same page with
a trial/paid state in the header and teachers as children. Nothing branches on the label.

## 4. What this is not

- Not a reskin — the warm cream / black / red language stays; existing components and styles are
  reused aggressively.
- Not a new data model — one endpoint (`GET /api/groups/:id/home`) serves the whole page from the
  same subtree resolver (`groupRollups.computeNodeExtras`) the tree and table already use.
- Not a member-area change — teachers' and leaders' `/schools` views are untouched in this pass;
  this consolidates the admin inspection surfaces. The member area converges on the same grammar
  as a later scoped pass.

*Last updated: 2026-07-19*
