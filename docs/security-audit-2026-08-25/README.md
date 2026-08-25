# Security & vulnerability audit — 2026-08-25

Run as reset-eve spare-capacity work on branch `security/audit-2026-08-25`.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix
was applied, nothing was promoted, no money moved, and no email or OTP was sent. Production contact
is itemised in §5 — if that section says "none", none was made.

---

## 0. Why this audit exists, given there have been three already

This is the **fourth** security audit of this repo in fourteen days. Re-running the earlier
partitions would have produced a fourth copy of the same findings, so the partition was chosen
specifically against what the earlier three left behind.

| Audit | Where it lives | State |
|---|---|---|
| 2026-08-11 | `docs/security-audit-2026-08-11/` (6 area reports, ~1,100 tests) | **branch `sec/audit-2026-08-11`, still UNMERGED** |
| 2026-08-18 | `docs/security/api-audit-2026-08-18.md` (5 deliberately-red specs) | on `dev`; specs run only by `pnpm run test:security-audit`, **not a CI gate** |
| 2026-08-22 | `docs/security-audit-2026-08-22/` (SEC22-01…05) | **merged into `dev`** |

That table is itself the audit's first observation, and it drove the whole partition:

> **The 2026-08-11 audit is not on `dev`.** Its six reports and its ~1,100 tripwire tests — including
> two findings it rated **critical** — exist only on a branch nobody has merged. On the branch that
> actually ships, those findings have no document, no test, and no way to go red. A finding that
> cannot regress-fail is not a finding, it is a memory.

Measured, so it is not left as an impression:

```
$ git ls-tree -r --name-only origin/sec/audit-2026-08-11 | grep 'security.test.ts$' | wc -l   # 33
$ git ls-tree -r --name-only origin/dev                  | grep 'security.test.ts$' | wc -l   # 10
$ comm -23 <(…08-11…) <(…dev…) | wc -l                                                       # 29 missing
```

**29 of the 33 security-test files that audit wrote never reached `dev`.** The four that did are
`batchUrlsBulk`, the two `paddle-webhook` tenancy suites, and `securityHeaders` — that is, *exactly*
the tests attached to a finding someone then went and fixed. **Tests attached to findings nobody
fixed stayed stranded with them.** The tripwire only survives if it rides a fix.

And the branch is decaying: it is now **330 commits behind `dev`**, and a merge today conflicts on
`api/audio/batchUrlsBulk.security.test.ts` — a file that reached `dev` by another route and has since
diverged. "Just merge it" was a one-liner two weeks ago. It is not one now.

This audit's own output is on a branch too, and is subject to the same decay. That is the one item in
§7 that needs a human decision rather than a fix.

So this audit's four areas are the four things the earlier three could not or did not do:

| Area | Question | Worker |
|---|---|---|
| **A** | The API delta since 2026-08-22 — new endpoints nobody has ever audited | #467 |
| **B** | The client surface — least-audited area, and its own report is on the unmerged branch | #468 |
| **C** | **Reconciliation** — of the 2026-08-11 findings, which are still live on `dev` *today*? | #469 |
| **D** | DB posture, repo hygiene, and the integrity of the security-test machinery itself | #470 |

The coordinator additionally regenerated the handler map (`handler-map.md`) and took the one thread
no area owned: the ungated `courses/[code]/round-map.ts` (SEC25-X-01, SEC25-X-02).

---

## 1. Findings — ranked

The audit's single most important output is not a new vulnerability. It is this:

> **TENANCY-01, filed as `critical` on 2026-08-11, is still live on `dev` fourteen days later** — and
> until this branch, `dev` carried no test that could have told anyone.

| # | ID | Sev | Status | Where | Costs an attacker |
|---|---|---|---|---|---|
| 1 | TENANCY-01 | **critical** | **still live** | `api/groups/[id]/invites.ts:132` | a signed-in account and a duplicate org name |
| 2 | SEC25-X-03 (esc. of SEC25-A-01 + AUTH-CORE-01/05) | **high** | still live | `api/code/redeem.ts` + `_utils/codeAttemptThrottle.ts` | patience, unmetered |
| 3 | SEC25-D-02 | **high** | still live | `admin_practice_minutes*()` — `SECURITY DEFINER`, `EXECUTE` to `anon`, no auth gate | a learner UUID; **nothing at all** for the `_by_course` variant |
| 4 | TENANCY-02 | high | still live | `api/groups/[id]/rate-compare.ts:319` | the same collision as #1 |
| 5 | SEC25-D-01 | medium | still live | 16 `SECURITY DEFINER` functions with no `SET search_path` | object-creation rights |
| 6 | TENANCY-04/05/06/07, AUTH-CORE-03/04 | medium | still live | see `area-c-reconciliation.md` | — |
| 7 | SEC25-D-03 | low *(cross-repo)* | still live | 5 RLS-off tables `GRANT ALL` to `anon`, incl. write | the public anon key |
| 8 | SEC25-B-01 | low | still live | `vercel.json` CSP `connect-src` vs `usePublishedExplainers.ts` | nothing — it is a trap for the next promoter |
| 9 | SEC25-X-01 / X-02 | low | still live | `api/courses/[code]/round-map.ts` | nothing |
| 10 | SEC25-D-04/05/06 | low / info | still live | `.gitignore`, floating action tags, 7 dep advisories | — |

### #1 — TENANCY-01, verified end to end by the coordinator

Worker #469 returned this as **STILL LIVE**. Because it is the most consequential claim in the
audit, the coordinator re-verified every link rather than relaying it. All three hold on `dev` today:

1. **The resolver still keys on the slug path.** `api/groups/[id]/invites.ts:132` —
   ``.or(`path.eq.${path},path.like.${path}/%`)``. The `/`-boundary on the `like` half is correct.
   The `path.eq` half is the hole: two unrelated root orgs whose names slug identically have *equal*
   paths. `_utils/groupSubtree.ts` says so in the codebase's own words, and records that it happened
   live — two orgs both called "Deborah Testing" both got `path = 'deborah-testing'`.
2. **The collision is attacker-creatable.** `api/groups/index.ts:58-67` — root-org creation is "open
   to any signed-in user"; the only gate is one org per leader. The duplicate-name check at `:154-161`
   is, in its own comment, a "WARNING (never a constraint)": re-send with `confirm_duplicate: true`
   and it "proceeds byte-identically".
3. **The write path trusts the same collided subtree.** The PATCH ownership check at `:173-181` tests
   membership against `subtree` — the very object step 1 mis-resolved. So `revoke`, `reactivate`,
   `resend` and `rotate` all reach the victim's rows.

**What that yields.** `GET /api/groups/<attacker's own node>/invites?scope=subtree` returns the
victim org's invite codes *with their ready-to-share URLs*. Those include **personal links**, which
are bound to a specific `personal_auth_user_id` and whose sign-ins are logged to
`possession_mint_attempts` — that is, a personal link is a credential for one named account. And
`rotate` mints a **new** code bound to that same account, which only the attacker then knows.

So the honest severity is worse than the 2026-08-11 report's "another tenant's invite codes": the
chain reaches **account takeover of a named person in the victim organisation**. The 08-11 rating of
`critical` stands, and nothing about it has softened in fourteen days.

**Not fixed here, deliberately.** This run's rules are findings-and-tests-only. The fix the original
report recommends is unchanged and small: resolve the subtree by `parent_id` — `descendantIds()` —
never by path string. It is the same fix the `c2f04665` hardening pass already applied to
`groupSubtree`, `schoolScope`, `groupRollups` and `rate-compare`; `invites.ts` was the caller that
pass missed.

Tests: `api/_security/reconcile-2026-08-25-tenancy.security.test.ts`.

### #3 — SEC25-D-02, verified by the coordinator

`admin_practice_minutes(p_learner_ids uuid[])` and `admin_practice_minutes_by_course()` are
`LANGUAGE sql STABLE SECURITY DEFINER` (`schema.sql:249`, `:292`) with `GRANT ALL … TO anon`
(`:19074`, `:19083`) and **no internal auth check** — the body goes straight to `sessions`. They pin
`search_path`, so D-01 does not apply; the gap is authorization, not resolution. They therefore
bypass the learner-data own-row RLS that CLAUDE.md records as live since 2026-06-10, for any caller
holding only the public anon key. Same shape as SEC22-01 — a privileged DB object left reachable by
`anon`. Sibling `admin_user_course_stats` gates on `is_ssi_admin()`; these two are the missed callers.

**The two variants have different reach, and the difference matters:**

| Function | Signature | What an anonymous caller needs |
|---|---|---|
| `admin_practice_minutes` | `(p_learner_ids uuid[])` — no default | **a learner UUID**, which is not enumerable through this function. Targeted lookup only. |
| `admin_practice_minutes_by_course` | `(p_learner_ids uuid[] DEFAULT NULL)` | **nothing.** The body reads `where (p_learner_ids is null or …)`, so a no-argument call returns **platform-wide practice minutes grouped by course**. |

An earlier draft of this section claimed a known learner UUID was required in both cases. That is
wrong for the `_by_course` variant and the correction is load-bearing: the no-argument call needs no
prior knowledge at all. What it returns is course-level *aggregate* engagement — commercially
sensitive platform metrics, not per-learner personal data. The per-learner variant is the one that
touches individuals, and that one does require a UUID.

### #7 — SEC25-D-03 is a cross-repo hand-off, not a learner-facing hole

Five tables have RLS off and `GRANT ALL` to `anon`, INSERT/UPDATE/DELETE included: `audio_clips`,
`audio_clip_promotions`, `audio_convergence_log`, `language_canonical`, `relink_refusals`. The
coordinator checked before ranking it: **none of the five is referenced anywhere in this repo** —
they are Popty/dashboard recording-pipeline tables. So the learner-facing impact from this codebase
is nil, and it is ranked low here on that basis. It is a content-pipeline integrity exposure that
belongs to the dashboard side, and it breaches this repo's own RLS doctrine rule 7 ("every new table
gets an explicit posture at creation — never Supabase's grant-open default"). **The dashboard repo's
use of these tables was not audited** — see §4.

### The reconciliation, in one line

Of the 34 *substantive* 2026-08-11 findings re-checked line-by-line against today's `dev`:
**8 FIXED · ~24 STILL LIVE · 1 SUPERSEDED · 1 UNVERIFIABLE** (worker #469's own count, over
substantive findings only; a naive count of verdict markers in the table reads 6/36/1/2/2 because
several rows carry more than one marker and info/design-note rows are excluded from the 34). The fixes that landed are the ones that audit ranked most severe —
both criticals it found in the money path, and the highest-confidence high. That is correct
prioritisation happening *despite* the branch never merging. Full table: `area-c-reconciliation.md`.

---

## 2. The handler map

Regenerated against today's `dev`: **109 handlers, 106 of them service-role, 7 with no auth helper.**
Full table and the verdict on each of the 7: [`handler-map.md`](./handler-map.md).

The number to carry into every finding below: **97% of the API surface talks to Supabase as the
service role, which bypasses RLS entirely.** That is deliberate architecture, and it means a missing
scope check in a handler is not a weakened check — it is no check.

One thing genuinely closed since 2026-08-11: that audit flagged the `courses/[code]/*` content
endpoints as an open question, since "they hold the *whole course*, which is the paid product".
Three of the four — `bundle`, `cycles`, `infplay-cycles` — now gate on `resolveServerCourseAccess`
and return `403 Subscription required`. That is pinned by a passing test so it stays true.

---

## 3. Coordinator findings — `courses/[code]/round-map.ts`

The fourth content endpoint is ungated, and this audit's verdict is that **that is defensible**: it
projects `round_index, lego_id, seed_number` and nothing else — no known text, no target text, no
audio id, no presigned URL. An anonymous caller learns a paid course's *shape*, not its content. A
test pins that projection, so if a future change adds text or audio columns the endpoint silently
becomes an anonymous read of the paid product and the suite goes red.

Two low findings sit on it:

### SEC25-X-01 — the 503 branch hands an anonymous caller an internal relation name and its DDL · **LOW**

```ts
res.status(503).json({
  error: 'round map not yet materialised, run REFRESH MATERIALIZED VIEW course_round_index',
})
```

Reachable unauthenticated. It names an internal object and the exact statement to run against it.
Every comparable handler returns a fixed string and logs the detail server-side —
`api/board/snapshot/[code].ts` returns `'Internal server error'`. Same family as SEC22-03 (2026-08-22),
which is the tell that the convention is not being carried by anything mechanical.

**Suggested fix (not applied):** fixed caller-safe string in the body; relation name and remedy to
`console.error` only.

### SEC25-X-02 — a missing service-role key degrades silently to the anon key · **LOW**

```ts
createClient(supabaseUrl, supabaseServiceKey || (process.env.VITE_SUPABASE_ANON_KEY || …).trim())
```

A missing or mistyped `SUPABASE_SERVICE_ROLE_KEY` does not fail the request. It **silently swaps the
identity the query runs as**, moving the endpoint's read authority from "the handler decided" to
"whatever RLS on `course_round_index` happens to be". The failure is invisible in both directions: if
RLS permits the read, the swap is undetectable; if it denies it, the handler reports
`503 not yet materialised`, pointing an operator at entirely the wrong cause.

On this endpoint the swap is **undetectable in practice**, which is what makes it worth recording
rather than filing as a style note: `supabase/schema.sql:21033` grants `course_round_index` to
`anon`, so a service key that has gone missing produces byte-identical responses. Nothing outside
notices, and nothing inside the handler notices either.

The same shape is in `_utils/audioAccess.createServiceSupabaseClient()` —
`supabaseServiceKey || supabaseAnonKeyFallback` — which is the client behind **both**
`audio/[audioId].ts` and `audio/batch-urls.ts`, the two endpoints that decide audio entitlement.
Same pattern, higher stakes, which is why it is pinned rather than left as a note.

The convention it diverges from has a quorum: `access/claim.ts`, `family/remove.ts`, `groups/tree.ts`
and 20-odd others return `500 Server misconfigured`.

**Suggested fix (not applied):** fail closed on a missing service key, matching the majority.

Tests: `api/courses/roundMap.security.test.ts` — 8 passing, 2 `todo`.

---

## 3a. Coordinator escalation — SEC25-X-03 · the `ssi_admin` door

Area A (#467) reported **SEC25-A-01** at *low (confirmation)*: the new shared limiter
`_utils/codeAttemptThrottle.ts` carries the 2026-08-18 Finding 5 shape into its own bucket key —
`getClientIp()` reads the leftmost `X-Forwarded-For` entry or `X-Real-IP`, both caller-written, with
no platform-attested fallback — so `REDEEM_PER_IP_LIMIT` (120 / 15 min) does not bind an attacker who
rotates the header. That reading of the mechanism is exactly right. **The severity is too low**, and
the reason is only visible from the coordinator's seat, because it needs three facts that sit in
three different areas:

1. **`redeem.ts` is the grant path for `platform_role = 'ssi_admin'`.** `redeem.ts:371-373` — a code
   of type `ssi_admin` (or the legacy `god`) sets full platform privilege on the redeemer. The branch
   is selected on `codeType` alone: no second condition, no out-of-band step, nothing a privileged
   type must satisfy that a student type need not.
2. **Privileged codes share the small keyspace.** Every invite code, `ssi_admin` included, comes from
   the one `generateCode()` in ABC-123 format: 24³ × 10³ = **13,824,000**. `codeGen.ts` contains a
   128-bit minter — `generateShareCode()`, `randomBytes(16)` — used for board share links. **The
   weakest keyspace guards the strongest grant, in the same file as the strong one.**
3. **The bearer token is not a cost.** Sign-up is open self-service OTP, so obtaining a token to call
   the endpoint with is free and unlimited.

So the only control bounding blind guessing against the highest-privilege grant in the system is a
limiter whose bucket the attacker chooses.

**This is an escalation, not a disclosure, and the report should be read that way.** The bucket-key
weakness is 2026-08-18's Finding 5. The unmetered-redemption concern is 2026-08-11's **AUTH-CORE-01**,
already rated *high* ("costs an attacker patience"). What is new is that they are the **same door**,
that the door reaches `ssi_admin`, and that the limiter added since — the one thing that looked like a
fix — does not close it. Strongest corroboration available: `redeem.ts:167-172` says so itself.

> …sign-up is open self-service OTP, so an unthrottled redeem is a sweepable oracle over the ~13.8M
> ABC-123 keyspace — and a hit here does not merely report the code, it REDEEMS it (`platform_role`,
> `educational_role`, a `govt_admins` row).

**Honest limit on the claim:** exploitation additionally requires an *active* `ssi_admin`-type code to
exist at the moment of the sweep. **This audit made no live check for one** — that would be a
production read against the invite table, which these rules forbid. A sweep with no privileged code
live still lands on whatever teacher / school_admin / govt_admin codes are active, which is the
already-filed AUTH-CORE-01. See §4.

**Suggested fixes (not applied), cheapest first:** mint privileged code types from `generateShareCode()`
rather than `generateCode()` — the function already exists, and nobody types an `ssi_admin` code off a
whiteboard; and key the limiter on `x-vercel-forwarded-for` / `req.socket.remoteAddress` rather than on
caller-written headers.

Tests: `api/code/redeemPrivilegeReach.security.test.ts` — 8 passing, 1 `todo`.

---

## 4. Gaps (explicit)

Reported as gaps rather than papered over:

- **`ENTITLEMENT_ENFORCE` is STILL unsettled**, three audits running. It decides whether INPUT-01
  (audio entitlement fail-open) is live. Progress since 2026-08-22: the Vercel CLI **is now installed**
  (`vercel 59.5.0`; it was absent then). But this session is **logged out**, and no interactive login
  was attempted — crossing an auth boundary is outside these rules. **One command settles it:**
  `vercel env ls production | grep ENTITLEMENT_ENFORCE`.
- **No live database read, and no live HTTP probe.** Every schema claim rests on `supabase/schema.sql`,
  the committed dump — which CLAUDE.md itself records as having been stale before. The DEFINER,
  grant and RLS findings (D-01/02/03) are all subject to that caveat.
- **SEC25-X-03 additionally requires an active `ssi_admin`-type invite code to exist.** No live check
  was made for one; that is a production read of the invite table.
- **The XFF-spoof exploitability is a property of the Vercel edge, not of the code**, and was not
  tested live — the same caveat the 2026-08-18 audit attached to its own Finding 5.
- **The dashboard/Popty repo was not audited**, so SEC25-D-03's real blast radius is unknown from here.
- **No test was written for D-03, D-04, D-05 or D-06** — a `.gitignore` change is a fix rather than a
  finding, and the dependency advisories could not have their call sites assessed within scope.
- **The 2026-08-11 audit's `client-config` findings 02, 03 and 08 were carried forward unchanged**,
  not independently re-derived — nothing in the new diff touched them.
- **The 19→33-endpoint `verifyAdmin` re-sweep was not run.** `api/admin/` has grown and some of the
  growth uses a different-but-consistent pattern (`resolveVadCaller`). Flagged by #468, unclaimed.

---

## 5. Production contact

**One request, read-only, unauthenticated:** `npx vercel whoami`, which returned "Logged out". It
confirms the CLI's auth state and touches no project data. Nothing else. No database query, no HTTP
request to production, no write, no mint, no email, no OTP, no spend.

---

## 6. Files

| File | Contents |
|---|---|
| `README.md` (this file) | Synthesis, coordinator findings, gaps |
| `handler-map.md` | The 109-handler map and the verdict on each unauthenticated one |
| `area-a-api-delta.md` | New endpoints since 2026-08-22 |
| `area-b-client.md` | Client surface — XSS, secrets, service worker, headers |
| `area-c-reconciliation.md` | Live-status verdict on every 2026-08-11 finding |
| `area-d-db-and-hygiene.md` | Schema posture, repo hygiene, test-machinery integrity |

**Test convention** (inherited from 2026-08-11 and 2026-08-22, unchanged): a control that holds is
locked with an ordinary passing test. A real vulnerability is recorded as a **characterization** test
that asserts today's insecure behaviour and therefore **passes today**, carrying a
`// SECURITY FINDING <ID>:` comment and a paired `it.todo()` naming the secure behaviour. When
someone fixes the finding the characterization goes **red on purpose** — that is the signal the
finding is closed, and the fixer flips it to the assertion the `it.todo()` names.


## 7. The one thing that needs a human decision

Everything above is a finding or a test. This is not:

**These findings are on a branch, exactly like the 2026-08-11 ones.** §0 measured what that costs —
29 of 33 tripwire tests stranded, the branch now 330 commits behind and conflicting. This audit's
output will decay the same way unless it is merged to `dev`, and merging was outside this run's
brief, which scoped the deliverable to a branch.

The recommendation, stated as a recommendation because the call is yours: **merge
`security/audit-2026-08-25` into `dev`.** It is findings and tests only — no production behaviour
changes — the full `api` suite is green at 1,411 passing with 0 typecheck errors, and merging is what
turns 44 characterization tests into CI-gated tripwires that go red the moment someone fixes or
regresses one of these findings. Leaving it unmerged reproduces, knowingly, the exact failure this
audit was written to document.

---
