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

---

## 1. Findings

Each area's write-up carries its own findings in full — where, why, blast radius, fix shape, and
what it checked and cleared. The consolidated index lives here.

### Headline

**SEC0912T-G-01 (HIGH) — orphaned-identity absorption.** `public.relink_user_tags()` (a
`SECURITY DEFINER` RPC the browser calls directly) and `POST /api/auth/cascade-user-id` both
transfer another person's tenancy memberships to the caller on proof of nothing but knowing their
auth uid. `POST /api/account/delete` manufactures exactly the orphan they gate on — `user_tags` and
`govt_admins` are keyed on the auth uid and carry no foreign key, so a learner deletion leaves them
standing. A peer already reads that uid out of `user_tags` under `my_readable_tag_values()`. And the
transfer is unbounded by tag, so memberships at schools the caller has never touched move with the
rest. The caller ends up holding `role_in_context = 'admin'` rows that the RLS policies explicitly
forbid anyone granting themselves — because a definer function runs past the policy that states the
rule. Full chain and three alternative fix shapes: `area-g-identity-transfer.md`.

### Index

*(Each row links to the area write-up that carries it. Populated as each area landed.)*

| ID | Severity | One line | Area |
|---|---|---|---|
| SEC0912T-G-01 | HIGH | Orphaned-identity absorption: a departed colleague's memberships are claimable by anyone who knows their auth uid | G |
| SEC0912T-G-02 | MEDIUM | Neither identity-transfer door writes a `role_change_audit` row | G |
| SEC0912T-G-03 | LOW | `bug_reports.screenshot_url` stored from an unauthenticated caller with no scheme allowlist | G |

---

## 2. How to read the tests

All five test files are `*.security.test.ts`, so they ride `pnpm test:api` — the check the nightly
on watson-1 runs against `dev`, `staging` and `main`. They are **green and characterizing**: each one
asserts the vulnerable shape *as it stands today*, so it goes **red the moment somebody fixes it**.
That is deliberate — a permanently-red suite stops being a gate, and the repo learned that once
already (`vitest.security-audit.config.ts` exists for the red kind, and nothing automatic collects
it).

Every file is pure: no database, no network, no child process. All five are pinned in
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
