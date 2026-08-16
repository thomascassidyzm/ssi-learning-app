# A-123 — stopped at the merge target, and what the live database says

**16 August 2026.** You approved A-123 for merge and deploy with one bar: *no-one loses access*, and *"if anything in the deploy deviates from that, stop and report rather than push through."*

I stopped. Two reasons — one about **where** this lands, one about **who** it protects. Both below, with the evidence.

The code itself is good. Everything is green. The fix is now on `dev`. **Production is untouched.**

---

## 1. Why I did not push to main

A-123 lives in **ssi-learning-app**, not Popty. That repo does not have Popty's "everything goes to main" rule — it has the opposite, in its own CLAUDE.md:

> Three-tier promotion flow. **ALL work goes to `dev`. NEVER push to `staging` or `main` directly.**
> `dev` → `staging` → `main` (production, real users)
> **Promotion is manual and deliberate (Tom drives it)** — `staging → main` weekly, after the external team has vetted staging.

The A-123 branch was cut from `dev`, so it carries all of `dev` with it. Merging it to `main` would not have landed a billing fix. It would have promoted **53 commits** to production in one go — 20 of which have not even reached `staging`, so the Colombo test team has never seen them. That set includes a learner-identity DB migration, new CSP and security headers, the offline/infinite-play rework and the lie-fi boot changes. Shipping all of that to real users under the banner of a billing fix is exactly the deviation you told me to stop on.

**The obvious alternative doesn't work either.** I tried cherry-picking just the four A-123 commits onto `main` in a clean worktree. It conflicts — a ~150-line collision in `api/teacher/paddle-webhook.ts` — because A-123 is built directly on top of four security commits that exist only on `dev`, including the 11 August `fix(security): resolve the Paddle platform billing target server-side`. That is the very fix A-123 extends. Hand-resolving a 150-line conflict in production billing-webhook code is the single most effective way to breach *no-one loses access*, so I did not do it.

**What I did instead:** merged to `dev` (a clean fast-forward, zero interaction risk, no real users). That is the documented route by which anything reaches main here, and it is reversible.

**Your call — one sentence:**
- **A. Run the release train** — promote `dev → staging → main` deliberately, the normal way. Ships A-123 plus the 53-commit backlog, but through the soak that exists to catch exactly this. *My recommendation.*
- **B. Straight to production now** — promote `dev → main`, skipping the staging soak. Fastest close on the security hole, no vetting.
- **C. True hotfix** — I hand-build an A-123-only branch off `main`, back-porting the 11 August prerequisite. Smallest production delta, but it means hand-merging billing code that no test suite on `main` covers. I'd want to do this only if you consider the hole actively being exploited.

---

## 2. Your condition, checked against the live database

The fix resolves each webhook event through a four-rung ladder, and **rung 1 is the existing subscription binding, returned immediately with no guard applied** (`api/teacher/paddle-webhook.ts:760`). Anything on rung 1 renews and cancels exactly as it does today. That is the grandfathering.

The write-up shipped with the fix says every current subscriber is on rung 1 — but its author had no database access and flagged that as an honest expectation, not a fact. **I have that access, so I counted.**

**The paying learners — your real subscribers:**

| | |
|---|---|
| Live paying learners (SSi Premium) | **5** |
| Of those on rung 1 (carry `provider_subscription_id`) | **5 — all of them** |

Every single paying customer resolves at rung 1. Their renewal and cancellation paths do not touch one line of new code. **Your condition holds, and it is now a measured fact rather than an expectation.**

**Schools and orgs — where the picture differs from the write-up:**

| | |
|---|---|
| Schools holding live platform state | 21 |
| Orgs/groups holding live platform state | 12 |
| Of those 33, how many are **paying** | **0 — every one is `status=trial`** |
| Of those 33, how many are on rung 1 | **0 — none carries a subscription id** |

No school or org can lose paid access, because none has any. But this inverts one caveat in the write-up. It offered, as a rare corner case Tom could overrule, that *"a school still inside its free trial, upgrading from a browser running stale cached JavaScript is refused rather than bound."*

That is not a corner case. An unelapsed trial counts as a live entitlement (`api/_utils/platformStatus.ts:26`), which closes rungs 3 and 4 to it. So **all 33 nodes can be bound by rung 2 — the signed checkout intent — and nothing else.** Every future school and org purchase in the estate now rests entirely on that one path working.

Nobody loses access from this: their trial is untouched and nothing is written. The failure mode is different — **a school pays and the purchase fails to attach**, needing manual remediation. That is a money-path risk you should be told about before this reaches production, not after. It does not block the merge, and it argues for option A: let a school upgrade run through staging before real money meets it.

**No path can take access away.** A failed resolution logs and returns without writing (`paddle-webhook.ts:765`); `guardCandidate` only ever *refuses to write*, never revokes; and `wouldDowngradePlan` blocks any write that would lower a live plan.

---

## Test results — after merge onto fresh main-line, not inherited

| Gate | Result |
|---|---|
| API tests | **1,240 passed**, 109 files, 0 failed |
| Player tests | **2,217 passed**, 230 files, 0 failed |
| `@ssi/core` tests | **671 passed**, 31 files, 0 failed |
| `typecheck:api` | **clean** |
| player `vue-tsc` | **clean** |

One note on how I got there, because it nearly produced a false alarm: my first player run showed 39 failures. They reproduced identically on untouched `origin/dev` **and** untouched `origin/main`, which is what told me they weren't A-123's. The cause was my own worktree — `@ssi/core` hadn't been built. After building it, all 2,217 pass. The branch introduces no regression; the numbers match what the previous worker reported.

---

## Landing

Four commits — `1ccdd638`, `cfff6afc`, `a0d1f829`, `dc516057`.

- **Branch:** `fix/a123-paddle-customer-binding-2026-08-16` (unchanged, still on origin)
- **Merged to:** **`dev`** — fast-forwarded `6fa4c2d4` → `dc516057`, pushed
- **Deployed to:** the dev Vercel alias only (`ssi-learning-app-git-dev-zenjin.vercel.app`, HTTP 200). **Production `main` is still `194b98b1` and has NOT picked this up — deliberately, pending your answer above.**
