# SSi Schools — design pilot

Eleven screens covering the `/schools` surface, designed in the marketing-site visual system (Arsenal + Open Sans, SSi red `#DB1E17`, the existing tone). All screens are 1366×768 (Chromebook), light theme. Role-aware top-right user menu persists the active role across screens via `localStorage` key `ssi-schools-role`.

## Files

```
ui_kits/website/schools/
  index.html                    Portal listing all screens
  login.html                    Email → OTP → No-access (state switcher top-right)
  dashboard.html                Teacher view (compact/detailed toggle) + Admin view
  class-detail.html             Roster + journey + belt distribution + join code
  students.html                 Filterable roster across teacher's classes
  teachers.html                 Staff list with invite/role/status
  analytics.html                Period selector, KPIs, per-class breakdown
  student-progress.html         Self-view a student sees ("My Progress")
  settings.html                 Profile / Localisation / Data & privacy / Billing
  setup.html                    4-step admin onboarding wizard
  schools-list.html             Govt admin programme view (10 schools)
  dashboard-explorations.html   Original A/B variant explorer (kept as design history)
  schools.css                   Schools-specific tokens (sits on top of /colors_and_type.css)
  components/
    schools-data.jsx            All demo data — teachers, classes, students, schools
    schools-shared.jsx          Atoms (BeltDot, Spark, Journey, Bench…), chrome (TopBar,
                                Greeting, NavTabs, RoleSwitcher, DensityToggle, Stage,
                                ScreenShell), and the useRole/useDensity hooks.
```

## Roles + routing

Top-right user menu (RoleSwitcher) flips between three demo users:

- **Teacher** — Erwan Le Bihan (green avatar). Lands on `dashboard.html`. Nav: Dashboard · Students · Analytics.
- **School Admin** — Yannig Pelleau (blue avatar). Lands on `dashboard.html` (admin variant). Nav: Dashboard · Classes · Students · Teachers · Analytics · Settings.
- **Govt Admin** — Loig Caradec (deep-red avatar). Lands on `schools-list.html`. Nav: Schools · Analytics.

Switching role both persists to localStorage and navigates to that role's landing page. `dashboard.html` auto-redirects govt-role users to `schools-list.html`.

## Demo data

A coherent demo school runs across every screen:

- **Skol Diwan Kemper** — bilingual Brezhoneg immersion school in Quimper, Brittany. 312 students, 18 teachers, 14 classes.
- **Three teacher-Erwan classes**: CM1 Brezhoneg (yellow belt class), 5ème Brezhoneg (orange, the strong one), 4ème Español (white, needs attention).
- **20 sample students** across those three classes with realistic names, belts, hours, streaks.
- **Six teachers** including one pending invite.
- **Ten Diwan schools** across Brittany for the govt route.

All data lives on `window.SSI_*` (e.g. `SSI_CLASSES`, `SSI_STUDENTS`, `SSI_TEACHERS`, `SSI_SCHOOLS_LIST`). Easy to swap with real fixtures.

## Design tokens

```
--schools-red:        #DB1E17    primary action / branded accent
--schools-red-deep:   #900600    hover / govt avatar
--schools-fg:         #0F1212    body text
--schools-fg-2:       #555555    subtitles / table secondary
--schools-fg-3:       #888888    table headers / disabled
--schools-border:     rgba(15,18,18,.10)
--schools-bg:         #f6f5f1    page background under the white card
--schools-belt-*:     white #f4f3ef · yellow #f7d24a · orange #ec8a3a ·
                      green #2a8d5e · blue #3768c4 · black #1c1b18
```

Type: Arsenal display, Open Sans body. No new typography introduced.

## Key patterns

- **Single white card on a warm putty backdrop** for every page (matches the marketing-site colour temperature).
- **Compact ↔ Detailed density toggle** on the dashboard — table view vs editorial card view, persisted to `ssi-schools-density`.
- **Belt** rendered as a coloured circle with a subtle inset ring. Belt distribution shown three ways: stacked strip, badge group, or table column.
- **Bench** component shows class avg vs school avg vs global avg as three stacked mini-bars — the existing "benchmarking" feature carried through.
- **Sparkline** (custom SVG) for weekly activity, used on dashboard table and analytics breakdown.
- **Join codes** styled in monospace, called out on a warm yellow panel on class-detail.

## Functionality retained

This is a design pass; no features removed. Every screen surface in the trinity audit is present:

- Login flow with email → OTP → no-access/join-code branch
- Teacher dashboard with compact/detailed density (was the explorations file)
- Class detail with roster, journey, belts, benchmarks, Play-as-Class CTA
- Students list with class/belt/health filters
- Teachers list with invite/role/status
- Analytics with period selector, KPIs, per-class breakdown
- Student "My Progress" self-view (streak, belt, journey)
- Settings (profile, localisation, data & privacy, billing)
- Admin setup wizard (school → staff → courses → classes)
- Govt programme view (schools list with health/comparison)

## Open questions for build

1. **Real student names** — current data uses Breton/Spanish names plausibly fitting a Diwan school; swap with the real fixtures from `packages/`.
2. **Class belt** — I've inferred "class belt" = dominant belt in the distribution. Is that the live model or is it set independently?
3. **Govt route nav** — currently shows Schools + Analytics only. Does the live app also expose Govt-level Settings?
4. **Join-code rotation** — should join codes ever auto-expire? UI assumes they're static for now.
5. **Belt colours** — using a simple six-colour scale (white/yellow/orange/green/blue/black). Confirm against your actual belt progression.
6. **Mobile / responsive** — Chromebook-first, as agreed. We'll do mobile + tablet as a follow-up pass.

## Status

- Excluded from marketing-site stage repo pushes (per project notes).
- When ready to hand off, bundle as `design_handoff_schools_<date>/` separately from the marketing-site handoff.
