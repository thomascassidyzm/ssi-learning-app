# The self-explaining dashboard — v1 (compiled explainer)

**Status: DESIGN + v1 SHIPPED to dev, 2026-07-27. Founder-ruled concept; build must not dilute it.**

> Documentation, training material, onboarding and feature-discovery are ONE act: the system
> explaining itself from live state, rendered per persona. The learner level is deliberately
> nothing — the learner app must need no explanation.

## 1. The synthesis: a compiler, not a cache and not a concierge

Static docs are stale caches — they rot the moment the product moves. A live LLM concierge burns
tokens per user per question, forever. The synthesis is a **compiler**:

- **COMPILE TIME** (tokens spent once per refresh, never per user): a CLI reads live truth — the
  admin surface's actual verbs, the stats the dashboards actually compute, the recursive group-tree
  semantics, the DB schema — plus the hand-written rulings, and emits a static **EXPLANATION
  PACK**: versioned JSON. Usage telemetry is a v2 input, stubbed.
- **RUNTIME** (zero LLM, zero tokens): the dashboard bundles the pack as static data. Two
  surfaces: a small **"How this works"** entry on node home, persona-scoped to exactly where the
  user stands; and **noticing invitations** — the pack's declarative rules evaluated client-side
  against stats the page has *already fetched*, rendered as gentle, dismissible, tappable
  invitations with a deep link. Never modal, never forced. Invitations, not missions — the user
  is the selector, even of what to learn next.

BSC narrative: **Better** — explanations can never desync from the product, because the compiler
fails when they drift (see §4), and every user gets them instantly, offline-cheap. **Simpler** —
one pack file, one evaluator, one entry component; no help CMS, no docs site, no chat surface.
**Cheaper** — zero runtime model calls, zero new endpoints, zero new queries: rules run over
payloads the page already holds; refreshing the pack is one CLI run.

## 2. Decisions vs derivables (the maintenance contract)

Only **rulings** are hand-maintained. Everything else regenerates.

| Hand-maintained (decisions) | Regenerated (derivables) |
|---|---|
| `tools/explainer/rulings/*.md` — the persona explanations: what each persona sees, in plain warm language. One file per persona. | The pack itself (`pack.json`) — assembled, versioned, validated on every compile. |
| `tools/explainer/rules.json` — the noticing rules: condition + invitation sentence + deep-link target, pure data. | The **truth manifest** inside the pack: the verb list parsed from `NodeActionBar.vue`, the stat-row words parsed from `NodeHomeView.vue`, the insight measures/windows parsed from `rate-compare.ts`, the schema tables checked in `supabase/schema.sql`. |
| This doc — the architecture ruling. | `docs/explainer-pack.md` — a human-readable render of the current pack, for review. |

The rulings are the founder's/author's voice about **mechanism** ("classes practise together;
that's the metric that matters"), never restated state ("you have 3 classes" — the dashboard
already says that). The compiler enforces the split mechanically where it can (§4).

## 3. The pack (shape)

```
packages/player-vue/src/explainer/pack.json
{
  "version": "<content hash>",         // deterministic over inputs
  "generatedAt": "<iso date>",
  "truth": {                            // derived, for drift-audit + tests
    "verbs": ["Invite a person", ...],  // parsed from NodeActionBar.vue
    "statWords": ["Class practice", ...],
    "measures": [{value,label,unit,per,desc}, ...],
    "windows": ["today","7d","30d","all"]
  },
  "explanations": {                     // persona × place, markdown-lite (plain text + **bold**)
    "admin":   { "group": "...", "school": "...", "class": "..." },
    "leader":  { "group": "...", "school": "...", "class": "..." },
    "school_admin": { ... },            // authored; surface wiring is v1.1 (see §7)
    "teacher":      { ... }
  },
  "rules": [ <noticing rule>, ... ]     // §5
}
```

Persona at runtime is what the mount already knows: the admin mount (`/admin/...`) → `admin`; the
member mount (`/org/:id`) → `leader`. Place is the payload's own `kind` + label
(group / school / class). No new auth reads, no persona service.

## 4. The compiler (`tools/explainer/compile.mjs`)

Plain node, no deps, run by hand (an admin dashboard button can come later):

```
node tools/explainer/compile.mjs           # writes pack.json + docs/explainer-pack.md
node tools/explainer/compile.mjs --check   # validate only (CI-friendly), no writes
```

What "compile" means here — three honest steps:

1. **Derive.** Parse the live truth out of the source of the surfaces themselves:
   - verbs from `NodeActionBar.vue` (the `verb-bar` buttons, member-gating noted),
   - stat-row words from `NodeHomeView.vue`,
   - measures + windows from `api/groups/[id]/rate-compare.ts`,
   - required tables (`groups.parent_id` recursion, `class_sessions`, …) present in
     `supabase/schema.sql`.
2. **Validate (the drift gate).** Compile **fails** when:
   - an explanation names a verb that no longer exists on the surface, or a surface verb appears
     in no explanation (per that persona's visible verb set);
   - a noticing rule references a payload field the home endpoint no longer emits (checked
     against `api/groups/[id]/home.ts` source);
   - a rule's deep-link target isn't one of the runtime's known semantic targets.
   A failing compile is the system saying "the docs would have gone stale HERE" — the exact
   moment static docs silently rot.
3. **Assemble.** Merge rulings + rules + truth into `pack.json` (version = content hash), and
   render `docs/explainer-pack.md` for human review.

Where do the *tokens once per refresh* go? Into authoring and re-authoring the rulings when the
drift gate fires — an agent (or a human) rewrites the affected ruling, re-runs the compiler,
commits. The gate turns "keep the docs fresh" from a vigilance problem into a build failure.
**v2 (stubbed):** a `--telemetry` input feeding real usage counts in, so explanations can say
"most schools start here" from evidence, and unused verbs get flagged for the founder.

## 5. Noticing rules — declarative conditions over stats already fetched

Rules are **pure data** in `tools/explainer/rules.json`, evaluated by
`packages/player-vue/src/explainer/evaluateRules.ts` (~100 lines, unit-tested) against the
`/api/groups/:id/home` payload the page has already loaded. **No new queries, no polling, no
model calls.** Three rule shapes:

- `node` — conditions over payload scalars → at most one invitation.
- `perChild` — conditions over each item of an array (e.g. `children`) → one invitation per
  matching item, capped at 3.
- `countWhere` — count of matching items in an array (e.g. `students`) → one invitation carrying
  `{count}` when the count clears `min`.

Conditions are `{path, op, value}` with ops `eq gt lt gte lte truthy falsy daysSinceGt`.
Invitation text interpolates `{path}` from the match scope. Deep links are **semantic targets**
(`insights`, `lens:classes`, `child-home`, `students`) resolved by the runtime through the
existing `nodeSurfacePaths` helpers — so links stay member/admin-correct and the pack stays
UI-agnostic.

v1 ships four rules (all verified against the live IME Demo Programme tree):

| id | shape | fires when | invitation |
|---|---|---|---|
| `silent-class` | node (class) | class has practised before, zero sessions this week | "This class practises together, but not this week…" → insights, 7-day window |
| `quiet-subtree` | node (group/school) | classes exist below, none practised this week | "None of the {n} classes below have practised together this week…" → All classes lens |
| `school-no-teachers` | perChild (children) | a school below has zero teachers | "{name} has no teachers yet — a teacher link gets them started." → that school's home |
| `students-quiet-week` | countWhere (students) | ≥1 student with zero own-practice this week in an otherwise active class | "{count} students haven't practised on their own this week." → students list |

Dismissal is per rule × node in `localStorage` (14 days), because an invitation you've declined
is noise the second time. Evaluation happens on data already in hand — an invitation can only
ever appear *after* the page has honestly loaded, and refresh follows the page's own manual
refresh protocol. No auto-refresh anywhere.

## 6. Runtime surfaces (existing idiom only)

- **`HowThisWorks.vue`** — one quiet text link under the stats row ("How this works"). Tap →
  an inline card (same `schools-card` grammar) with the persona×place explanation, the current
  noticing invitations (compact rows), and the persona×place walk offers ("Show me — …"). Tap
  again → closed. Nothing opens uninvited. **This button is THE single surfacing point for
  every invitation at this persona×place** (founder ruling 2026-07-29), so it carries a subtle
  discoverability throb: a small soft-pulsing dot beside the link on a viewer's first visit,
  re-arming when the noticing rules surface an invitation not seen since the panel was last
  opened. Opening the panel disarms it and persists the seen state (`howThisWorksThrob.ts`,
  localStorage keyed viewer × node, same idiom as dismissal). `prefers-reduced-motion` → no
  animation, static dot. The throb never traps attention, never opens anything, never
  auto-plays a walk.
- **`NoticingInvitations.vue`** — gentle cards between stats and children list, one line each,
  in the existing banner/card idiom: the sentence, a small "Have a look" link, and a quiet
  dismiss ×. Never modal, never blocking, never more than 3 at once. Presentational since
  2026-07-29: the evaluation + dismissal state live in `useNoticingInvitations.ts`, called once
  by the page so the SAME invitation list feeds these cards and the How-this-works panel/throb.

Both mount only in `NodeHomeView.vue` (admin + leader member mount) in v1.

## 7. What v1 deliberately does not do (the cut lines)

- **Teacher/school-admin surface wiring.** Their explanations are authored in the pack, but the
  legacy `/schools` teacher and school-admin dashboards don't render them yet — those surfaces
  are converging onto node home anyway (THE-VIEW §4); wiring the explainer there before the
  convergence would be work thrown away. Wire it when they converge.
- **Learner surface: nothing, ever.** Founder ruling — the player must need no explanation.
- **Telemetry input.** Stubbed flag on the compiler; no signal before its consumer exists.
- **Pack-refresh dashboard button.** The CLI is the admin's regenerate path for now.
- **LLM authoring stage in the compiler.** The drift gate + an agent editing rulings on failure
  IS the compile-time token spend; a fully automated `--agent` rewrite stage can come when the
  rulings churn often enough to earn it.

*Last updated: 2026-07-29 (How-this-works = single surfacing point + discoverability throb)*
