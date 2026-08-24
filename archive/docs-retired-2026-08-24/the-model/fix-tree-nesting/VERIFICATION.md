# Fix: Structure lenses tell the group-dashboard story (2026-07-18)

Founder report (staging): Structure tree looked flat and node panels resolved
the wrong id — IME panel "No teachers yet" (8 staff in subtree), Sunrise panel
"No invite links yet" (demo codes exist). Data intact; view broken.

## Root cause

The school↔node duality from the expand migration (`20260718_the_model_expand`):
every school got its OWN group node, but rollups and facets read the node id
directly while the underlying teachers/codes/tags live one level down (on the
`schools` row) or across the subtree.

- **"Flat tree" — NOT a live bug.** Verified read-only first: the tree endpoint
  already nests IME's 3 schools correctly (`parent_id` + `path` intact on both
  dev and staging), and the rendered DOM indents children (parent `16px` →
  child `40px`). The founder's screenshot was a stale/earlier data state.
- **Facets resolved the wrong id — the real defect.**
  - Rollups were DIRECT-per-node, so IME (a programme with no direct
    affiliations) showed `0T/0C/0L` while its group dashboard showed the subtree
    aggregate. Different story, same tree.
  - The node-panel "ways in" invites GET queried `grants_group_id = <node>`, but
    Sunrise's demo codes (`DEMO-IME0-T`, `DEMO-IME0-A`) are keyed
    `grants_school_id = <school>` with `grants_group_id = null`.

## Fix (one shared resolver + one bridge)

- `api/_utils/groupRollups.computeNodeExtras` — teacher/class/learner counts are
  now DISTINCT SUBTREE totals (node + every descendant). `childGroupCount` stays
  direct; commercial stays the node's own school. Serves tree + table lenses.
- `api/_utils/schoolScope.ownSchoolIdForNode` — the single school↔node bridge.
  The invites GET now matches `grants_group_id = node OR grants_school_id = its
  own school`, so a school node's pre-node demo codes surface.

## Verified on the DEPLOYED builds (real admin session)

| Check | dev `7c20a13` | staging `de22969` |
|---|---|---|
| Endpoint: IME nests 3 schools, rollup | **6T / 6C / 80L** ✓ | **6T / 6C / 80L** ✓ |
| IME panel verb (was "No teachers yet") | **"Invite a teacher"** ✓ | ✓ |
| Sunrise "Ways in" (was "No invite links yet") | **Teacher → /redeem/DEMO-IME0-T** ✓ | ✓ |

IME's `6T/6C/80L` matches the group dashboard exactly (Sunrise 3T/4C/42L +
St.Mary 3T/2C/38L). 586 api tests green (+4 new: subtree rollup, distinct-union,
two invite-bridge cases).

Screenshots in this directory: `after-tree.png`, `after-ime-panel.png`,
`after-sunrise-panel.png` (deployed dev); `staging-after-*.png` (staging);
`before-ime-panel.png` (the reported bug).
