# The learner-journey harness was still signing in as Tom's real account

**2026-09-06. Answer: YES, it was. It is fixed, on a branch, proven. One related exposure is left open and named at the bottom.**

## The finding

`packages/player-vue/e2e/journeys/run.mjs` line 45, on `dev` and on `main`:

```js
const TESTER = process.env.TESTER_EMAIL || 'thomas.cassidy+ssi@gmail.com'
```

Five of the six journeys — j2, j3, j4, j5, j6 — call `mintSession(TESTER)` and drive the real deployed app as that account.

`thomas.cassidy+ssi@gmail.com` is Tom's real learner account. From the live database:

| account | sessions | cursors |
|---|---|---|
| **thomas.cassidy+ssi@gmail.com** | **3,724** | zho S0668L02 (108 min), ita S0668L02 (89 min), jpn, deu, fra, spa, hrv, gle… fifteen courses |
| thomas.cassidy+bumface@gmail.com | 22 | ita, zho, eng_for_kan — no cursors |
| thomas.cassidy@gmail.com | 1 | none |
| tomcassidy@mac.com | 0 | none |

## The damage, and it is still in the database

`App.vue:379` writes `learners.preferences.last_course_code` every time a course is picked. Journeys j2 and j4 pick courses — `COURSE_A` (default Spanish) and `COURSE_B` (default Italian) — on the signed-in account.

Sessions on Tom's learner row, 1 September, 09:xx:

```
   Tue Sep 01 2026 09: | dur 0 | items 0 | spa_mx_for_eng
   Tue Sep 01 2026 09: | dur 0 | items 0 | ita_for_eng
   Tue Sep 01 2026 09: | dur 0 | items 0 | spa_mx_for_eng
   ... ~150 rows, all zero-duration, zero-item, alternating spa_mx / ita
```

That is the harness's Spanish/Italian switch, machine-gunned, on his account, on the morning he typed STOP USING TOMS ACCOUNT to a worker that never received it. His `last_course_code` today reads `zho_for_eng`; whatever it read that morning was written by the harness, not by him.

## The fix

Branch `cs/924-e2e-test-account` in `ssi-learning-app`, off `dev`. Commit `45dad68e`.

- **`e2e/_test-accounts.mjs`** (new) — the protected register of real human accounts, and the dedicated journey learner `thomas.cassidy+e2e-learner@gmail.com`.
- **`journeys/lib.mjs`** — `mintSession()` is the single choke point every journey passes through. It now **throws** for a protected account. Not returns false: a boolean is the thing that gets ignored.
- **`journeys/run.mjs`** and **`returning-learner-latency-probe.mjs`** default to the dedicated learner, and `TESTER_EMAIL` is validated rather than trusted — pointing it at Tom fails at module load, before a browser opens.
- The dedicated account is created on first run, so "use a test account" has no manual provisioning step anybody can skip.

## The proof

`node e2e/_prove-test-account.mjs`, run against the live project:

```
PASS  Tom is in the protected register
PASS  the default tester is not Tom — thomas.cassidy+e2e-learner@gmail.com
PASS  mintSession REFUSES Tom — REFUSING to sign in as thomas.cassidy+ssi@gmail.com …
PASS  mintSession works for the test learner
PASS  the minted session is a different user — thomas.cassidy+e2e-learner@gmail.com = 34cce508-…
PASS  Tom's learner row is untouched by this proof
6 passed, 0 failed
```

And the override path:

```
$ TESTER_EMAIL=thomas.cassidy+ssi@gmail.com JOURNEY=j4 node e2e/journeys/run.mjs
Error: REFUSING to sign in as thomas.cassidy+ssi@gmail.com — that is a real person's account.
```

**No learner progress row was modified.** The only database write in this work was the creation of one new auth user, the dedicated test learner.

## Still open — the admin half

The same address is also the platform's `ssi_admin`. Six probes on `dev` still mint a session as it:

`csp-audit-probe.mjs`, `ime-vad-topup-probe.mjs`, `vad-empty-state-ui-probe.mjs`, `org-hierarchy/verify-org-tree.mjs`, `org-hierarchy/verify-neutral-dressing.mjs`, `demo-schools/verify-demo-schools.mjs`, `resolved-session-audit/mint-sessions.mjs`.

Five are read-only admin-surface checks. One is not: `csp-audit-probe.mjs` exercises **signed-in learner audio playback** as that account, so it plays lessons on Tom's row.

I did not fix these, and would not fix them blind: they need admin rights, so the answer is a dedicated `ssi_admin` test account, which means granting a platform role in production. That is a call about who holds admin in the live system, not a harness tidy-up.

**Recommendation:** create `thomas.cassidy+e2e-admin@gmail.com`, grant it `ssi_admin`, add it to the register as the admin tester, and repoint those seven files — one pass, mechanical once the account exists. One sentence from Tom unblocks it.
