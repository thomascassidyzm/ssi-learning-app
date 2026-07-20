# Structure tree aesthetics — quiet the chips, show the hierarchy

**2026-07-20 · dev `654bbacc` (verified deployed at `c1629da`) · walk
`e2e/the-view/tree-aesthetics-walk.mjs` — ALL PASS (11/11 live checks, real admin session,
real 27-row forest). Evidence in `docs/the-view/tree-aesthetics/`.**

Builds on founder pass C's declutter (`founder-pass-c-REPORT.md` §3). Founder rulings this
pass: "the chips don't seem that useful — clunky to have all this verbiage next to the
name" and "can we have some visual highlighting of the hierarchy — hard to see
parent/child levels by glancing."

## 1. Quiet the chips — repeated information is not information

- **The type word** (`region`/`school`/`programme`…) now shows **only where it
  disambiguates**: a row carries it only when its own sibling set mixes labels. The parent
  computes the verdict over ALL its children (stable under filters) and passes it down;
  the top level does the same across roots. On the live forest that means the mixed root
  level keeps its quiet mono words and **every uniform subtree below drops them** — 13/27
  rows carry a label, all at levels where two types genuinely sit side by side. The word
  itself is also quieter (10.5px mono, faded). Change-label via ⋯ still works when the
  word is hidden.
- **Demo marked once per subtree.** A demo node shows the badge only if its parent isn't
  already demo — so `IME Demo Programme` carries ONE badge and its regions/schools sit
  clean beneath it. Standalone demo schools at root keep theirs (they ARE their subtree's
  root). Live: 0 nested badges.
- **Trial pill hidden under demo.** A demo school on trial is normal state, not attention
  — the pill is suppressed for demo nodes AND anything inside a demo subtree. Real orgs
  keep it (live: LA SIS, Newport High, Salesian College/-2, Ysgol Cas-gwent, Ysgol
  Croesyceiliog still pill; every demo row silent). Non-trial attention states (past_due)
  still show everywhere, demo included.
- Counts stay right-aligned and muted, unchanged.

## 2. Show the hierarchy

- **Depth rails**: each row draws one faint 1px vertical guide per ancestor level
  (`rgba(44,38,34,0.10)`), stretched through the row's padding so consecutive rows read as
  continuous lines — the classic tree rail, THE VIEW-calm. Rows are flat DOM siblings, so
  depth is also machine-readable (rail count) — the walk uses that to prove the
  subtree-scoped checks.
- **Typography steps by level**: roots 15px semibold, level 1 14px medium, level 2+ 13px
  medium. Roots anchor the page; leaves recede.
- Rail width drops 22px→16px under 768px; phone shot shows zero horizontal overflow.
- Considered and dropped: per-subtree background tinting — rails + type stepping already
  carry the levels, and more paint fights the calm.

## 3. Both lenses consistent

Table lens untouched by design — zebra stripe verified live (`rgba(44,38,34,0.03)` on even
rows), same row grammar as before. Tree changes are scoped to `StructureTreeNode.vue` +
one computed in `AdminStructure.vue`.

## Evidence

| Shot | What it shows |
|---|---|
| `tree-full-forest.png` | whole 27-row forest, 1440px — labels only at mixed levels, one Demo per subtree, rails |
| `tree-demo-subtree.png` | IME Demo Programme expanded — clean descendants |
| `tree-phone.png` | 390px — rails intact, no overflow |
| `table-lens-zebra.png` | table lens unchanged |

## Suites

player-vue 978/978 · typecheck clean · deployed-dev walk 11/11 ALL PASS.

## Observations (not acted on)

- Root-level real trial schools each repeat `school · trial` — correct under the ruling
  (labels disambiguate at the mixed root level; trial matters on real orgs), but if the
  root level ever becomes school-heavy, a "Schools on trial" grouping might read calmer.
- Infra note (session): pushes to GitHub were failing machine-wide with TLS `bad record
  mac` on uploads — worked around by pacing uploads through a local CONNECT proxy
  (`/tmp/gh-slow-proxy.mjs`, memory `github-push-tls-corruption-workaround`).
