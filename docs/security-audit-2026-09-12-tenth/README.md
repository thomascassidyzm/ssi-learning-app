# Security & vulnerability audit — the tenth (2026-09-12)

The **tenth** security audit of this repo, and the second to run on 2026-09-12 — the ninth
(`docs/security-audit-2026-09-12/`) landed the same day and covered org tenancy and the support
channel. This one is separate work on a separate surface; the two do not overlap.

Coordinator branch `cs/441-reset-eve-security-tests`, cut from `origin/dev` at `e558b43ee`. Five
areas: four dispatched as parallel workers, one run by the coordinator.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix
was applied, nothing was promoted, no money moved, no email or OTP was sent, no TTS was generated,
nothing was deleted.

**Outward contact: NONE.** No live database was read or probed, no external service was called, no
dependency audit was run. That is the honest gap and it bounds every finding: each is derived from
repo source — handlers, `api/_utils/**`, `supabase/migrations/**`, `supabase/schema.sql`,
`packages/player-vue/src/**` — not from live state.

---

## 0. What chose the scope: the coverage census

Nine audits have swept this repo, and each picked its scope by what had *changed*. This one picked
by what had never been *looked at*. Every handler under `api/` was matched against every
`*.security.test.ts` and `*.security-audit.ts` file in the repo:

```
152 API handlers (excluding tests, api/_utils, api/_security)
 68 of them named by NO existing security test  ← the scope of this audit
```

Those 68 were partitioned into five areas with no overlap and no remainder. The only uncovered file
left unassigned is `api/support/_testkit.ts`, which is test scaffolding rather than a route.

| Area | Theme | Handlers | Write-up | Tests |
|---|---|---|---|---|
| **C** | The admin intel surface, the org lens, funder export | 13 | `area-c-intel-surface.md` | `api/_security/sec0912t-c-intel-surface.security.test.ts` |
| **D** | Family accounts, try-links, invites — minting an identity for another person | 12 | `area-d-family-and-links.md` | `api/_security/sec0912t-d-family-and-links.security.test.ts` |
| **E** | Paid course content delivery, audio, edge caching | 8 | `area-e-content-delivery.md` | `api/_security/sec0912t-e-content-delivery.security.test.ts` |
| **F** | The unaudited school / teacher / group read and write surfaces | 19 | `area-f-school-teacher.md` | `api/_security/sec0912t-f-school-teacher.security.test.ts` |
| **G** | Identity transfer, account deletion, unauthenticated intake | 21 | `area-g-identity-transfer.md` | `api/_security/sec0912t-g-identity-transfer.security.test.ts` |
| **X** | Coordinator: one finding Area C handed over | — | this file, §1 | `api/_security/sec0912t-x-org-enrolment-path.security.test.ts` |

---

## 1. Findings

Each area's write-up carries its own findings in full — where, why, blast radius, fix shape, and
what it checked and cleared. The consolidated index lives here.

### Headline

Two HIGH findings and one that sits just under them, all three about **privilege a caller can hand
themselves**:

**SEC0912T-F-01 (HIGH) — the `teachers` table is granted to `authenticated` with no column list.**
The anon key ships in the bundle, so a tutor can `PATCH` their own row and set
`platform_status='active'`, `verified=true` and `payout_recipient_id` directly. The paid tutor
dashboard is self-grantable without a Paddle event ever firing, and the payout cron pays
`payout_recipient_id` with no verified flag. Third recurrence of the column-blind-grant class in this
repo.

**SEC0912T-F-02 (HIGH) — a tutor's bank details change on a bare session.** `POST
/api/teacher/payout-recipient` repoints where commission is paid with no step-up, no audit row, no
notice to the owner, no cooling-off and no `rejectIfViewAs` — and a school admin can mint a live
session as a colleague who also tutors freelance.

**SEC0912T-G-01 (HIGH) — orphaned-identity absorption.** `public.relink_user_tags()` (a
`SECURITY DEFINER` RPC the browser calls directly) and `POST /api/auth/cascade-user-id` both transfer
another person's tenancy memberships to the caller on proof of nothing but knowing their auth uid.
`POST /api/account/delete` manufactures exactly the orphan they gate on — `user_tags` and
`govt_admins` are keyed on the auth uid and carry no foreign key, so a learner deletion leaves them
standing. A peer already reads that uid out of `user_tags` under `my_readable_tag_values()`. And the
transfer is unbounded by tag, so memberships at schools the caller has never touched move with the
rest. The caller ends up holding `role_in_context = 'admin'` rows that the RLS policies explicitly
forbid anyone granting themselves — because a definer function runs past the policy that states the
rule.

One finding is the **tenth audit's own handover**: Area C found it, declined to assert it outside its
surface, and the coordinator picked it up.

**SEC0912T-X-01 (MEDIUM) — the money path still decides "same org" on a name-derived slug.**
`api/org/enrol.ts` enforces one-person-one-cohort with `rootOfPath(groups.path)`. That is the exact
predicate the ninth audit found in SQL and job #300 repaired the same day — and the repaired function
now carries the ruling in its own database COMMENT: *"groups.path is a name-derived slug and is never
unique, so it must not decide a row policy."* Two unrelated orgs that slug the same are one org to
enrolment; the learner is told `alreadyEnrolled` and the second org's free year is never written.

### Index

19 findings: 3 HIGH, 9 MEDIUM, 7 LOW. Each is carried in full by its area write-up.

| ID | Severity | One line | Area |
|---|---|---|---|
| SEC0912T-F-01 | **HIGH** | `GRANT ALL ON public.teachers TO authenticated` is column-blind — a tutor self-grants `platform_status`, `verified` and `payout_recipient_id` | F |
| SEC0912T-F-02 | **HIGH** | Payout destination changes on a bare session: no step-up, no audit, no notice, no cooling-off | F |
| SEC0912T-G-01 | **HIGH** | Orphaned-identity absorption: a departed colleague's memberships are claimable by anyone who knows their auth uid | G |
| SEC0912T-C-01 | MEDIUM | The funder export has no small-cell floor — a 1-person `aged16to24` cell attaches an age band to a named person | C |
| SEC0912T-D-01 | MEDIUM | `family/create-child` is an unbounded, plan-gate-free identity mint — create/remove/create loops forever | D |
| SEC0912T-D-02 | MEDIUM | `family/invite` emails any address on any signed-in caller's say-so, with a caller-controlled subject line | D |
| SEC0912T-D-03 | MEDIUM | The same handler is an account-existence oracle and attaches a real account to a stranger's family without consent | D |
| SEC0912T-D-06 | MEDIUM | `school_admin` codes are never bounded — the `isPrivileged` clause tests a code type the validator rejects, so it is dead | D |
| SEC0912T-E-01 | MEDIUM | Full-course reads happen before the entitlement decision, anonymously, un-cacheable and unthrottled — an availability lever on the shared DB | E |
| SEC0912T-F-03 | MEDIUM | `demo-mint` is unbounded and accepts a live parent — any learner floods real org trees with groups, schools and open invites | F |
| SEC0912T-G-02 | MEDIUM | Neither identity-transfer door writes a `role_change_audit` row | G |
| SEC0912T-X-01 | MEDIUM | The money path still decides "same org" on a name-derived slug, against the database's own ruling | X (coordinator) |
| SEC0912T-D-04 | LOW | The parent sign-in minter has no volume bound and writes no audit row | D |
| SEC0912T-D-05 | LOW | A try-link's entitlement token names no link, so deactivation cannot revoke it for up to 30 days | D |
| SEC0912T-E-02 | LOW | `bundle.ts`'s 503 body hands an anonymous caller the operator remedy | E |
| SEC0912T-E-03 | LOW | `sectors.ts` is publicly edge-cached — safe only because it is ungated today | E |
| SEC0912T-F-04 | LOW | `identity-claims`: correct scope, stale contract, skipped tenant rule | F |
| SEC0912T-F-05 | LOW | Raw error text in 500 bodies (recurrence of a known class) | F |
| SEC0912T-G-03 | LOW | `bug_reports.screenshot_url` stored from an unauthenticated caller with no scheme allowlist | G |

---

## 2. How to read the tests

All six test files are `*.security.test.ts`, so they ride `pnpm test:api` — the check the nightly
on watson-1 runs against `dev`, `staging` and `main`. They are **green and characterizing**: each one
asserts the vulnerable shape *as it stands today*, so it goes **red the moment somebody fixes it**.
That is deliberate — a permanently-red suite stops being a gate, and the repo learned that once
already (`vitest.security-audit.config.ts` exists for the red kind, and nothing automatic collects
it).

Every file is pure: no database, no network, no child process. All six are pinned in
`api/_utils/securityTestMachineryIntegrity.security.test.ts`, so deleting one is loud.

```bash
npx vitest run -c vitest.api.config.ts api/_security/sec0912t-*.security.test.ts
```

---

## 3. The honest gap

- **Nothing was verified against live state.** Every finding says what the code permits, not what
  has happened. Where a finding's precondition is a question about live data, the write-up says so
  and names the query that would settle it.
- **No dependency audit.** `pnpm audit` reaches the network and was not run.
- **Client-side sinks outside this repo are outside the audit.** One finding (G-03) has its sink in
  a triage surface that does not live here.
- **`supabase/schema.sql` is a dump, not the live catalogue.** F-01 and the grant-shaped findings
  read it as the best available record; re-verifying a live GRANT needs live access this audit did
  not have, and each affected write-up says so.
- **Two findings are latent rather than live** — E-03 is safe only while `sectors.ts` stays ungated,
  and D-02 is a no-op without `RESEND_API_KEY` in production, which was not checked.

## 4. What a fix pass would do first

Not applied, and deliberately not ordered by severity alone — by cost to repair against consequence:

1. **F-01** — a column-scoped GRANT plus `NOTIFY pgrst`. One migration, canary-run per the RLS
   runbook. It also removes half of F-02's reach.
2. **D-06** — one token: add `'school_admin'` to the `isPrivileged` set so those codes get an expiry
   and a use cap. A leaked unbounded school-admin code is a live SSI-GOD-2026 shape.
3. **G-01** — clear `user_tags` and `govt_admins` in `account/delete.ts`. The cheapest of the three
   repair shapes, and it is the one that breaks the chain at the source.
4. **F-02** — step-up plus an audit row and a notice on a payout-destination change.
5. **E-01** — move the entitlement gate ahead of the reads on `bundle.ts` and `infplay-cycles.ts`;
   `cycles.ts` is the sibling that already does it right.
