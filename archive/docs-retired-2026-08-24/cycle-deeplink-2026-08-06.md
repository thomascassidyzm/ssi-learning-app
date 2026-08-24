# The cycle deep link — half fixed, and a bigger thing found underneath

**2026-08-06.** Tom: *"round-level deep links work, but CYCLE-level links land one cycle EARLY — clicking 'I want to speak German' opens 'I want to learn now', and this off-by-one holds for all cycles."*

**Read this bit first: I fixed part of this and I did not fix the row you actually clicked.** The row you clicked is a REVIEW row, and review rows do not exist in the player at all. Details below.

---

## It was never a 0-vs-1-based slip

Popty sends `idx + 1`; the player computes `cycle - 1`. That round-trips exactly, and I confirmed both sides in the deployed builds. The arithmetic was never wrong.

**The two sides do not enumerate a round the same way.** Popty's Script Viewer builds its list from `services/learning-script-generator.cjs`, which its own header calls a *"parallel implementation"* of the learner app's generator. It has drifted from the thing it is parallel to.

`deu_for_eng` round 11 (`S0003L03`), the round in your screenshot:

| | Script Viewer | Player |
|---|---|---|
| rows / cycles | **15** | **7** |
| bare-LEGO build "How to speak as often as possible" | absent | **index 2** |
| USE phrase order | U02, U03, U01 | U01, U02, U03 |
| the 7 review rows | present | **absent** |
| the 2 consolidate rows | present | **absent** |

Membership differs, and order differs. No index arithmetic can reconcile that — the offset isn't constant and isn't even one-directional.

---

## What I shipped

The same rule the contract already uses one level up, applied one level down. `lego` beats `round` because identity survives and ordinals don't; now **`cycleText` beats `cycle`** for the same reason. The launcher sends the clicked row's own text; the player picks the cycle whose text matches.

Proven live on production, same round, same course:

| Launch | Lands on |
|---|---|
| `&cycle=6&cycleText=I'm trying to learn how to speak as often as possible` | **`use_1`** — the row clicked ✅ |
| `&cycle=6` alone (the old behaviour) | `use_2` — the wrong row ❌ |

So for every row that exists on both sides — intro, debut, builds, uses — a per-cycle launch now opens exactly the row you clicked, and it stays correct however far the two generators drift. Unmatched or absent text falls back to the ordinal, so old links behave exactly as before and a learner with no deep link is untouched.

**Gates:** 1,366 player tests, 841 API tests, both typechecks, 0 lint errors, 14 Popty URL-builder tests. All green.

---

## What I did NOT fix, and why

**"I want to speak German" is a REVIEW row, and the player's round 11 contains no review cycles at all.**

The player builds its rounds from `/api/courses/…/cycles`, and that endpoint returns only intro / debut / build / use. Reviews and consolidates are never in it, and on the instant-playback path — which is every course, `INSTANT_PLAYBACK_ALL = true` — nothing adds them later. The player's round 11 is 7 cycles, permanently.

So a launch aimed at row 13 of 15 asks for a cycle that does not exist, and clamps to the last cycle of the round. **Every review and consolidate row in the Script Viewer behaves this way** — 9 of round 11's 15 rows. No text anchor can fix that, because there is nothing to anchor to.

I could not reproduce your exact pairing ("I want to speak German" → "I want to learn now") against the live player; a clamp lands on the round's last cycle, not the adjacent row. I am reporting that honestly rather than claiming a fix I have not demonstrated.

---

## The bigger thing, which is not a deep-link problem

**The Script Viewer is showing producers a script that differs from what learners actually hear.**

Not just the deep link — the proofing surface itself. In round 11 it shows 15 rows in an order the player does not use, including 9 that the player never plays, and omits one that it does. That is a content-proofing instrument disagreeing with production, and it is upstream of everything: a producer signing off a round is signing off something else.

Which of the two is right is a real question and not mine to answer tonight:

- If the **player** is right, the Script Viewer is over-showing reviews and consolidates and needs re-syncing to the generator it claims to mirror.
- If the **Script Viewer** is right, learners are missing their spaced-repetition reviews entirely on the instant-playback path — which would be a serious pedagogy bug, not a display one.

That second possibility is why I have not touched either generator. It needs your call on which side is the source of truth, and then its own commission.

One methodology note that may point at the answer: the player plays a bare-LEGO build ("How to speak as often as possible"), and ralph is explicit that a BUILD is the new LEGO plugged into prior vocabulary, **never the LEGO alone**. On that reading the player's list has at least one item it should not.

---

## Landing

- Learner side: `hotfix/player-cycle-anchor-2026-08-06` → merged to `main`, back-merged to `staging` and `dev`, deployed and verified live.
- Popty side: `hotfix/cycle-text-anchor-2026-08-06` → merged to `main`, deployed and verified live.
