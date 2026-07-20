# Addendum — play-as-class names the CLASS (2026-07-18)

Extends the identity-first navbar ruling to the play-as-class session.

## Founder critique (verbatim)

> "the play as class doesn't identify the class playing!!!! it does the school
> and the teacher and a bunch of chrome with links and so on, without actually
> saying which class is playing — this will be a nightmare for teachers."

The real scenario: a teacher with several classes, on a projector or shared
device, running play-as-class sessions back to back. The ONE thing the screen
must say is WHICH CLASS is live.

## The principle (extends the navbar hierarchy)

Identity in the bar = the **MOST SPECIFIC ACTIVE CONTEXT**. A play-as-class
session is more specific than the school or the teacher, so while the mode is
active the **class name is the primary identity** — big, bold, unmissable —
and school/teacher/section-chrome demote or drop. This mirrors what View-as
(`ActingAsBanner`) already does for an impersonated persona; we reuse its
visual language (a live-status pill with a one-tap exit) so the two "you are in
a scoped context" states read the same.

## What changed

- **`PlayAsClassIdentity.vue`** (new, shared) — a red live-status pill: a
  pulsing dot, `PLAYING AS`, the **class name** as the dominant element (20px
  bold), the school demoted to a quiet secondary line, and an obvious
  **End session** button. On phone widths the kicker + school line drop, keeping
  the class name and exit.
- **`usePlayAsClassContext.ts`** (new, shared) — reads the active-class payload
  every launcher already writes (`ssi-active-class` / demo
  `ssi-demo-active-class`), gated so the identity shows ONLY for a real class
  session: on a play route, launched with `?class=`, and the stored id matches
  it. Staff self-practice via the Learn button (same route, no `?class=`) is
  unaffected, and a stale storage row can't false-trigger it. `exitClassSession`
  clears the payload + query and returns to the classes list (schools) or the
  tutor dashboard (teach).
- **`SchoolsTopBar.vue`** and **`TopNav.vue`** — while a class session is live,
  the section tabs, the school label/badge, and the self-practice Learn launcher
  are dropped, and `PlayAsClassIdentity` takes their place as the dominant
  element. Both persistent top bars stay above the embedded player, so the class
  identity is visible throughout the session, not just on entry. Covers both
  play-as-class shells: schools (`/schools/play`) and tutors
  (`/tutors/dashboard/play`).

## Bug found + fixed while verifying

Launching play-as-class for a class whose enrollment had ever been practised
white-screened the whole player ("Something went wrong") with
`last_practiced_at.getTime is not a function`. The class-progress endpoint
returns raw JSON (ISO-string timestamps), but the base
`ProgressStore.getEnrollment` returns `Date` objects and callers call
`.getTime()` on them. Fixed by hydrating `last_practiced_at` / `enrolled_at` to
`Date` at the class-aware store boundary (`useClassProgressStore.ts`) so it
matches the base contract. Pre-existing; surfaced only because verification
actually launched a live session on a real practised class.

## Verified on the deployed dev build

`git-dev-zenjin` alias, teacher session, real class **Ang School Y7 Welsh**,
launched from ClassDetail → `/schools/play?class=…`. Harness:
`packages/player-vue/e2e/schools-nav/shoot-playasclass-identity.mjs` (6/6
checks: bar names the class, exit present, section tabs dropped — desktop +
phone). The player mounts cleanly (crash fixed) with the bar reading
"● PLAYING AS **Ang School Y7 Welsh** · End session".

- Desktop: `img/addendum-playasclass-desktop.png`
- Phone: `img/addendum-playasclass-phone.png`

Component tests: `SchoolsTopBar.playAsClass.test.ts` (class name renders
prominently; tabs + Learn dropped; NOT shown for self-practice or a stale-id
mismatch) and the date-hydration regression tests in
`useClassProgressStore.test.ts`.
