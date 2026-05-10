# Frostwell Courtyard — design canon

The single reference for any management surface in this codebase. If you're
porting a screen, building a new admin/teach surface, or reviewing a PR,
this is the canon. Surfaces drift; this doc doesn't.

> **Scope.** Frostwell Courtyard governs everything *outside* the player.
> The player itself (`/`, `/pods`, `LearningPlayer.vue`) is **Moonlit Dojo**
> — dark sanctuary, belt-coloured accents — and stays that way. This doc
> does not apply there.

---

## 0. The design test

**Every change must satisfy all three:**

- **Better** — clearer to the user, less cognitive load, fewer mistakes possible.
- **Simpler** — fewer code paths, fewer states to track, fewer edge cases.
- **Cheaper** — fewer DB rows, fewer API calls, fewer entitlement overrides,
  less administrate burden, less compute, less bandwidth.

If a proposal improves one and degrades another, it doesn't pass. Reject or
rework. This rule is the tiebreaker for every aesthetic, structural and
data-modelling choice in this doc.

---

## 1. The capability model

**Capabilities are derived, never stored.** No `canTeach` column, no role
enum, no account-type field, no "promote to teacher" flow as separate code.

```
canTeach = (educational_role !== 'student') OR has_paid_subscription
canAdmin = (platform_role === 'ssi_admin')
canLearn = always true
```

This expands to:

| User type | educational_role | paid_sub | canTeach | canAdmin |
|---|---|---|---|---|
| Pure learner (subscriber) | `null` | yes | ✓ | ✗ |
| Tutor (paying for teach access) | `null` or `teacher` | yes | ✓ | ✗ |
| School teacher | `teacher` | no | ✓ | ✗ |
| School admin | `school_admin` | no | ✓ | ✗ |
| Govt admin | `govt_admin` | no | ✓ | ✗ |
| School student (joined via student code) | `student` | no | ✗ | ✗ |
| Tutor's student (via /with/:code) | `student` | no | ✗ | ✗ |
| ssi_admin | `god` | n/a | ✓ | ✓ |

A school student becomes able to teach the moment they pay for their own
subscription — state changes naturally. **No upgrade flow needed.**

**Server enforces** the gates via RLS / API checks.
**Client UI hides** affordances the user lacks. Hiding is for cleanliness;
it is never the security boundary.

---

## 2. Tokens

Two token files. Know which is which.

### `packages/player-vue/src/styles/design-tokens.css`
- Brand colours (`--ssi-red`, `--ssi-gold`, `--ssi-red-light`, …)
- Status colours (`--success`, `--warning`, `--error`, `--info`)
- Belt colours (`--belt-white` … `--belt-black`)
- Typography (`--font-body: 'DM Sans'`, `--font-display: 'Noto Sans JP'`,
  `--font-mono: 'JetBrains Mono'`)
- Spacing scale (4px base, `--space-1` … `--space-24`)
- Radii (`--radius-sm` … `--radius-full`)
- Transitions, easing, z-index

These are global. Use them everywhere.

### `packages/player-vue/src/styles/schools-tokens.css`
Scoped to `.schools-surface`. Only applies inside the management surfaces.

- Glass surfaces: `--glass-bg`, `--glass-bg-strong`, `--glass-bg-hover`,
  `--glass-border`, `--glass-sheen`, `--glass-shadow`, `--glass-shadow-hover`
- Tonal triplets (RGB triplets, used inside `rgb(...)` / `rgba(...)`):
  - `--tone-blue: 96, 165, 250`
  - `--tone-gold: 212, 168, 83`
  - `--tone-red: 217, 69, 69`
  - `--tone-green: 74, 222, 128`
- Ink hierarchy: `--ink-primary` (#2C2622), `--ink-secondary` (#4A4440),
  `--ink-muted` (#8A8078), `--ink-faint` (#B5AEA6)
- Typography helpers: `.frost-eyebrow`, `.frost-section-title`,
  `.frost-display`, `.frost-mono-nums`

**Tonal semantic:**
- **blue** — info, auth-related, neutral indicators
- **gold** — value, money, entitlements, "this is the active/important thing"
- **red** — destructive, warnings, brand-primary CTAs
- **green** — success, active grants, "has it"

### Hard rules

- **No hardcoded colour values in components.** Ever. If a value isn't in a
  token, add the token first.
- **No hex literals in templates** (`#fff`, `#c23a3a`) — use tokens.
- **No `rgba(...)` literals** — use tonal triplets: `rgba(var(--tone-red), 0.18)`.
- **Frostwell tokens (`--glass-*`, `--tone-*`, `--ink-*`) only apply inside
  `.schools-surface`.** A management container must render with `class="schools-surface"`
  somewhere up the tree (SchoolsContainer, AdminContainer, etc.). The schools
  reference container does this; new containers must do the same.

---

## 3. Component palette

All in `packages/player-vue/src/components/schools/shared/`.

### `FrostCard` — the surface primitive

Three variants. Pick by purpose, not by aesthetic preference.

| Variant | Use for | Min-height / radius |
|---|---|---|
| `panel`  | Forms, sections, table wrappers, detail views | flexible · 22px radius |
| `tile`   | Grid items, list rows that are themselves a card | flexible · 18px radius |
| `stone`  | Compact metric tiles (single number + label) | 140px · 22px radius · belt-tone rim |

Tones (`blue` / `gold` / `red` / `green`) drive rim glow on `stone` and hover
accent on `tile`. Ignored on `panel` unless `hoverable` is set.

```vue
<FrostCard variant="panel">
  <!-- form, section, or table inside -->
</FrostCard>

<FrostCard variant="tile" tone="gold" :hoverable="true" as="button" @click="…">
  <!-- list item / grid item -->
</FrostCard>

<FrostCard variant="stone" tone="green">
  <span class="stone-label">Active classes</span>
  <span class="stone-value frost-mono-nums">23</span>
</FrostCard>
```

### `SearchBox`, `FilterDropdown`, `Badge`, `Button`

Use these directly. Don't reinvent. Don't wrap in your own component just to
restyle. If they don't do what you need, extend the shared component.

### `AtmosphereBackdrop`

Renders the warm gradient canvas behind the management surfaces. **Every
container that hosts management routes must render this.** SchoolsContainer
does. AdminContainer must. AdminSchoolsContainer / AdminGroupContainer do
(I added them yesterday). New containers must.

### What NOT to use

- ❌ `packages/player-vue/src/components/schools/shared/Card.vue` — the old
  generic card. Being phased out. Don't import it in new code.
- ❌ Custom `Modal.vue` per surface. We have one decision rule (§5.4); follow it.
- ❌ Custom `StatsCard.vue` (in `components/schools/`). Use `FrostCard variant="stone"`
  instead.

---

## 4. Reference implementations

When in doubt, copy from these. They're on-canon. (Not perfect — both are
1000+ line monolithic files — but the patterns are right.)

- **`packages/player-vue/src/views/schools/StudentsView.vue`** — table-inside-panel
  with hover-reveal actions, search + filter bar, page header, detail panel,
  empty state. The most complete reference for dense list surfaces.
- **`packages/player-vue/src/views/schools/TeachersView.vue`** — page header
  with count chip + Export/Add buttons, JoinCodeBanner heroes, filters bar,
  card grid layout.
- **`packages/player-vue/src/views/schools/DashboardView.vue`** — stone metric
  tiles, multi-section page, atmosphere usage.

---

## 5. Patterns

### 5.1 Page header

Every management page starts with this. No exceptions.

```vue
<header class="page-header">
  <div class="title-block">
    <h1 class="frost-display">{{ pageTitle }}</h1>
    <div class="metrics">
      <span class="metric">
        <span class="metric-value frost-mono-nums">{{ count }}</span>
        {{ label }}
      </span>
    </div>
  </div>
  <div class="header-actions">
    <Button variant="ghost" @click="…">Export</Button>
    <Button variant="primary" @click="…">+ Add {{ thing }}</Button>
  </div>
</header>
```

- Title in `--font-display` (Noto Sans JP), `--text-3xl`, `-0.015em` letter-spacing
- Count chip uses `frost-mono-nums` for the number
- Primary action right-aligned, ghost actions to its left
- Metrics inline with the title — not a separate KPI row, not stone tiles
  unless the data genuinely warrants a metric tile (rare — most pages don't)

### 5.2 Filters bar

Below the page header, before the content.

```vue
<div class="filters-bar">
  <SearchBox v-model="searchQuery" placeholder="Search by name…" />
  <FilterDropdown v-model="selectedFilter" :options="filterOptions" />
</div>
```

- Search takes the leftover space (`flex: 1` on the search slot)
- Filters to the right
- Filters bar is its own row — never embedded inside a card header

### 5.3 Table inside FrostCard panel (the dense list pattern)

For any list with > ~10 items where the user needs to scan/filter/find.

```vue
<FrostCard variant="panel" class="list-panel">
  <table class="list-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Other</th>
        <th aria-label="Actions"></th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in filtered" :key="row.id">
        <td>…</td>
        <td>…</td>
        <td class="cell-actions">
          <div class="row-actions">
            <button class="row-action" title="View">…</button>
            <button class="row-action is-danger" title="Remove">…</button>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</FrostCard>
```

Key behaviours:

- `thead th`: `font-mono` 10px uppercase letter-spaced 0.14em, `--ink-muted`,
  bottom border `rgba(44,38,34,0.08)`
- `tbody tr:hover`: background `rgba(255,255,255,0.48)`. **No row lift transform.**
  Lifting 30 rows during scroll is visually noisy.
- Actions: opacity 0 by default, opacity 1 on `tr:hover` or `tr:focus-within`
- Action buttons are icon-only; tooltips on `title=`. Reveal on hover (desktop)
  or always-visible at 0.5 opacity if the surface needs to support touch.

### 5.4 Form decisions

This rule is binding. Follow it. If you're tempted to break it, change the rule
in this doc first via PR; don't fork the pattern silently.

| Form size | Pattern |
|---|---|
| 1–3 fields | **Inline panel** — FrostCard panel that expands above/below the relevant context. Save closes it. |
| Wizard / multi-step / many fields | **Modal** — full overlay, focus trap, Cancel + Save. |
| Long-running edit (settings, profile) | **Drawer or dedicated route** — no modal. |

Anti-patterns (don't do):
- ❌ Form embedded inside a Card header (AdminPanel.vue currently — port it)
- ❌ Toolbar inside a Card header (AdminUsers.vue currently — port it)
- ❌ Modal for a 2-field form

### 5.5 Empty state

Centred. Oversized ghost text in the display font. Short copy. CTA if there's
a meaningful action to offer.

```vue
<div class="empty">
  <div class="empty-ghost">{{ thing }}</div>
  <div class="empty-copy">
    <strong>No {{ thing }} {{ filtered ? 'match these filters' : 'yet' }}</strong>
    <p v-if="!filtered">{{ explainerCopy }}</p>
  </div>
  <Button v-if="!filtered" variant="primary" @click="…">+ Add {{ thing }}</Button>
</div>
```

Ghost text: `--font-display`, 88px, `--font-bold`, `-0.03em`, `--ink-faint` at
0.35 opacity. Lowercase, short.

### 5.6 Hover-reveal actions

Already covered in §5.3. The principle: list rows show data clean by default,
actions appear when the user is interacting with that row. Less noise across
30+ rows.

### 5.7 Buttons

Canonical palette — use the shared `Button` component:

| Variant | Use for | Token |
|---|---|---|
| `primary` | The one main action on the screen | `--ssi-red` background, white text |
| `ghost` | Secondary actions (Export, Cancel) | transparent / glass surface, ink text |
| `danger` | Destructive (Delete, Revoke) | `rgba(var(--tone-red), …)` |
| `icon` | Single-icon actions in dense rows | square, no label |

**One primary per screen.** If you have two equally-important actions, one of
them isn't actually primary.

---

## 6. Layout decisions

### 6.1 Containers and chrome

| Surface | Container | Renders AtmosphereBackdrop? | TopNav? |
|---|---|---|---|
| `/admin/*` | `AdminContainer` | should — confirm | Admin top nav |
| `/admin/schools/:id/*` | `AdminSchoolsContainer` | yes | schools `TopNav` |
| `/admin/groups/:id/*` | `AdminGroupContainer` | yes | schools `TopNav` |
| `/schools/*` | `SchoolsContainer` | yes | schools `TopNav` |
| `/teach/*` | `TeachContainer` | should — confirm | schools `TopNav` (same as schools) |
| `/redeem/:code`, `/try/:code`, `/with/:code`, `/demo` | view-level | yes | minimal/none |
| `/`, `/pods` (player) | `PlayerContainer` | **NO** — this is Moonlit Dojo | own header |

### 6.2 Persistent top-nav frame for desktop (target state)

When a teacher launches a class from `/teach`, the player renders **inside**
the teach chrome under a persistent TopNav. The active class is shown as a
"playing as" pill in the TopNav. This eliminates the redundant class identifier
strip currently inside the player.

**Out of scope for this canon doc** — it's a separate routing/layout refactor
(task #14). When that lands, this section gets updated to bind it.

### 6.3 Mobile player chrome — class mode

**Player layout never changes.** No new pill, no top bar, no compression of
existing layout items. Repurpose what's already there:

| Slot | Learner account | Teacher account in class |
|---|---|---|
| Flag | language flag | language flag (still — the class teaches that language) |
| Title | course name (e.g. "French") | class name (e.g. "Blwyddyn 5") |
| Subtitle | "for English speakers" | omitted |
| Belt + % | own belt + own % | belt + % at most (no Seed N/total) |
| Chevron next to title | course-switcher | course/class switcher |
| Library button (bottom-left) | course library (today) | back to /teach dashboard |

**The chevron** is gold-tinted, 18px, no animation.

**The switcher modal** (existing CourseSwitcher) becomes capability-aware:

- canTeach=false → list courses only (today's behaviour)
- canTeach=true → list courses + classes, with "← Back to dashboard" pinned at top

### 6.4 Active-class state

**Source of truth: URL query param.** `/learn?class=abc123`.

A `useClassContext()` composable reads the param, exposes `currentClass`
reactively, validates the ID against the user's class list on init. Invalid
ID → silently clears, falls back to playing-as-self.

Why URL over storage:
- Refresh preserves context (better)
- Browser back/forward works (better)
- Deep-linkable (Aran can ping you a class URL during support — better)
- No storage to manage (cheaper)
- One source of truth, no race conditions (simpler)

---

## 7. What NOT to do

A short list of patterns to grep for and remove on every port:

- ❌ Hardcoded hex / rgba in any `.vue` file. Use tokens.
- ❌ Generic `Card.vue` from `components/schools/shared/Card.vue` (the old one).
  Use `FrostCard`.
- ❌ Custom `StatsCard` instances. Use `FrostCard variant="stone"`.
- ❌ Form embedded in a `<Card>` header. Move to inline panel or modal per §5.4.
- ❌ Toolbar (search/filter/actions) embedded in a `<Card>` header. Promote to
  its own row per §5.2.
- ❌ Custom modal components per surface. Use the canonical modal pattern
  (or write one and add it to shared components, then update this doc).
- ❌ Role-enum branching (`if (user.role === 'teacher')`). Use capability
  booleans (`if (canTeach)`).
- ❌ Account-type checks (`if (account.type === 'learner')`). There is one
  account type. Capability-derived UI.
- ❌ "AdminCard" / "TeachCard" / "SchoolsCard" — surface-specific component
  variants. There is one card system; surfaces use it.

---

## 8. Where surfaces stand today

Audit captured in the conversation that produced this doc (2026-04-25). Port
priority and status tracked as separate tasks (#10–#15).

**On-canon (reference):** `SchoolsContainer`, `DashboardView`, `StudentsView`,
mostly `TeachersView` and `ClassDetail`.

**Partial drift (mechanical port — Card → FrostCard, tokens):** `AdminUsers`,
`AdminActivity`, `AdminPanel`, `AdminUserDetail`, `AdminCourses`,
`AdminEntitlements`, `AdminTryLinks`.

**Full drift (rewrite):** `TeachDashboard`, `TeachContainer`, `TeachSetup`,
`WithTeacher`, `SchoolsSetup`, `AdminAnalytics`, `AdminClassDetail`,
`AdminUserProgress`, plus `RedeemCode` / `TryLinkGateway` / `DemoLauncher`
(unaudited but assumed drift).

**Wrong design language by design:** `SettingsScreen.vue` is in-player
settings — stays Moonlit Dojo (dark). It's not a management surface; it
appears in this list only because it touches user account state.

---

## 9. Updating this doc

This doc is the canon. When the canon needs to change:

1. Discuss the change in a PR description or issue.
2. Update this doc **first**, in the same PR as the implementation.
3. The PR description should reference which section of this doc changed
   and why.

Don't ship a one-off pattern that disagrees with this doc and "we'll update
the doc later." Either it's worth updating the doc for, or it's drift.

---

*Last updated: 2026-04-25.*
