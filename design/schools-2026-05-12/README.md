# SSi Schools — design handoff · 12 May 2026

**Target repo:** `thomascassidyzm/ssi-learning-app` (Tom's repo — NOT the marketing-site stage repo)
**Scope:** Full design pass for `/schools` — 11 screens + portal + dashboard explorations

## What's in this bundle

```
design_handoff_schools_2026-05-12/
  index.html                  Portal: links to every screen, with role-route pills
  login.html                  Email → OTP → No-access (state switcher top-right)
  dashboard.html              Teacher view (compact/detailed toggle) + Admin variant
  classes.html                School-wide classes (admin) — filters, summary, table
  class-detail.html           Roster + journey + belts + benchmarks + join code
  students.html               Filterable roster across teacher's classes
  teachers.html               Staff list with invite / role / status
  analytics.html              Period selector, KPIs, per-class breakdown
  student-progress.html       "My Progress" — what a student sees
  settings.html               Profile / Localisation / Data & privacy / Billing
  setup.html                  4-step admin onboarding wizard
  schools-list.html           Govt admin — 10-school programme view
  dashboard-explorations.html Original A/B variant explorer (design history)

  schools.css                 Schools-specific tokens (sits on top of colors_and_type.css)
  colors_and_type.css         Shared marketing-site tokens (Arsenal/Open Sans, palette)
  components/
    schools-data.jsx          All demo data (14 classes, 20 students, 6 teachers, 10 schools)
    schools-shared.jsx        Atoms + chrome + role-switcher + density toggle

  HANDOFF.md                  Full handoff notes (design tokens, patterns, open questions)
  README.md                   This file
```

**Self-contained.** Open `index.html` in a browser — every screen runs offline.
All stylesheet paths have been rewritten from `../../../colors_and_type.css` (their
location inside the design-system project) to `./colors_and_type.css` (bundle-root).

## How this slots into Tom's repo

Two reasonable shapes:

**Option A — drop in as a reference folder** (recommended for first pass):
```
ssi-learning-app/
  design/schools-2026-05-12/   ← drop this whole bundle here
```
Lets engineers cross-reference designs while building, without disturbing app routing.

**Option B — wire into a `/schools/design-preview` route** for live demo:
Serve the bundle statically under that route. Same files, just hosted.

## Building against this

- **Role-aware nav** lives in `components/schools-shared.jsx → NAV_FOR_ROLE`.
- **Role switching** persists to `localStorage.ssi-schools-role` and navigates to the role's landing.
- **Demo data** on `window.SSI_*` — swap for real fixtures from `packages/`.
- **Design tokens** in `schools.css` (`--schools-red`, `--schools-fg`, `--schools-belt-*`).
- Belt scale: white · yellow · orange · green · blue · black.

See `HANDOFF.md` for the full design-tokens / patterns / per-screen notes / open questions.

## Open questions (also in HANDOFF.md)

1. Real student-name fixtures from `packages/`?
2. Is "class belt" the dominant student belt, or set independently?
3. Govt route — Settings exposed there too?
4. Should join codes ever auto-expire?
5. Confirm belt-colour scale.
6. Mobile / responsive — Chromebook-first now; mobile is a follow-up pass.

## What's **NOT** in this bundle

- Anything from the marketing site (`ui_kits/website/`) — that ships separately to the stage repo.
- The "Intensive learning page" work — flagged WIP, excluded from all handoffs until ready.
- The audit doc (`docs/schools-trinity-audit.md`) — already in your repo; the designs are built against it.

---

**Ready to push.** Drop into Tom's repo under `design/schools-2026-05-12/`, open a PR with title:

> `Design: SSi Schools full design pass (12 May 2026) — 11 screens, role-aware`
