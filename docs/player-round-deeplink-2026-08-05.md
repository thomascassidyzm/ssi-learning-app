# Script Viewer round deep link — fixed and live

**2026-08-05.** Tom, minutes after the feature shipped: *"app isn't respecting deep links — it's going to ROUND 1 cycle 1 always."*

Reproduced, diagnosed, fixed, deployed, and verified live on production.

---

## What was actually wrong

Nothing was wrong with the code. **The deep-link code had never been deployed.**

Popty's launcher was emitting a perfectly correct URL at a production build of the learning app that had never seen the feature — so the player did what it had always done: resume at the top of the course. Round 1, cycle 1, every time.

Three cheap probes confirmed it before a line was touched:

| Probe | Result |
|---|---|
| Production learning-app bundle grepped for `[DeepLink]` | **0 markers** — code absent |
| Dev-branch build grepped for the same | **2 markers** — code present |
| `deu_for_eng` round-map, prod vs dev | **identical**, 1,395 rounds, version 4094 — not a stale-view problem |

The Popty half was never broken. Its deployed URL-builder chunk is live and correct.

---

## The fix

The three deep-link commits were forward-ported to `main` through the learning app's documented hotfix lane, on `hotfix/player-round-deeplink-2026-08-05`. **All three cherry-picked cleanly — no conflicts, nothing resolved by hand, no unrelated dev changes dragged across.** `main` and `dev` had diverged by ~107 commits; none of that came with it.

Every symbol the port leans on was verified present on `main`'s own version of the player before trusting the clean merge.

### Gates — all green

| Gate | Result |
|---|---|
| `player-vue` tests | 1,359 passed, 3 skipped |
| `deepLinkTarget.test.ts` | 21 passed |
| API tests | 827 passed |
| `typecheck` + `typecheck:api` | clean |
| `lint` | 0 errors |
| release-train | pass |

---

## Blast radius: inert for ordinary learners

A visitor who arrives without a `round` or `lego` param parses to a null target, and every branch the change adds is gated on that target being non-null. Nothing about the normal resume path, playback, or a learner's saved settings changes. **Verified, not assumed** — see case C below.

---

## Acceptance test — run live on production

Course **`deu_for_eng`** (the one Tom has been proofing), round **698 of 1,395** — genuinely mid-course, and a fresh learner there is a *Brown Belt*, so landing at the top of the course is unmistakable.

Each case ran as a real signed-in, entitled learner in a fresh browser context, against `https://saysomethingin.app`.

| # | URL | Expected | Observed | |
|---|---|---|---|---|
| A | `?course=deu_for_eng&round=698&lego=S0354L02&cycle=3` | round 698, cycle 3 | `S0354L02`, `itemInRound: 2` (0-based = cycle 3), **Brown Belt** | ✅ |
| B | `?course=deu_for_eng&round=698&lego=S0354L02` | round 698, cycle 1 | `S0354L02`, `itemInRound: 0`, **Brown Belt** | ✅ |
| C | `?course=deu_for_eng` | normal resume, no regression | `S0001L01`, **White Belt** | ✅ |
| D | `?course=deu_for_eng&round=698&lego=S0010L01&cycle=2` | **lego beats round** | `S0010L01` (round 30, **Yellow Belt**) — not 698 | ✅ |
| E | `?course=deu_for_eng&round=1100` | round-only fallback | `S0527L04`, **Black Belt** | ✅ |

Every landing was cross-checked against the live round-map: round 698 → `S0354L02`, round 1100 → `S0527L04`, and `S0010L01` is round 30. All match.

The precedence rule in case D is the one that matters most: **position in this system is the LEGO, not the round**, and rounds renumber. The LEGO id wins, and it does.

### Tom's one-tap repeat

```
https://saysomethingin.app/?course=deu_for_eng&round=698&lego=S0354L02&cycle=3
```

Should open at Brown Belt, seed 354, third cycle of the round.

That URL is not hand-written — it is the exact output of the **deployed** Popty builder chunk, executed against real round data. The round-header arrow produces the same thing without `&cycle=3`.

---

## Honest gap

I could not click the launch buttons in the live Script Viewer UI. Its API backend defaults to Tom's Machine (`popty.ngrok.app`), whose tunnel is unreachable from this host, and the SSi Machine fallback returns **401** to the synthetic dashboard admin I minted.

So the Popty half is verified by **executing the deployed production chunk** with real round data rather than by clicking. That artefact is the single source of truth for these URLs and is wired directly into both the round-header arrow and the per-cycle button. It is strong evidence — but it is not a click, and I am saying so rather than implying otherwise.

---

## Landing

- `main` — fix live on `https://saysomethingin.app`, verified twice (a second time after an unrelated merge redeployed production).
- `staging` — back-merged.
- `dev` — already had it; the three original commits are ancestors. Nothing to back-merge, so the next promotion cannot revert it.

All synthetic test accounts used for verification were internal-flagged (RFC 2606 non-routable addresses, nothing emailed anywhere) and deleted afterwards.
