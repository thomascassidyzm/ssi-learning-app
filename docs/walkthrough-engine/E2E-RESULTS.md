# Walkthrough engine — deployed-dev e2e results

**Run: 2026-07-28 07:58Z · `packages/player-vue/e2e/walkthrough/five-walks.mjs` ·
target `https://ssi-learning-app-git-dev-zenjin.vercel.app` (deployed dev build) ·
116 PASS / 0 FAIL / 1 note · full console output in `e2e-run.log`.**

All five walks driven end-to-end as the persona each actually belongs to, against the
deployed build — not a local dev server, not a unit harness.

**Re-verified on STAGING after promotion: 2026-07-28 08:30Z, `https://staging.saysomethingin.app`,
116 PASS / 0 FAIL / same single note — `e2e-run-staging.txt`.** The screenshots in this
directory are from the dev run; the staging run reproduced every assertion identically.

## What was asserted, per step

| Assertion | Method |
|---|---|
| Walk is at step *n* | `html[data-walk-active] === "<walkId>:<n>"` — the runtime's e2e breadcrumb (deployed builds strip `console.log`, so every assertion is DOM/attribute-based) |
| The anchor is a real element | `[data-walk="<anchorId>"]` has a bounding box |
| The pulse ring sits ON that element | ring box within 10px of anchor box (offset −6px) |
| The card renders | `.walk-card` visible |
| Next / Back move the walk | driven by real clicks, step attribute re-asserted after each |
| The walk completes | terminal card `…:done` reached, then Done clears the attribute to `null` |
| Nothing is written | every non-GET `/api/*` request (minus telemetry) counted across the walk; must be zero |
| Nothing auto-plays | 3s after plain navigation: attribute `null`, zero `.walk-card` |

## The five walks

| # | Walk | Persona (how the run signed in) | Surface | Steps | Result |
|---|---|---|---|---|---|
| 1 | `invite-first-teacher` | IME Programme Leader — personal link `/group/QJM-868` | Sunrise Public School node home | 4 (step 0 is click-advance) | GREEN |
| 2 | `run-class-session` | IME Teacher — personal link `/redeem/ZKD-834` | Class detail, Grade 6A | 3 | GREEN |
| 3 | `ways-in` | IME Programme Leader | Programme node home | 4 | GREEN |
| 4 | `reading-insights` | IME Programme Leader | Node insights | 4 | GREEN |
| 5 | `invites-desk` | ssi_admin (service-role magiclink → real session) | `/admin/invites` | 4 | GREEN |

Extra assertions that passed:
- **Zero mutating requests** during all five walks — nothing minted, nothing toggled, nothing revoked.
- **`run-class-session` starts no session** — URL unchanged across the whole walk.
- **Walk 1 step 0 hides Next** — a click-advance step; only the user's real tap on
  *Invite a person* advances it, and that only opens the inline form.
- **Back works** — exercised in walks 2 and 3 (step 1 → back to step 0 → forward again).
- **Skip (×) ends a walk** — exercised on the noticing-CTA path.
- **Both offering surfaces carry entry points**: "Show me — …" links inside *How this works*
  (node home), on the insights page, on class detail, and on the invites desk.
- **Nothing auto-plays** on plain navigation to node home, insights, class detail, invites desk.

## The one note (not a failure)

```
note — noticing walk CTA not visible on this school (subtree rollup non-zero?)
```

The run looks for a teacherless demo school to prove a *noticing invitation* can carry a
`walk:<id>` CTA. The DB-level finder picked a school with no teacher tag, but the node's
own rollup counts class-attached teachers too, so the zero-teacher rule didn't fire there
and no CTA rendered. The rule → CTA path is unit-covered in `evaluateRules`; the runner
treats absence as a note by design rather than failing the suite.

## Two fixes this run required

1. **Test selector** (`five-walks.mjs`): the teacher leg opened a class via `.row-clickable`,
   which the class table doesn't use — it renders each row as an anchor to the class route.
   Now waits for and clicks `a[href*="/classes/"]`.
2. **Demo data, not code**: the *IME Teacher* persona (`ZKD-834`) taught **zero classes**, so
   class detail was unreachable for them and walk 2 could not run at all. Teachers are scoped
   by class MEMBERSHIP (`class_teachers`, a view over `user_tags`), and Sunrise's demo classes
   carry only the legacy `classes.teacher_user_id` lead pointer — no membership rows. One
   additive row was written (IME Teacher ↔ Grade 6A, `role_in_context='teacher'`,
   `added_by='walkthrough-e2e'`, `is_lead=false`), leaving every existing lead pointer and
   dashboard attribution untouched. Reversible by setting `removed_at`.

   **Wider finding, deliberately NOT fixed here:** the demo generator appears never to write
   `class_teachers` membership rows — Sunrise's four classes had none at all, so *any* demo
   teacher signing in sees an empty dashboard. That is a demo-data generation gap and its own
   scoped pass, not walkthrough work.

## Re-running

```bash
cd packages/player-vue
PATH=/opt/homebrew/bin:$PATH node --env-file=<env-with-supabase-keys> \
  e2e/walkthrough/five-walks.mjs
# LEGS=A|B|C|BC…  runs one persona's leg only (default all three)
# BASE_URL=https://staging.saysomethingin.app  retargets the build under test
```

Needs `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`.

## Screenshots in this directory

`a0`/`a1` leader node home + the How-this-works offering · `w1-*` invite-first-teacher ·
`w2-*` run-class-session · `w3-*` ways-in · `w4-*` reading-insights · `w5-*` invites-desk ·
`*-terminal` the closing card of each walk · `b0`/`c0` the quiet (nothing-auto-playing)
class-detail and invites-desk surfaces · `c1` the noticing-invitation surface.
