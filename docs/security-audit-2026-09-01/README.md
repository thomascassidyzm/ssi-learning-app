# Security & vulnerability audit — 2026-09-01

Branch `security/audit-2026-09-01`, cut from `dev` at `8755d4c8`, in an isolated worktree so the shared
checkout was never disturbed.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix was
applied, nothing was promoted, no money moved, no email or OTP was sent, no TTS was generated, nothing was
deleted, no live-DB write was made. The only production contact was two read-only calls: `gh run list`
against the GitHub Actions API, to re-verify the enforcement finding below.

---

## 0. Why a seventh audit, and what chose its partition

This is the **seventh** security audit of this repo in three weeks.

| Audit | Where it lives | State |
|---|---|---|
| 2026-08-11 | 6 area reports, ~1,100 tests | branch `sec/audit-2026-08-11`, still unmerged |
| 2026-08-18 | `docs/security/api-audit-2026-08-18.md`, 5 specs | on `dev`; **run by nothing** |
| 2026-08-22 | `docs/security-audit-2026-08-22/` | merged |
| 2026-08-25 | `docs/security-audit-2026-08-25/` | merged |
| 2026-08-25 **remediation** | `security/remediation-2026-08-25` | **now merged to `dev`** — the change that makes this audit worth running |
| 2026-08-29 | `docs/security-audit-2026-08-29/` | merged |
| 2026-09-01 | this | branch |

The 2026-08-29 audit found the API surface completely unchanged since 08-25 and had to invent a partition.
**That is no longer true.** Between its base `6c2b867a` and today's `dev`:

```
88 files changed, +4,484 / −1,189   under api/ + supabase/ + vercel.json
```

That delta is the whole subject of this audit, and it splits cleanly into three kinds, which became
three of the four areas:

- **the remediation actually landed** — `postgrestFilter.ts`, `cronAuth.ts`, a rewritten
  `codeAttemptThrottle.ts`, two applied migrations, and rewrites of `invites.ts`, `code/validate.ts`,
  `code/redeem.ts`, `possession-redeem.ts`. Six audits filed findings; this is the first window in which
  a large number of them plausibly closed. Verifying that is worth more than finding new ones → **Area A**.
- **brand-new endpoints nobody has ever audited** — `api/me/standing.ts` (284 lines),
  `api/admin/test-doors.ts`, `_utils/schoolSeats.ts`, `_utils/glossSegments.ts`, and a changed
  onboarding funnel → **Area B**.
- **heavily-rewritten tenant-data endpoints whose prior verdicts are now stale** — roster, rate-compare,
  class-progress, create-class-learner, create-class-join-code, by-code, player-events, the groups
  reads → **Area C**.

The fourth area is the one subject no prior audit has taken on its own terms: **the content-delivery
cache and entitlement path**, which has just acquired edge caching → **Area D**.

Deliberately **not** re-run, because five audits already swept them and a sixth copy is worth nothing:
PostgREST injection as a discovery exercise, the privileged-gate roster, webhook signature verification,
join-code entropy, the client XSS sinks, the DEFINER/search_path posture. Where an area rediscovered one
of those, it says so in one line and cites the original ID.

---

## 1. Coordinator findings (Area X)

Tests: `api/_security/sec0901-x-audit-machinery.security.test.ts` — 10 passing.

### SEC0901-X-01 — the enforcement finding is unchanged, and has got worse by exactly the elapsed time · **HIGH (enforcement)** · live-verified

Re-read from the GitHub Actions API on 2026-09-01. The last run of any workflow on this repository is
still **2026-08-14T18:31Z**; the last *green* run is still 2026-08-11. Every run since is a `failure`
carrying the billing annotation, not a test failure. Both workflows remain `active` and are simply never
started.

|  | commits with no gate executed |
|---|---|
| `dev` | **433** (was 225 on 08-29) |
| `main` (production) | **247** (was 198) |

So `pnpm test:api` — the gate on which every one of these seven audits' tripwires depends, and which now
carries **24 security-test files** — has not run in CI for **18 days**. Nor has `lint`, `typecheck`,
`typecheck:api`, or the player-vue suite. `auto-merge-claude.yml` is dead by the same cause.

Run by hand on today's `dev` the API suite is **green: 133 files, 1,493 passing, 5 skipped, 8 todo**.
The failure mode is conservative — nothing merges automatically — so the risk is drift and blindness,
not an unreviewed auto-merge.

**Not fixed here, and not fixable here.** Restoring CI is a billing action on Tom's GitHub account:
outward-facing, and squarely outside this run's rules. **The one thing that needs a human: GitHub →
Billing & plans.** This is the third consecutive audit to say so.

### SEC0901-X-02 — the two orphaned specs now guard *closed* findings · **MEDIUM**, and a correction to 08-29

The 2026-08-29 audit reported all five specs in `vitest.security-audit.config.ts` **failing**, i.e. the
2026-08-18 findings 3, 4 and 5 still live eleven days on. **Run today, all five pass.** The remediation
closed them: `api/_utils/postgrestFilter.ts` provides `quoteFilterValue`/`safeIdToken` and
`api/school/class-progress.ts` now uses it; `codeAttemptThrottle.getClientIp` now keys on
`x-vercel-forwarded-for` (which the Vercel edge *overwrites*) and consults client-settable
`x-forwarded-for` / `x-real-ip` not at all.

That changes what those two files are. They have turned from *open findings* into *regression guards for
fixes somebody already paid for* — and they are collected by no gated config, so nothing would notice
them going red again. That the `*.security-audit.ts` glob rides no CI gate is **already filed and already
pinned** by `api/_utils/securityTestMachineryIntegrity.security.test.ts`; this audit does not re-file it.
What it adds is the reason it now matters more: renaming those two files to `*.security.test.ts` is a
two-line change that puts three closed findings under permanent guard.

### SEC0901-X-03 — SEC29-X-02 is closed: the schema dump no longer lies · **CLOSED**

The 08-29 audit found `supabase/schema.sql` still recording `GRANT ALL ON FUNCTION
admin_practice_minutes(...) TO anon` for a grant production had not had since 08-25, because the
remediation was stranded on an unmerged branch. That branch has merged. The dump now records
`REVOKE ALL … FROM PUBLIC` + `GRANT ALL … TO service_role`, and the no-argument platform-wide path of
`admin_practice_minutes_by_course` carries an in-body `is_ssi_admin()` gate. Pinned by
SEC0901-X-02's assertions so a regenerated dump that reintroduces the grant fails the suite.

### SEC0901-X-04 — the SEC25-D-02 residual is still open, on day 7 · **MEDIUM**

Recorded deliberately by the 08-25 remediation rather than papered over, and quoted here because a
residual that nobody re-states becomes a residual that nobody closes:

> a signed-in user can still call the `_by_course` variant with a learner UUID they already know.

`admin_practice_minutes_by_course(uuid[])` is `SECURITY DEFINER`, retains `EXECUTE` for `authenticated`
(needed by four browser callers), and gates **only** the `NULL` argument. Supply an array and nothing
checks that the caller may see those learners — the read bypasses RLS and returns their per-course
practice minutes. It needs a known learner UUID and a login, which is why it was accepted; it is not
closed. The recorded fix is repointing `useAdminUserDetail`, `useAnalyticsData` and `StudentProgressView`
at a server endpoint on the `resolveVisibleScope` pattern — CLAUDE.md's own condition (2) for the RLS
tightening pass. Pinned as a characterization; it goes red when someone closes it.

### Method note — a false-positive class worth naming

An automated coverage census of the 50 changed handlers initially reported 17 as untested. Nine of those
were an artefact of shell globbing: `api/groups/[id]/invites*` reads `[id]` as a character class, so real
neighbouring test files were invisible to the check. Re-run properly, **exactly one** changed file has no
test coverage of any kind: `api/_utils/glossSegments.ts` (new, 57 lines — Area B's subject). Coverage of
the delta is otherwise good. Stated because a security report is only as good as its false-positive
discipline, and this one nearly shipped nine.

---
