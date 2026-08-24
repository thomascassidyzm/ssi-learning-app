# Founder pass C — honest delete · up-affordance · tree declutter · zebra table

**2026-07-19 · dev `3d0dc6ec` · verified on the DEPLOYED dev build with a real admin session
(`e2e/the-view/founder-pass-c-walk.mjs` — ALL PASS, 21/21 live checks). Evidence in
`docs/the-view/founder-pass-c/`.**

## 1. Honest delete — the true semantics, then the honest warning

**What deleting a group ACTUALLY does** (read from `api/_utils/schoolGroupDeletion.deleteGroupCascade`,
then proven live on throwaway data):

- **Sub-groups are NOT orphaned — the whole subtree is deleted**, deepest-first.
- **A school whose own node is inside the subtree dies with it** (full school cascade: classes,
  sessions, roster tags, invite codes). Every school created through today's "Add a school" verb is
  this shape.
- **Legacy-attached schools** (parented by `group_id` only, node elsewhere/none — pre-model rows)
  are **kept and ungrouped**: they bubble up to top level.
- Learner/teacher **accounts are never deleted** — they lose their place (affiliation tags removed).

**What was dishonest before:** the impact preview only counted schools directly parented to the
clicked group — it saw **nothing in the subtree** (no descendant groups, none of their schools,
classes or rosters), and `hasRealActivity` (the type-the-name gate) was blind the same way. The
dialog then printed bare counts with no statement of what happens to them.

**Fixed:** `computeGroupImpact` now walks the same subtree as the cascade and returns
deleted-groups (named), deleted-schools (named), orphaned-schools (named) and counts over what
actually dies. One shared formatter (`deleteImpact.ts`) renders the warning in both delete flows
(Structure row ⋯ and node home's Delete verb):

> Also permanently deletes 2 sub-groups inside it: ZZ Region, ZZ School
> Also permanently deletes 1 school and everything in them: ZZ School
> 1 school is attached here without their own place in the tree — they are kept but will appear at top level: ZZ Legacy School
> N learners and M teachers lose their place here — their accounts are kept

Screenshot: `founder-pass-c/delete-warning-honest.png` (minted throwaway org; no real/IME data
touched). Live-proven both lanes: node-backed school deleted with the subtree; legacy school
survived with `group_id = null` — exactly as warned.

**Two real defects fixed on the way:**
- `classes.group_id` (direct class→group affiliation, THE MODEL I7) has **no ON DELETE** — a class
  affiliated to a group would have 500'd the whole delete. The cascade now detaches it (lossless in
  the expand phase: `school_id` stays authoritative).
- `GROUP:` affiliation tags (string-keyed, no FK) were left dangling after a group delete — now
  removed, so nobody stays "affiliated" to a ghost.

**Taste note (recommendation only, semantics unchanged):** subtree-delete is the right model
reading — children of a deleted node are not independent tag-holders, they ARE the structure being
deleted; and the legacy orphan lane disappears on its own once pre-model schools are migrated. No
change recommended.

## 2. Up-affordance

The map rail's ancestors were already clickable (verified). Added the missing way OUT: an
**"All organisations"** control with a home icon pinned at the top of the rail, present at every
depth, returning to `/admin/structure`. Live-clicked from a depth-2 node → lands on Structure.
Screenshots: `node-home-up-affordance.png`, `…-phone.png`.

## 3. Tree declutter

Row grammar now: **name** (anchor) · quiet mono label word · `Demo` word · status pill **only for
attention states** (trial/past-due; paid-and-fine is silent) · one muted **"N learners"** figure
(full teachers/classes/learners breakdown on hover) · ⋯. The ⋯ menu is maintenance-only —
**Rename · Change label · Delete** — and the inline add-child/invite/demo-mint forms are GONE from
the tree: rows are links, those verbs live on the node home action bar (where they already were).
Root-level "+ Add organisation" stays (no node home exists above the roots).
Screenshot: `tree-decluttered-search.png`. ~200 lines of duplicated form code deleted.

## 4. Zebra table

Table lens rows alternate with a whisper of the warm ink (`rgba(44,38,34,0.03)`); hover reads
brighter than either stripe. Screenshot: `table-zebra.png`.

## Suites

player-vue 954/954 · api 3640/3640 (one unrelated fail in a stale `.claude/worktrees/` copy only) ·
typecheck clean · deployed-dev walk 21/21.

## Observations (not acted on)

- Tree-lens search filters children but always shows every ROOT row (pre-existing; visible in the
  tree screenshot — search "ZZ…" still lists all top-level orgs). Cheap fix in AdminStructure if
  wanted.
- `ConfirmDeleteModal` carries dark-theme fallback colours from the old era; it renders correctly
  on this surface (see screenshot) so left alone.
