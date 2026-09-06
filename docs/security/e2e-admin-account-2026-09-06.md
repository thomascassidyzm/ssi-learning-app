# The last door: the admin harnesses had Tom's ssi_admin session too

*2026-09-06 — job #939, on top of #924 (`docs/security/e2e-harness-real-account-2026-09-06.md`).*

## What was still open

#924 found the six-journey harness signing in as `thomas.cassidy+ssi@gmail.com`
— Tom's real learner account, 3,724 sessions, live cursors in fifteen courses —
and closed it for the learner journeys with a register (`e2e/_test-accounts.mjs`)
that **throws** rather than returning false.

That address is also the platform `ssi_admin`. Seven more scripts still minted an
admin session as it, each with its own private copy of `mintSession`, none of them
passing through the register:

| script | what it did as Tom |
|---|---|
| `e2e/csp-audit-probe.mjs` | **the dangerous one** — drives signed-in learner audio playback, so it played lessons on his row |
| `e2e/ime-vad-topup-probe.mjs` | admin dashboards |
| `e2e/vad-empty-state-ui-probe.mjs` | admin dashboards |
| `e2e/org-hierarchy/verify-org-tree.mjs` | `/admin` org tree |
| `e2e/org-hierarchy/verify-neutral-dressing.mjs` | `/admin` org tree |
| `e2e/demo-schools/verify-demo-schools.mjs` | `/schools/all`, `/admin` |
| `e2e/resolved-session-audit/mint-sessions.mjs` | minted and **wrote to disk** a session as him |

A default that reads like a harmless constant is how #924 happened, and it had
been copy-pasted seven more times.

## What was done

**1. A dedicated admin, created in the live project** (Tom's ruling, 2026-09-06):

- `thomas.cassidy+e2e-admin@gmail.com`
- auth user `6f700136-12e8-402e-a3ea-40db859407e9`
- learner row `ce5bb62e-a82f-469c-b9ca-ea94b31049ae`, `platform_role = 'ssi_admin'`,
  `is_internal = true`, display name "e2e admin (harness)"

Tom's own admin account is untouched and still `ssi_admin` — this is a second
admin, not a transfer.

**2. All seven scripts repointed** to `adminEmail(process.env.ADMIN_EMAIL)` — the
register's resolver, which defaults to `TEST_ADMIN` and puts an `ADMIN_EMAIL`
override through the same guard. "I set an env var" is not a licence to drive the
app as a human being. Each script's private `mintSession` now calls
`assertNotProtected(email)` as its first statement, so the choke point is on the
mint itself and not only on the constant.

In the two VAD probes the resolution is deliberately **hoisted above the `.env`
read**: a refusal to sign in as a real person must not depend on the box having
an env file. Before the hoist, a machine without `.env` failed with `ENOENT`
instead of the refusal — the guard was right, and unreachable.

**3. Proof — `e2e/_prove-admin-account.mjs`, 23 checks, all green.** It is
read-only against Tom's data.

- The harness admin exists, is a different auth user and a different learner row
  from Tom's, and carries `ssi_admin`.
- All seven scripts, given `ADMIN_EMAIL=thomas.cassidy+ssi@gmail.com` **and real
  keys** (so a refusal can only be the guard, never a missing env var wearing the
  guard's clothes), exit non-zero with `REFUSING to sign in as admin as
  thomas.cassidy+ssi@gmail.com`. `CHROME_BIN` is set to a bogus path throughout:
  the absence of that path in the output is the evidence that no browser opened.
- `csp-audit-probe.mjs` was then run for real as the new admin, with Tom's
  fingerprint taken before and after: his full `learners` row plus row count and
  newest row for `sessions`, `lego_progress`, `seed_progress`,
  `course_enrollments`, `daily_contributions`, `response_metrics` and
  `player_events`. Byte-identical.

## What was deliberately NOT done

Tom's damaged rows from 1 September — the ~150 zero-duration sessions #924
identified — are **untouched**. Repairing a person's learning history is his call,
not a harness fix.

## The proof output, as run

```
$ PROVE_CSP=1 node e2e/_prove-admin-account.mjs
PASS  Tom is in the protected register
PASS  the harness admin is not Tom — thomas.cassidy+e2e-admin@gmail.com
PASS  adminEmail() defaults to the harness admin
PASS  adminEmail() REFUSES Tom — REFUSING to sign in as admin as thomas.cassidy+ssi@gmail.com …
PASS  the harness admin exists in the live project — 6f700136-12e8-402e-a3ea-40db859407e9
PASS  it is a different auth user from Tom — 6f700136-… vs ef65ea1f-…
PASS  it carries platform_role = ssi_admin — ssi_admin
PASS  it is a different learner row from Tom — ce5bb62e-… vs 81987d60-…
PASS  csp-audit-probe.mjs refuses Tom's address                 (+ refused before any browser launch)
PASS  ime-vad-topup-probe.mjs refuses Tom's address             (+ refused before any browser launch)
PASS  vad-empty-state-ui-probe.mjs refuses Tom's address        (+ refused before any browser launch)
PASS  org-hierarchy/verify-org-tree.mjs refuses Tom's address   (+ refused before any browser launch)
PASS  org-hierarchy/verify-neutral-dressing.mjs refuses Tom's address (+ refused before any browser launch)
PASS  demo-schools/verify-demo-schools.mjs refuses Tom's address (+ refused before any browser launch)
PASS  resolved-session-audit/mint-sessions.mjs refuses Tom's address (+ refused before any browser launch)

— running csp-audit-probe as the harness admin —
  signed-in learner audio playback   violations: 0
  offline bulk audio download        violations: 0
  /schools teacher dashboard         violations: 0
  /schools/all govt_admin view       violations: 0
  /admin root                        violations: 0
  Paddle checkout overlay            violations: 0
PASS  csp-audit-probe ran to completion — exit 0
PASS  Tom's learner row and every progress table are byte-identical — 995 bytes unchanged

24 passed, 0 failed
```

The `/admin` screenshot from that run shows the SSi Admin *Structure* view listing
80 organisations — so the new account's `ssi_admin` is real in the app, not only
in the `learners` row.

## Running it again

The proof needs `@playwright/test`, so a fresh worktree needs `pnpm install`
first. Chrome comes from `CHROME_BIN` or the Playwright cache, as everywhere else
in `e2e/`.
