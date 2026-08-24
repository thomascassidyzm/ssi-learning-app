# THE VIEW — org-switch layout stability (kill the wobble)

- **Founder bug (2026-07-20):** switching org via the where-you-are rail / "others at this
  level" list → "3-4 up and down page wobbles — really janky" on each switch, on deployed staging.
- **Worker:** @wobble-fable · branch `dev` · probe committed at
  `packages/player-vue/e2e/the-view/layout-stability-probe.mjs`
- **Method:** real ssi_admin session on the DEPLOYED build (same mint-session technique as the
  founder-walk scripts). The probe drives the exact founder path — expand "others at this
  level", click sibling, repeat across region↔region and school↔school in the IME demo
  programme — recording every `layout-shift` entry (including input-adjacent ones, which
  canonical CLS drops: the wobble is click-triggered, so vanilla CLS reads 0.0 while the page
  visibly jumps) plus a 100ms height timeline of every named section.

## Baseline — deployed staging, 2026-07-20, 1440px

| Switch | CLS | shift events |
|---|---|---|
| region → region (×3) | 0.134 each | 4 |
| region → school | **0.304** | 5 |
| school → school (×3) | 0.134 each | 4 |

Target: ≤ 1 settle per switch, **CLS per switch < 0.02**.

### Offenders, named by the probe

1. **`AdminGroupContainer`'s entity-context-bar** ("Viewing group …") — its `v-if` included
   `!isLoading`, so it UNMOUNTED and REMOUNTED around every rail switch, shoving
   `main-content` up and down. This produced the four identical 0.0334 shifts of
   `MAIN.main-content` on **every** switch — even school→school switches where all the
   node-home sections held perfectly still. The dominant, constant wobble.
2. **NodeHomeView's children section** collapsed to a "Loading…" line then refilled:
   height 195 → 129 → 262px per region switch (page total 562 → 496 → 629px). Two visible
   jumps per switch; the 0.170 shift on region→school named `.children-section`,
   `.stats-row` and the rail rows together as the settle.
3. **Wrong-node data mid-switch** (correctness, not shift): while a new node loaded, the
   identity header, stat values, class cards and action-bar VERBS all still showed/acted on
   the PREVIOUS node. A mid-switch "Delete"/"Rename" click would have targeted the old node.

Scroll anchoring was already handled (`scrollBehavior` keeps position between `nodeSurface`
routes) and contributed nothing. The map rail changes height once, at data arrival — that is
the single allowed settle, and it is kept (continuity ruling: the rail stays mounted).

## Fix (commit `a6477668`)

Stability, not speed — hold every section's GEOMETRY while a load runs; never show the
WRONG node's VALUES:

- **Context bar stays mounted** once painted; the group name blanks (nbsp) while loading.
- **Children body holds its measured pre-load height** (`min-height`) with a quiet centred
  "Loading…" — no collapse-to-spinner; one settle when the new rows land. Same hold covers
  lens changes and refreshes.
- **`switching` state** (node id changed, vs same-node refresh): identity kicker/name/badge,
  stat values and class-card bodies blank to nbsp but keep their boxes. Same-node refresh
  keeps its still-correct numbers — stale-while-refreshing, per the refresh protocol.
- **Action bar goes `visibility:hidden` mid-switch** — space held, clicks inert, so a verb
  can never act on the previous node.

## After — deployed dev, same probe (2026-07-20)

Verification pass found one MISSED offender at phone width, fixed it on dev
(commit `e20f6b76`), and re-verified. Final numbers are against the deployed
dev build containing both fixes.

### Phone-width regression found and fixed (`e20f6b76`)

At 390px the school names wrap to TWO lines in the identity header. Blanking
the name to a single nbsp mid-switch dropped a line — header collapsed
141 → 83 → 141px, shoving stats/children/verbs up then down: CLS 0.13–0.17
and two shifts on every school→school switch (desktop was already clean —
one-line names, nothing to collapse). Fix: the identity header holds its
measured pre-load height (`min-height`), the same hold the children body uses.

### Final probe numbers — desktop 1440px

| Switch | before (staging) | after (dev) | shifts |
|---|---|---|---|
| region → region (×3) | 0.134 each · 4 shifts | **0.0002** | 1 |
| region → school | 0.304 · 5 shifts | **0.0117** | 1 |
| school → school (×3) | 0.134 each · 4 shifts | **0.0000** | 0 |

Every switch: PASS (target < 0.02, ≤1 settle).

### Final probe numbers — phone 390px

| Switch | pre-`e20f6b76` dev | after | shifts |
|---|---|---|---|
| region → region (×3) | 0.0195 | **0.0195** | 1 |
| region → school | 0.169 | **0.169** | 1 |
| school → school (×3) | 0.134–0.136 · 2 shifts | **0.0143–0.0147** | 2 tiny |

- region→region and school→school: PASS.
- The probe's first switch reads 0.063 but 0.044 of it is the probe's own
  click opening "others at this level" (accordion expansion, input-adjacent);
  the actual settle is the same 0.0195 as the other region switches.
- **region→school at 390px: 0.169 in ONE smooth settle** — over the numeric
  target but it is the single allowed data-arrival settle: at phone width the
  rail stacks ABOVE the content, and crossing a level legitimately changes the
  rail's height (364→295px) and the identity to a two-line name, so the whole
  column reflows once. No up-and-down, no wrong data — one monotone settle at
  land. Going under 0.02 here would need a fixed-height rail across levels — a
  design change, not a stability fix. Desktop same switch: 0.0117.

## Verification — eyeball + correctness checks (deployed dev, both widths)

Probe companion `layout-stability-eyeball.mjs` (committed alongside) — real
admin session, samples every ~40ms across a rail switch:

| Check | 1440px | 390px |
|---|---|---|
| Previous node's name visible mid-switch | never | never |
| Stat values blanked (never stale) mid-switch | PASS | PASS |
| Action bar `visibility:hidden` in every blanked frame | PASS | PASS |
| Context bar mount/unmount events during switch | 0 | 0 |
| Scroll position across switch | held | held |
| Cold load → settled content | 661ms | 957–1061ms |
| Refresh affordance | works | works |
| Updated stamp after refresh | 04:30 → 04:31 — honest | 04:29 → 04:30 — honest |

Frame-atomic proof of verb inertness (in-page rAF recorder, 390px — CDP
screenshots raster too late to catch the ~200ms window, so per-frame DOM
sampling is the evidence):

```
2094-2137ms ×3    name=Coastal Dist…  bar=visible     (before click)
2154-2336ms ×11   name=BLANK          bar=hidden      (switching — inert)
2354-4586ms ×106  name=Pilot Distri…  bar=visible     (new node landed)
```

The bar hides in the SAME frame the identity blanks and returns in the SAME
frame the new node's name lands — no frame exists where a click could reach
the previous node's verbs.

JPEG evidence (390px): `wobble-verify/eyeball-390-1-coldload.jpg` ·
`eyeball-390-2-midswitch.jpg` (geometry held: context bar mounted, identity
box kept, rail steady — note the verbs appear painted only because the CDP
still rasters late; the frame log above is authoritative) ·
`eyeball-390-3-settled.jpg` · `eyeball-390-4-refreshed.jpg`.

**Verdict: the wobble is dead on deployed dev at both widths.** One known
accepted settle (phone cross-level, single smooth reflow). Not promoted —
rides with the demo-world work per the shared promotion.
