# THE LENS · rate-compare voice fix — walk report

**Rulings applied (founder, 2026-07-19):** every card speaks AS the selected
entity; compare-to defaults to the entity's ANCESTOR chain and never sits
empty; the cohort is the entity's SIBLINGS at its level within the ancestor
scope — never its own members; percentile is honest about tiny n; position
renders the LEGO's own content (position-is-LEGO), never raw S/L ids.

## What was wrong

1. **Voice** — `RateCompare.vue` hardcoded "YOU v …", "Where you sit", "You're
   at the Nth percentile" for every entity, including class/school nodes.
2. **Demo board circularity** — `RatesBoard.vue` defaulted `averageId` to
   `'course avg'`, a value not present in the options list, so the Compare-to
   select rendered EMPTY and silently fell back to `'class avg'` = the mean of
   the class-level population itself. A class was ranked "100th pctl" against a
   cohort that was effectively its own frame.
3. **Raw position ids** — the node endpoint's `contextLine` rendered
   `Furthest LEGO · S21 · L1` on admin surfaces.
4. **Flat chart v +88.9% headline** — SEPARATE bug, confirmed: the shared pace
   math (`api/_utils/rateCompare.ts`) divided LEGOs-advanced by the span of
   *activity* (first→last session). An entity whose sessions were a burst
   weeks ago still headlined a hero "per week" rate (`deltaPct` is 1dp — hence
   +88.9%) while the 8-week trend chart honestly read ~0.

## What changed

| Piece | Change | Commit |
|---|---|---|
| `insight/spec.ts` + `RateCompare.vue` | Voice fields (`subject`, `subjectIsViewer`, `levelNoun`, `cohortLabel`); "You" ONLY when the entity is the viewer's own learner identity; honest ordinal rank ("1st of 3") replaces percentile when cohort < 10 | `6d4c1da9` |
| `data/demoRates.ts` + `RatesBoard.vue` | Real hierarchy (classes→schools→org; learners→home class); compare-to = ancestor chain naming the ancestor ("Gaelcholáiste Luimnigh avg"), nearest first = default, never empty; cohort = siblings (entity excluded); contextLine = LEGO content | `b2454e3d` |
| `api/groups/[id]/rate-compare.ts` | Voice fields on the response; `contextLine` resolves `course_legos` content (roman preferred) — no content → no line, never a raw id | `63a4b54d` |
| `api/_utils/rateCompare.ts` | Pace denominator anchored to NOW (first activity → now): idle time decays the rate, headline and trend tell one story | `c4569c51` |

The server cohort machinery was already right (siblings within the ancestor
scope, entity excluded, k-floor, nearest-ancestor default) — the founder's
screen was the demo Stats board, whose cohort really was circular.

## What each entity level's card now says

- **Learner** (demo board; an admin viewing a learner — never "You"):
  "Saoirse Ní Bhraonáin v Rang a 1 — Sínis avg" · "Where this learner sits ·
  learners in Rang a 1 — Sínis".
- **Class**: "Rang a Trí v Gaelscoil na Mara avg" · "Where this class sits ·
  classes in Gaelscoil na Mara" · "This class ranks 1st of 3 classes in
  Gaelscoil na Mara" (ordinal, not "100th pctl").
- **School**: "Sunrise Public School, Pune v IME Demo Programme avg" · "Where
  this school sits · schools in IME Demo Programme".
- "You" survives ONLY where `subjectIsViewer` is true (a learner viewing their
  own identity — no current surface sets it; the default is the entity's name).

## Deployed-dev walk (real admin session) — ALL GREEN, 23/23

`e2e/the-lens/voicecheck.mjs` (magiclink admin session, Playwright) against
dev build `c4569c5`:

- **Class node** (`voice-class.jpg`, Rang a Trí · Gaelscoil na Mara): caption
  "RANG A TRÍ v GAELSCOIL NA MARA AVERAGE", compare-to prefilled "Gaelscoil na
  Mara average", "WHERE THIS CLASS SITS · CLASSES IN GAELSCOIL NA MARA", chip
  and foot "**2nd of 3** classes in Gaelscoil na Mara" (ordinal — no more
  100th-pctl-of-itself), footer "Furthest LEGO · "an lá ar fad" — "all day""
  (LEGO content, not `S21 · L1`).
- **School node** (`voice-school.jpg`, Sunrise Public School, Pune): "WHERE
  THIS SCHOOL SITS · SCHOOLS IN IME DEMO PROGRAMME", compare-to prefilled
  "IME Demo Programme average".
- **Demo board** (`board-learner/class/school.jpg`): compare-to prefilled at
  every level (learner → "Gaelcholáiste Luimnigh avg", class → "Gaelscoil
  Cholmcille avg", school → "An Roinn Oideachais pilot avg"); no "Where you
  sit"; no raw S/L ids; class level shows sibling-classes copy + honest
  "2nd of 3".
- Zero occurrences of "YOU v" / "Where you sit" anywhere on any surface.

## Suites

- `player-vue` typecheck ✅ · vitest 948/948 ✅ (demoRates suite rewritten to
  pin the new contract)
- `api/` vitest: rate-compare lanes 445/445 ✅ (one pre-existing intentional
  failure in a stale `.claude/worktrees/org-hierarchy-tests` copy, unrelated)

**Staging re-walk:** promoted dev→staging (`88f71c0c`); voicecheck re-run against `staging.saysomethingin.app` build `88f71c0` — ALL GREEN 23/23.
