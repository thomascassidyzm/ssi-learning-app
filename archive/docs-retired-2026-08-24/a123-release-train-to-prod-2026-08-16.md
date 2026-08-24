# A-123 — the release train, dev → staging → main

**16 August 2026.** Tom's ruling on the A-123 Paddle tenant-hijack fix was **option A**: run the
normal release train. His words: *"the hole is closed on dev, nothing suggests active exploitation,
and the second pass's purchase-path edges are exactly what a soak exists to catch."*

This is the record of that run — what the process actually is, what was verified at each stage, and
what is knowingly riding along unfixed.

---

## 1. The process, verified against the code rather than assumed

`ssi-learning-app` does **not** share Popty's "everything goes to main" rule. Its own `CLAUDE.md`
sets a three-tier flow, and the tooling matches it:

| Stage | How it actually happens | Evidence |
|---|---|---|
| `dev` → `staging` | A deliberate `--no-ff` merge run by a human. There is **no script** for this half. | `CLAUDE.md` "Promotion is manual and deliberate"; precedent `docs/promote-dev-to-staging-2026-08-06.md` |
| `staging` → `main` | `tools/release-train/promote.sh --go` — refuses without `--go`, refuses if `main` is not an ancestor of `staging`, merges in a throwaway worktree, then regenerates the release notes from the range it actually promoted. Never cronned. | `tools/release-train/promote.sh`, `docs/RELEASE-TRAIN.md` |
| Gates | Six, defined once in `.github/workflows/verify.yml`: player lint, player typecheck, API typecheck, player tests, API tests, release-train notes tests. | `verify.yml` |
| Post-push watch | `tools/deploy-sentinel/` is already cron'd every 3 min and opens a 2h window on any new `main` sha. Nothing to arm. | `docs/RELEASE-TRAIN.md`, `tools/deploy-sentinel/state.json` |

**Deploy targets:** `staging` → `staging.saysomethingin.app`; `main` → `saysomethingin.app`. Both
serve `/version.json`, which carries the short sha of the build actually being served — that is the
check that a deploy is genuinely live rather than assumed.

### GAP — CI is dark, estate-wide, and it is not this code

GitHub Actions has not run a job on this repo since **14 August**. Every run since then failed
before starting, with:

> The job was not started because recent account payments have failed or your spending limit needs
> to be increased.

So the Verify workflow could produce **no** verdict on the tree being promoted. This is an
infrastructure/billing problem on the GitHub account, unrelated to A-123, and it is worth Tom
knowing about in its own right: **the repo currently has no automated gate at all.**

Following the documented precedent for exactly this situation (`promote-dev-to-staging-2026-08-06.md`,
where the dev tip was a merge commit with no CI run of its own), **all six gates were run locally
against the exact tree being promoted.**

---

## 2. Gates — run locally on the promoted tree

Tree `4579d6af` (dev tip at the time of the run), in an isolated worktree, pnpm 8.15.0 matching CI:

| Gate | Result |
|---|---|
| Player lint | **pass** — 0 errors (152 pre-existing warnings) |
| Player typecheck (`vue-tsc`) | **pass** |
| API typecheck | **pass** |
| Player tests | **2,212 passed**, 3 skipped, 2 todo (231 files) |
| API tests | **1,240 passed**, 6 todo (109 files) |
| Release-train notes gates | **25 passed** |

Every gate exit code 0. The player and API figures match exactly what the pre-promotion write-up
reported, independently reproduced here.

One docs-only commit (`c374f17f`, the open-loops entries in §5) landed on `dev` after this run and
rode the promotion. `verify.yml` deliberately skips the suite for `docs/**`-only changes, so no gate
was bypassed.

---

## 3. dev → staging

**Pre-flight.** `staging` held **2 commits `dev` did not** — a prior promote merge and a hotfix
back-merge. A merge preserves those either way, but rather than trust that, the outcome was checked:

```
merged tree:  2c8ca0dbad3820dfee6fc2ab8eb7cfb67b89dc6f
dev tree:     2c8ca0dbad3820dfee6fc2ab8eb7cfb67b89dc6f
```

**Byte-identical.** Nothing staging-only was lost, nothing unexpected was added — the same proof
standard the 2026-08-06 promotion used.

**Promoted:** 27 commits, `23ea9380` → `0c47b0c3`, merged `--no-ff` in a throwaway worktree so no
live checkout was touched.

---

## 4. What is knowingly riding along unfixed

Tom's two riders, both discharged in `docs/OPEN-LOOPS.md` (the repo's own register of
not-completely-solved threads — the existing convention, not a new system), under *Money,
entitlements, premium*:

**Rider 1 — the tutor lane, filed so it cannot get lost.**
`handleTutorPlatformSubscription` (`api/teacher/paddle-webhook.ts:976`) takes `customData.teacher_id`
straight from the browser, proves nothing about who paid, and `.update()`s `platform_status` and
`platform_expires_at` on that row — no binding check, no rung-1 short-circuit, none of A-123's
ladder. Verified directly in the code, not taken on report. **Pre-existing; A-123 does not make it
worse**, but the fix's write-up reads as covering it and does not. Unlike the learner lane this one
can *remove* access: a cancellation event addressed at someone else's `teacher_id` writes
`platform_status:'cancelled'` onto their row. Live exposure is why it waits, not urgency — see §5.

**Rider 2 — two purchase-attribution edges, documented as known behaviour, NOT fixed.**
- A first purchase is refused when the payer's email maps to **more than one learner** (or an
  unverified `learner_emails` row). Multiple accounts per person is intentional on this estate, so
  multi-match is an expected state. No access is lost and nothing is written; the purchase simply
  fails to attribute.
- An **overlapping upgrade** — a learner buying a higher plan before the old one lapses — has its
  row write blocked by the plan-precedence guard. They keep the plan they have; the upgrade they
  paid for does not apply until someone intervenes.

Both are logged `known-accepted`. **Neither is to be resolved automatically.** If either fires on a
real buyer, that is Tom's call with that buyer's situation in hand.

---

## 5. Soak — the money-path and access-preservation checks

### 5a. Staging is genuinely serving the new code

Two independent confirmations, not an assumption:

- `staging.saysomethingin.app/version.json` → `{"buildNumber":"0c47b0c"}`
- A Vercel deployment record exists for sha `0c47b0c3`, created 15:04:48 UTC.

The five probes the deploy sentinel uses in production, run against staging: **all 200** — app
shell (`div#app` present), `/api/sw-config` (`killSwitch:false`), `/api/courses/available`,
`/api/audio/…`, `/api/player-events` OPTIONS.

### 5b. The server-side fix is deployed, proven by differential probe

`api/billing/bind-customer.ts` is **new in A-123**, so its presence is a direct test of whether the
server half shipped — the front-end bundle alone would prove nothing.

| | `POST /api/billing/bind-customer`, no auth |
|---|---|
| **staging** (post-A-123) | **401** `{"error":"Missing or invalid Authorization header"}` |
| **production** (pre-A-123) | **404** `NOT_FOUND` |

Staging has the endpoint and enforces identity at the door. Production, at this point, did not have
it at all.

### 5c. Access preservation — measured against the live database

Staging and production share **one** Supabase project (`swfvymspfxmnfhevgdkg`), so live customer
state is the same data either way. Measured directly, 15:06 UTC:

| Check | Result |
|---|---|
| Live paying learners (`status` in active/past_due) | **5** — 4 active, 1 past_due |
| Of those carrying `provider_subscription_id` (**rung 1**) | **5 — all of them** |
| Non-terminal paid rows with NO subscription id (the STOP condition) | **0 rows** |
| Schools holding platform state | 24 — **all `trial`**, 0 paying, 0 on rung 1 |
| Orgs/groups holding platform state | 12 — **all `trial`**, 0 paying, 0 on rung 1 |
| Teacher rows (tutor lane) | 7 total, 5 carrying `platform_status`, **all `trial`, 0 paying** |

Every paying customer resolves at rung 1, which returns *before* any A-123 guard runs — their
renewal and cancellation paths do not touch one line of new code. Tom's binding condition holds as
a measured fact.

### 5d. The two ridden-along edge cases — did either fire on a real buyer?

**No. Neither has fired.** Evidenced rather than assumed:

- **Multi-match payer email.** Six addresses do map to more than one learner — but every one is a
  test or demo account (`e2e-mapping-recorder@ssi-test.invalid`, `thomas.cassidy+…` aliases), and
  **none of them has a single subscription row**. No real buyer has been refused.
- **Overlapping upgrade.** **Zero** learners hold more than one subscription row, so there is no
  overlapping-plan case anywhere in the live data.
- **Purchase activity in the last 14 days: three rows, none newer than 9 August** — all ordinary
  renewals/cancellations, all carrying a subscription id (rung 1).

### 5e. The money-path behaviour itself, by test

A-123's six security suites, re-run on the promoted tree: **69 passed, 4 todo, 0 failed.** The ones
that carry Tom's condition:

- `ACCESS: an existing subscriber's own renewal still resolves and still writes`
- `ACCESS: the learner's own renewal still writes`
- `allows a node its OWN subscription is writing to (every renewal and cancellation)`
- `ACCESS: a refused resolution on a CANCELLATION writes no downgrade at all`
- `ACCESS: an unresolvable CANCELLATION writes no downgrade anywhere`
- `ACCESS: the follow-up cancellation cannot flip the victim's premium off`
- `SEC15-04: a multi-learner match is REFUSED, not resolved arbitrarily — nothing is written`

**No write on refusal** is the property those last four pin: refusal paths return before their
`.update()`.

### 5f. What this soak did NOT prove — stated plainly

- **No real purchase happened during it.** There has been no purchase activity on the estate since
  9 August. The purchase-path edges were exercised by the test suite and by inspection of live
  data, **not by a real buyer meeting the new code.** The first real purchase after this ships is
  still the first real exercise of rung 2.
- **This was a hours-long soak, not the usual week-long vet by the external test team.** Tom
  directed the promotion in this pass; that shortening is his call, recorded here so it is not
  mistaken for a full-length soak.
- **The audit's gap #1 stands.** A grandfathered *cancellation* is still not driven at webhook
  level — it is covered at the binding-unit level and provable by inspection (rung 1 returns at
  `paddle-webhook.ts:765`, before the handler reads `data.status`), but there is no webhook-level
  test. A gap in proof, not in code.
- **CI produced no verdict** (§1) — all gate evidence here is local.

---

## 6. staging → main

### The train was blocked, and not by A-123

`promote.sh` refused:

> REFUSING: origin/main is NOT an ancestor of origin/staging.
> main has 3 commit(s) staging does not.

Three **fix-lane** commits went straight to `main` on 13–14 August and were **never back-merged**
into `staging` or `dev`:

| Commit | What |
|---|---|
| `3a1774f2` | the intro's authored mapping feeds the tile assembler |
| `d05df656` | an A-LEGO never splits — one word on a side, one tile |
| `194b98b1` | curate the seventeen languages only ICU was naming |

This is the one way the hotfix lane can hurt you, and `docs/RELEASE-TRAIN.md` names it exactly:
*"Skipping the back-merge is the one way this lane can hurt you."* It had silently blocked **any**
promotion since 14 August. Nothing to do with A-123 — it simply surfaced here because this is the
first promote attempted since.

**Reconciled the documented way:** `main` back-merged into `dev` (`4dcb16fa`, clean, no conflicts),
then `dev` promoted to `staging` (`a426107c`). Because the back-merge brought real code changes into
a tree that had never been tested in that combination — and CI is dark — **all six gates were re-run
on the merged tree**: player **2,226 passed** (up 14: the back-merged commits brought their own
tests), API **1,240 passed**, typechecks and lint clean, release-train 25 passed. Staging's tree came
out byte-identical to dev's again (`66983163`), and staging re-verified live at `a426107c` with all
five probes 200 and `bind-customer` still 401.

### The promote

```
./tools/release-train/promote.sh --go
PROMOTED: main is now f9fc3c21 (65 commits shipped).
```

Range `194b98b1..a426107c`. Release notes regenerated from the range actually promoted and committed
to `dev` (`636197fa`) — `tools/release-train/notes/2026-08-13.md`, ship date 2026-08-16.

### Production is running A-123's code — verified, not assumed

| Check | Before promote | After |
|---|---|---|
| `saysomethingin.app/version.json` | `194b98b` | **`f9fc3c2`** |
| `POST /api/billing/bind-customer` (new in A-123) | **404** `NOT_FOUND` | **401** `Missing or invalid Authorization header` |
| `GET` same path | 404 | **405** Method not allowed |

The 404 → 401 flip is the load-bearing one: it proves the **server** half shipped and is enforcing
identity, which a rebuilt front-end bundle alone could never demonstrate.

Full sentinel probe set on production: **all 200** — app shell (`div#app` present), `/api/sw-config`
(`killSwitch:false`), `/api/courses/available`, `/api/audio/…`, `/api/player-events` OPTIONS.

**Post-deploy access check, live database:** 5 live paying learners, **5 of 5 still on rung 1, 0
rows meeting the stop condition.** Nobody lost access.

The deploy sentinel (`tools/deploy-sentinel/`, cron'd every 3 min) opens its own 2-hour fallout
watch on `f9fc3c21` automatically — deploy-live check, endpoint probes and production telemetry
against a 4-week same-clock baseline. Nothing further to arm.

---

## 7. Two things worth Tom's attention

1. **GitHub Actions is payment-blocked** — no CI verdict on this repo since 14 August, so it
   currently has no automated gate. Not a code problem; an account/billing one. Every gate in this
   promotion was run locally to compensate, but that does not scale.
2. **The fix lane's back-merge step was skipped twice**, and it silently blocked the release train
   for two days. The refusal worked exactly as designed — but nothing *tells* anyone until someone
   next tries to promote.
