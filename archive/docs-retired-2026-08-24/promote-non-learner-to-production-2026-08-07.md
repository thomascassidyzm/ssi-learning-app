# Promoting the org, school and admin surfaces to production — 2026-08-07

**Tom's ruling, 2026-08-06 23:52Z:** the promotion hold is learner-facing only. *"Any non
learning player, learner nav, learner anything goes straight to main, there's no reason to
hold it back."* So the org/teacher/admin work sitting on `dev` goes to production now, and
the learner-side work on the same branch stays held.

This is the record of that split: what went, what stayed, how they were separated, and what
was found on the way.

---

## What is live in production

`main` = `54033f01` — *promote(main): the org, school and admin surfaces — learner work stays
held*. 47 commits, cherry-picked from `dev` in their original order.

| Landed | What a person gets |
|---|---|
| **A-74 co-teaching** | A lead teacher can share a class with a colleague: the co-teacher panel on class detail, class-scoped invite links for colleagues not yet on the staff list, co-teachers minting join codes and learner entities, lead handover, and staff removal that now revokes class access too. Three self-teaching walk-throughs ship with it — *share a class*, *invite a supply teacher*, *hand over the lead*. |
| **Who may add a co-teacher** | The lead teacher, or a leader above them — a co-teacher no longer sees an invite lane they are not allowed to use. |
| **Leader onboarding** | A manager sets a password before their first add, then is offered the app — both steps as guided walk-throughs in the app's own voice. |
| **A permanent "Your account"** | Password and install, always reachable from the node home, not just once during onboarding. |
| **The org-dashboard fix** | An organisation leader is offered an **Organisation Dashboard**, not a Schools one. Already soaked on staging. |
| **Org housekeeping** | Duplicate-name warnings at creation *and* rename, Enter no longer silently confirms a duplicate, group deletion walks `parent_id` rather than the duplicate-prone slug path. |
| **Off-stage** | Demo-data VAD generation, the deploy sentinel's play-through gate, and the correction of the stale "org tables have RLS off" claim in `CLAUDE.md` (RLS has been live on all six since 2026-08-06). |

## What stayed held

Everything learner-facing on `dev` — none of it rode along:

- the easy / fast learning modes (turbo retired)
- listening mode's home moving between the tray and Settings, and the straight-in entry
- the A-64 consecutive-repeat law and the round-adapter cap
- listening target clips following the belt speed ramp
- the interjection-card render fix
- the versioned audio-ref stamping in the script walk
- `api/courses/[code]/cycles.ts` (component_intro)

**Proof, not assertion.** The production diff touches zero files under `packages/player-vue/src/playback`, `src/providers`, `packages/core` (see caveat below), `src/locales`, `api/courses`, and none of `LearningPlayer.vue`, `ModeTray.vue`, `PlayerRestingState.vue`, `PlayerContainer.vue`.

Two learner-*adjacent* files did land, both solely for the org-dashboard door: `BrowseScreen.vue` and `SettingsScreen.vue` each gain a `useOrgLeadership` call and an Organisation Dashboard link. Nothing about playback, cycles or audio.

*Caveat, and not mine:* while production was deploying, another job pushed `ce514e24`
*fix(insight): name the dialect courses — "Welsh (South)", not Cym_s_for_eng*, which touches
`packages/core/src/courses/displayName.ts`. It is on `main` and in production. It is not part
of this promotion and I did not assess it against the learner hold.

## How the split was made

Commit-by-commit, not path-by-path. Each of the 97 commits on `dev` but not `main` was read
with its file list and classified learner-facing or not; the non-learner set was cherry-picked
in chronological order onto a branch off `main`. Nothing was squashed and no commit was split,
because none needed splitting — **no commit mixed the two sides.** That was the risk Tom named,
and it did not materialise.

Three conflicts, all inside the non-learner set, all resolved to match what `dev` itself
resolved:

- `apml/interfaces/walkthrough-engine.apml` — two header comments, combined.
- `ClassDetail.vue` and `walkthrough-engine.apml` at `3f570aa4` — the walk anchors landing on
  top of the permission gate.
- `walkthrough-pack.md` / `pack.json` / the apml at `6d5087bc` — taken verbatim from
  `origin/claude/org-account-area`, which had already merged both sides.

One extra commit, `b350f5b5`, adopts `dev`'s own merge resolution for the co-teacher rail: my
hand resolution had missed that the invite-link block is gated on `canManageTeachers` and that
the supply-teacher walk re-anchors to `class-teachers` to survive that gate. `main` and `dev`
now agree on that rail exactly.

### Gates, on the merged tree

| Gate | Result |
|---|---|
| `player-vue typecheck` | clean |
| `player-vue test` | 1642 passed, 3 skipped |
| `player-vue lint` | 0 errors (148 warnings, the standing baseline) |
| `typecheck:api` | clean |
| `test:api` | 1094 passed |
| production build | succeeds |
| walkthrough drift gate | OK — 11 walks, 39 steps, pack `b26c1e68be11` |

No new database action: both co-teacher RLS migrations in this set had already been
canary-applied to the shared live DB before tonight.

### Verified in production

The new API routes answer on `saysomethingin.app`: `/api/teacher/class-teachers` and
`/api/teacher/create-class-join-code` return 405 rather than 404 — the routes exist —
and `/api/org/subscription` returns 401. In the shipped front-end bundle, `"Your account"`
is present in the `NodeHomeView` chunk and `"Organisation Dashboard"` in the player and
schools chunks. Real-browser walk-throughs of the four user paths were run separately;
their results are reported alongside this note.

---

## The thing that was wrong on dev

Separating the two sides turned up a regression that had nothing to do with the promotion.

**Commit `55624411` — *"worklist: A-64 consecutive-repeat law — landed on dev, verified
live"* — was authored from a stale working tree and silently rolled four commits off `dev`:**

| Reverted | What was lost |
|---|---|
| `6d5087bc` | the permanent "Your account" area — **the very thing Tom asked to promote** |
| `9e9d3ec1` | the interjection card render fix |
| `7db75389` | listening target clips following the belt speed ramp |
| `7c0e4ea9` | the live probe for both |

Its stated content was a three-line worklist edit. The 1,313 deleted lines were not mentioned.

Worse, it could not self-heal. When `claude/org-account-area` was merged back into `dev`
afterwards, git saw `6d5087bc` as an ancestor already merged, so the merge brought only the
probe file and left the deletion standing. A worker then reported the account area "verified
live on dev — 20/20" against a `dev` that no longer contained it.

**Fixed for the org half:** the Your-account area was restored to `dev` as `b4dfb9cd`, taken
from the reconciled tree that went to production, with the walkthrough drift gate and 1707
tests green. It is live in production either way.

**Still missing on `dev`:** `9e9d3ec1`, `7db75389`, `7c0e4ea9` — all learner-side, all held
from production anyway, so nothing is broken for a learner today. They survive on
`origin/claude/org-account-area` and cherry-pick back cleanly onto a tree that is not
mid-flight on `toSimpleRounds` / `useLayer1Scheduler`. They were deliberately left for whoever
owns that lane rather than restored underneath live edits.

**The lesson worth keeping:** a commit whose message describes a doc edit deleted a night's
feature work, and the follow-up merge could not undo it. Commit from a tree you have just
pulled, and read your own `--stat` before pushing.

---

## Where the environments now stand

- **`main` / `saysomethingin.app`** — has the promotion. Live.
- **`dev`** — unchanged in substance, plus the Your-account restore.
- **`staging`** — deliberately *not* touched tonight. It already carries most of this work as
  the original commits from earlier promotions, so merging the cherry-picks in would have
  produced duplicate-patch conflicts on the environment the external test team is soaking, for
  no benefit. The next normal `dev → staging` promotion reconciles it.
