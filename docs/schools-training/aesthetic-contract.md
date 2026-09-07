# Schools dashboard — aesthetic contract

Read-only aesthetic read for the new Training/Handbook page. No code changed. All claims below are
sourced from the live code, quoted with file paths — not from any doc in `archive/docs-retired-*`.

**Important correction to the brief before anything else:** two design systems physically coexist
under `.schools-surface`, and only one of them is live. `schools-tokens.css` ("Frostwell Courtyard" —
frosted-glass `--glass-*`/`--tone-*`/`--ink-*` tokens) and its matching component set
(`FrostCard.vue`, `Button.vue`, `SearchBox.vue`, `Badge.vue`, `FilterDropdown.vue`) are the **legacy**
system. `schools-tokens.css`'s own header says: *"Pairs with the legacy schools-tokens.css (Frostwell
Courtyard) during the screen-by-screen migration. Once every view is migrated, schools-tokens.css is
removed."* — `schools-design.css` (header: *"SSi Schools — 2026-05 design system (Aran)"*) is the
system that actually shipped. Grepping real usage confirms it:

```
FrostCard usage in views/schools + components/schools:  1 file (NodeEntitlementControl.vue) + its own definition
shared/Button.vue usage:                                  1 file (same)
shared/SearchBox / Badge / FilterDropdown usage:           1 file (same)
schools-card usage:                                       12 files
btn-play usage:                                            14 files
```

So `FrostCard`/`Button`/`SearchBox`/`Badge`/`FilterDropdown` are effectively vestigial (one
consumer, `NodeEntitlementControl.vue`) — do not design the Training page against them. The real,
load-bearing primitives are the plain CSS utility classes in `schools-design.css` (`.schools-card`,
`.btn-play`, `.btn-ghost`, `.status-pill`, `.filter-bar`, `table.ssi-table`) plus a small set of
genuinely-shared Vue components (`Greeting`, `BeltDot`, `HealthDot`, `Bench`). That's the palette
below.

---

## 1. The shell

**File:** `containers/SchoolsContainer.vue` + `components/schools/shared/SchoolsTopBar.vue`

Nav is role-computed (`tabs` computed in `SchoolsTopBar.vue`), four shapes:

- **govt_admin / leader, with a group** (the modern node-hierarchy path): `Organisation` →
  `/org/:groupId`, `Insights` → `/org/:groupId/insights`. Legacy no-group govt_admin rows fall back
  to the flat `Schools` (`/schools/all`) / `Analytics` (`/schools/analytics`) pair.
- **school_admin, with a school_id**: `Dashboard` → `/org/:schoolId` (the school's node home),
  `Classes` → `/schools/classes`, `Students` → `/schools/students`, `Insights` →
  `/org/:schoolId/insights`, plus `Upgrade` if seat-purchase is available. (Legacy no-school rows
  get the old flat 5-tab set incl. `Teachers` and `/schools/analytics`.)
- **teacher (default)**: `Dashboard` (`/schools`) → `Students` (`/schools/students`) → `Insights`
  (`/schools/analytics`), plus `Upgrade` only for a school-less (tutor) teacher.

Quoted from the tab-building logic:
```ts
return [
  { label: 'Organisation', to: `/org/${groupId}`, routeName: 'org-node-home' },
  { label: 'Insights', to: `/org/${groupId}/insights`, routeName: 'org-node-insights' },
]
// school_admin, schoolId case:
return [
  { label: 'Dashboard', to: `/org/${schoolId}`, routeName: 'org-node-home' },
  { label: 'Classes',   to: '/schools/classes',   routeName: 'classes' },
  { label: 'Students',  to: '/schools/students',  routeName: 'students' },
  { label: 'Insights',  to: `/org/${schoolId}/insights`, routeName: 'org-node-insights' },
  ...upgradeTab.value,
]
```
`Settings` is deliberately **not** a top tab for a school admin — it lives in the user-menu popover
("account-shaped, not a daily destination" per the code comment) alongside `Sign out` / `My player`.

**Where a Training tab slots in:** the tab list is a flat array rendered identically on desktop
(`nav.tabs`) and in the mobile hamburger drawer (`nav.mobile-nav`) — adding an entry is a one-line
push into each role's array. Given Settings' precedent (account-shaped → user menu, not a tab), and
given the explainer system already has a live, well-established "quiet secondary door" pattern (§5),
my recommendation is **do not add a new top-level tab at all** — see §5/recommendation at the foot
of this document.

**Safe-area handling** (iOS notch/status bar): the bar grows by `env(safe-area-inset-top)` rather
than eating into its 54px content height —
```css
.schools-topbar {
  height: calc(54px + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) max(24px, env(safe-area-inset-right, 0px)) 0 max(24px, env(safe-area-inset-left, 0px));
}
```
`.main-content` then adds `margin-top: var(--nav-height, 80px)` **without** re-adding the inset
(the topbar already owns it — the code comment flags this as a fixed double-count bug). Any new
full-page view should sit inside `<main class="main-content">` and never invent its own top padding
for the notch.

---

## 2. The primitives — real palette (ignore the Frost* family per the correction above)

| Component | File | Props | When to use |
|---|---|---|---|
| **Greeting** | `shared/Greeting.vue` | `name`, `lines?`, `date?`, `dense?` (+ `#action` slot) | Page-top header block: date kicker → Arsenal-serif H1 name → optional lede line → right-aligned action slot. `dense` (bound to `useSchoolsDensity`, see §3) shrinks the name from 46px→30px and tightens margins. This is THE page-header primitive — every dashboard-style view opens with it. |
| **BeltDot** | `shared/BeltDot.vue` | `belt: Belt`, `size?` (14), `ring?` | Small circular belt-colour swatch next to a class/student name. `ring` adds an inset dark rim. Colour comes from `var(--schools-belt-{belt})`. |
| **HealthDot** | `shared/HealthDot.vue` | `health?: 'excellent'\|'good'\|'needs-attention'\|'inactive'`, `size?` (8) | Small status dot, colour from `var(--schools-health-{health})`, with an `aria-label`/`title` for the state word. |
| **Bench** | `shared/Bench.vue` | `data: {class,school,course}`, `unit?` ('m') | Three stacked horizontal mini-bars comparing a value at class/school/global scope — the "benchmarks" pattern used on the teacher dashboard. |
| `.schools-card` (+ `.schools-card-pad`) | CSS class, `schools-design.css` | — | The actual card surface: white bg, `--schools-border`, `--schools-radius-lg` (12px), `--schools-shadow-sm`. This is what real views use, not `FrostCard`. |
| `.btn-play` | CSS class | — | Primary red action button (`--schools-red` → darkens to `--schools-red-deep` on hover). 14 real call-sites. |
| `.btn-ghost` | CSS class | — | Secondary outlined/transparent button, red border+text on hover. |
| `.status-pill` (`.tone-green/blue/gold/red/muted`) | CSS class | — | Small pill badge. **Contrast rule baked into the CSS comment**: tone fills stay pale, but pill *text* always uses the darker `-ink` variant (`--tone-green-ink` etc.) — never the pale fill colour for text. |
| `.filter-bar` / `.filter-bar-input` | CSS class | — | The one instant-search input shape used across Setup's tabs, Try Links, Users. |
| `table.ssi-table` | CSS class | — | Standard data table: uppercase 11px letter-spaced header row on `#fafafa`, row hover `#fafaf8`. |

The `Frost*` family (glass-morphism, blur/backdrop-filter, `--glass-bg`, `--tone-*` rim glows) is
real, well-built code — just not the system in force. Do not reach for it.

---

## 3. The tokens

Two token layers apply inside `.schools-surface`, and they **use different reds** — this is a real,
deliberate distinction, not a bug: the general player-wide brand red is `--ssi-red: #c23a3a`
(`design-tokens.css`, mist theme), but the schools surface overrides to its own, more saturated
brand red:

```css
/* schools-design.css — the live layer */
--font-display: 'Arsenal', 'Georgia', 'Times New Roman', serif;
--font-body:    'Open Sans', 'Trebuchet MS', system-ui, Arial, sans-serif;

--schools-bg:            #f6f5f1;   /* page bg under the white card */
--schools-page-backdrop: #e8e5dd;   /* outer page at large viewports */
--schools-card:          #ffffff;
--schools-border:        rgba(15,18,18,.10);
--schools-border-strong: rgba(15,18,18,.18);
--schools-fg:            #0F1212;
--schools-fg-2:          #555555;
--schools-fg-3:          #6b6b6b;   /* darkened 2026-07 — #888 failed AA vs putty bg */
--schools-red:           #DB1E17;
--schools-red-deep:      #900600;
--schools-pastel:        #F2D7D7;
--schools-gold:          #FEC902;
--schools-success:       #1F8A5B;

/* belt scale */
--schools-belt-white/yellow/orange/green/blue/purple/brown/black

/* health states */
--schools-health-excellent/good/needs-attention/inactive

/* role accents */
--schools-role-teacher: #1F8A5B;  --schools-role-admin: #3768c4;  --schools-role-govt: #900600;

--schools-shadow-sm/md/lg
--schools-radius-sm(6px)/md(8px)/lg(12px)/pill(999px)
```

The `.arsenal` utility class (`font-family: var(--font-display); font-weight: 400; letter-spacing:
-0.005em;`) is how the serif display face gets applied to any heading — every H1/H2 on real views
carries it (`<h1 class="arsenal page-title">`, `<h2 class="arsenal panel-title">`).

The older Frostwell layer's `--tone-*-ink` variants (`--tone-green-ink`, `--tone-blue-ink`,
`--tone-gold-ink`) are still consumed by the live `.status-pill` rules in `schools-design.css` — so
that one small piece of the legacy token file (`schools-tokens.css`) is not actually dead, it's
still imported second in `SchoolsContainer.vue`:
```ts
import '@/styles/schools-tokens.css'
import '@/styles/schools-design.css'
```

**Density** (`composables/schools/useSchoolsDensity.ts`) is a `'compact' | 'detailed'` toggle,
persisted to `localStorage['ssi-schools-density']`, read by `Greeting`'s `:dense` prop and by
views themselves branching their whole layout (`DashboardView.vue` renders either a dense table
`.teacher-compact` or a `.class-grid` of cards depending on `density.value`). **A new Training page
does not need to branch on density** — it is not a data-density page — but if it renders any
`Greeting` header it should pass `:dense="density === 'compact'"` for visual consistency with
whatever page the learner arrived from.

---

## 4. The page pattern (DashboardView.vue / SettingsView.vue as exemplars)

**Skeleton, both views:**
1. `<main>`/`<div>` root class matching the view name (`.dashboard-view`, `.settings-screen`).
2. Optional error/status banners (`.fetch-error-banner`) and an `<UpdatedStamp />` row.
3. Either a `Greeting` (dashboard-style pages) or a bare `<h1 class="arsenal page-title">` +
   two-column `.settings-layout` (settings-style pages: a `.schools-card.section-nav` aside of
   `.section-link` buttons + a `.settings-content` pane).
4. Section body: `.schools-card.schools-card-pad` wrapped panels, each with an
   `<h2 class="arsenal panel-title">` (or `<h3 class="arsenal card-header-title">` for a smaller
   sub-card), body content, then a `.panel-actions` row of `.btn-play` / `.btn-ghost`.
5. Empty states are a plain `<div class="empty-state">` (or `.empty-state.full` inside a grid) with
   a `<p>` and, where an action exists, a `.btn-play.empty-hero-cta` button.
6. List rows: either a CSS-grid "compact" table row (`.teacher-compact-row`, columns declared in a
   `-head` sibling) or a `.schools-card.class-panel` grid of cards — the density switch (§3)
   controls which.

**Representative block, DashboardView.vue** (teacher, compact density):
```html
<Greeting :name="greetingName" :lines="greetingLines" :date="todayLabel" :dense="density === 'compact'">
  <template #action>
    <button v-if="showMissionAffordance" type="button" class="btn-ghost" @click="handleTryMission">
      Take a guided look
    </button>
    <button v-if="!isAdminView" type="button" class="btn-ghost" @click="isCreateModalOpen = true">+ Create class</button>
  </template>
</Greeting>

<div v-if="density === 'compact'" class="schools-card teacher-compact">
  <div class="teacher-compact-head">
    <div>Class</div><div>Course</div><div>Benchmarks (cycles vs school · global)</div><div>Code</div><div></div>
  </div>
  <div v-for="cls in teacherClasses" class="teacher-compact-row">
    <router-link :to="schoolsLink('class-detail', { classId: cls.id })" class="class-link">
      <BeltDot belt="white" :size="28" ring />
      <div class="class-link-text">
        <div class="class-name">{{ cls.class_name }}</div>
        <div class="class-meta">{{ cls.student_count }} students</div>
      </div>
    </router-link>
    …
    <button v-if="canPlayAsClass" class="btn-play" @click="handlePlayClass(cls)">▶ Play as class</button>
  </div>
  <div v-else-if="!teacherClasses.length" class="empty-state">
    <p>No classes yet.</p>
    <button v-if="!isAdminView" type="button" class="btn-play empty-hero-cta" @click="isCreateModalOpen = true">Create your first class</button>
  </div>
</div>
```

**Representative block, SettingsView.vue** (section-nav + panel pattern):
```html
<main class="settings-screen">
  <h1 class="arsenal page-title">Settings</h1>
  <div class="settings-layout">
    <aside class="schools-card section-nav">
      <button v-for="s in visibleSections" class="section-link" :class="{ active: activeSection === s.id }">
        {{ s.label }}
      </button>
    </aside>
    <div class="settings-content">
      <section v-if="activeSection === 'profile'" class="schools-card schools-card-pad panel">
        <h2 class="arsenal panel-title">School profile</h2>
        <label class="field">
          <span class="field-label">School name</span>
          <input v-model="schoolNameEdit" class="field-input" type="text" :readonly="!canEditSchool" />
        </label>
        …
        <div v-if="canEditSchool" class="panel-actions">
          <button type="button" class="btn-play" @click="saveSchoolProfile">Save</button>
          <button type="button" class="btn-ghost">Cancel</button>
        </div>
      </section>
    </div>
  </div>
</main>
```

**A Training/Handbook page with multiple articles (Getting started, Running a class session, …)
maps cleanly onto the SettingsView shape**: `.section-nav` aside listing article titles,
`.settings-content` pane rendering the selected one as a `.schools-card.schools-card-pad.panel`
with `.field`-style prose or numbered steps instead of form fields.

---

## 5. The walk overlay / noticing-invitation affordance (Tom: "too subtle, too small")

**The active walkthrough card** (`components/admin/WalkOverlay.vue` + `walkthrough/overlayPlacement.ts`,
mounted once in `App.vue`):
- Card is a fixed-width **340px** (`CARD_W`) box, ~190px estimated height (`CARD_H_EST`), placed
  near the anchored element or bottom-center if unanchored/terminal — but **never** over the top
  54px + safe-area chrome (the "back-to-player invariant").
- The anchored element gets a **2px solid red ring** (`border: 2px solid var(--schools-red,
  #DB1E17)`) with 6px padding (`PAD`) around its bounding box, plus a pulsing duplicate ring
  (`.walk-pulse`, scale 1→1.12, opacity 0.7→0, 1.6s ease-out loop).
- The overlay itself is `pointer-events: none` except the card — deliberately non-modal, page stays
  interactive underneath.
- Card content (kicker/say/step-dots/Back-Next-Skip) is `WalkCard.vue`, shared with the org
  onboarding gate ("one teaching voice, not two").

**The *offer* to start a walk / explainer** — the quieter, separate affordance Tom means by "the
current clips" — is a genuinely different, smaller mechanism: `useNoticingInvitations.ts` (feeding
inline on-page invitation cards) and, on the learner profile, `HowThisWorksLearner.vue`'s toggle
link:
```html
<button type="button" class="lx-toggle" :class="{ 'is-armed': throbbing && !open }" @click="toggle">
  <span v-if="throbbing && !open" class="lx-dot" aria-hidden="true"></span>
  {{ open ? 'Close' : label }}
</button>
```
```css
.lx-toggle { font-size: 12px; color: var(--ink-tertiary, #8A8078); text-decoration: underline; }
.lx-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--schools-red, #DB1E17);
          animation: lx-throb 2.6s ease-in-out infinite; } /* opacity 0.35 ↔ 0.85 */
```
That is the whole affordance: a 12px underlined text link, armed by a single **6px** pulsing dot,
persisted seen-state in localStorage, never opens uninvited. This is almost certainly what Tom is
calling "too subtle, too small" — a 6px dot and 12px link is genuinely easy to miss against a busy
dashboard. "Louder" concretely means, in this vocabulary: a bigger hit target (the whole row/card
becomes clickable, not just the text), a bigger and more colour-saturated dot or a small icon
instead of a bare dot, and/or promoting it from a trailing text link to a visible `.btn-ghost`-style
chip with a label like "New here?" or "How this works". None of that requires inventing new tokens
— `.btn-ghost` plus a bigger dot (e.g. 10-12px, still `--schools-red`, still the same throb keyframe)
stays inside the existing system.

**Does a hub pattern already exist that a schools handbook could mirror? Yes — the `HowThisWorksLearner.vue` pattern is exactly a hub**: one quiet toggle, expands in-place to a `.lx-card` with a
kicker, an intro paragraph, then repeating `.lx-block` sections (heading + paragraphs + optional
figure + optional bullet list). This is a self-contained, already-built content-hub shape that a
Training/Handbook article list could reuse directly (or pattern-match): kicker → intro → N
blocks, each with a heading and body. The admin/leader/school_admin/teacher explainer content itself
(§6, `tools/explainer/rulings/*.md`) is prose already written in exactly this per-node-kind,
per-persona structure and could plausibly seed the Handbook's first drafts.

---

## 6. The prose rules

Two content-law sources apply, and they are NOT identical in scope — the rulings files are the
narrower, persona-specific mechanism copy; `learnerExplainers.ts`'s header carries the broader,
harder laws that would also bind a schools Handbook written for teachers/admins:

**From `learnerExplainers.ts` header (hard content laws, "founder rulings 2026-08-03"):**
- Voice: "dog, not dentist" — unconditionally warm, brief, never disappointed, never lecturing.
- British English.
- **No parentheses used as explanation** — sentences must carry the distinction themselves (this is
  the same "no parentheses" law that governs the course-content methodology elsewhere in this
  estate — it applies here too).
- Hard bans, anywhere: no streaks, no days-since, no missed-day/guilt language; no incentive points,
  score, XP, or leaderboard.
- **The language wall**: no internal or non-self-evident technical terminology is ever
  learner-facing — write "a go", "the thing you just said", "listening deep dives", never internal
  names.
- The "thirty-hour promise" lives only in the Why-this-works section, never repeated as a headline.

**From `tools/explainer/rulings/*.md`** (persona-scoped mechanism copy, admin/leader/school_admin/
teacher): each file is explicitly "mechanism only, never restated state" — describing what a button
*does* and why a number means what it means, never quoting a live count. Tone is plain, declarative,
short paragraphs, one heading per node-kind (`org`/`group`/`school`/`class`). Bold is used sparingly,
only on the term being defined in that sentence (e.g. **"Invite a person"**, **"Class practice"**).
No bullet lists in these four files at all — every ruling is prose paragraphs. A Training/Handbook
page written in this voice should therefore favour short declarative paragraphs over bullet-heavy
copy, reserve bold for the UI label being explained, and never state a number or a fact that could
go stale (describe the mechanism, not the current state).

---

## Recommendation: where does Training/Handbook belong?

**Do not add a new top-level nav tab.** Three reasons, all drawn from the code above:
1. `Settings` — the closest precedent for an "account-shaped, not a daily destination" surface — was
   deliberately kept OUT of the tab bar and put in the user-menu popover instead. A Handbook is even
   less a daily destination than Settings.
2. Every tab array is role-branched four ways and now doubles as the mobile hamburger drawer content
   — a fifth entry added to every branch is real surface-area cost for a page nobody needs on every
   visit.
3. The estate already has a converged, working, *reusable* hub pattern for exactly this kind of
   content — `HowThisWorksLearner.vue`'s toggle-and-expand-inline shape (§5) — which was built,
   named, and content-law-audited specifically so this kind of "how does this work" material doesn't
   need its own page.

**Concrete recommendation:** put Training/Handbook in the **user-menu popover** (`SchoolsTopBar.vue`'s
`.user-menu-pop`, alongside `School settings` / `My player` / `Sign out`), as a new `menu-item` router
link to `/schools/handbook` (or similar), and build that destination page using the **SettingsView
section-nav + panel shape** (§4) with articles instead of settings forms. That reuses: the nav slot
that already exists for "account-shaped, not daily" surfaces, the page skeleton that's already built
for exactly this "list of named sections down the left, content on the right" shape, and the prose
voice from `tools/explainer/rulings/*.md`. If Tom wants it more *discoverable* than a menu item (a
real concern — the user-menu is genuinely low-visibility), the second thing worth doing is exactly
the "louder" fix from §5: a `.btn-ghost`-styled "Handbook" chip in `SchoolsTopBar.vue`'s `.right`
group, next to the existing `Learn` button, using the same throbbing-dot-until-first-open mechanism
as `HowThisWorksLearner.vue` to mark it unread.
