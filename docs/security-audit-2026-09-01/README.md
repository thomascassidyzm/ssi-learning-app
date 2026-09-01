# Security & vulnerability audit — 2026-09-01

Branch `security/audit-2026-09-01`, cut from `dev` at `8755d4c8`, in an isolated worktree so the shared
checkout was never disturbed.

**Rules this audit ran under:** findings and tests only. No production behaviour was changed, no fix was
applied, nothing was promoted, no money moved, no email or OTP was sent, no TTS was generated, nothing was
deleted, no live-DB write was made. The only production contact was read-only: `gh run list`
against the GitHub Actions API, and reading `command-surface/ops/ci-run.sh` and `ops/ci/ci-checks.sh`
to compare the nightly gate's coverage against the workflows it replaced (SEC0901-X-01).

---

## 0. Why a seventh audit, and what chose its partition

This is the **seventh** security audit of this repo in three weeks.

| Audit | Where it lives | State |
|---|---|---|
| 2026-08-11 | 6 area reports, ~1,100 tests | branch `sec/audit-2026-08-11`, still unmerged |
| 2026-08-18 | `docs/security/api-audit-2026-08-18.md`, 5 specs | on `dev`; collected by no gated config (SEC0901-X-02) |
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

### SEC0901-X-01 — the nightly gate covers 8 of verify.yml's 9 checks; `@ssi/core`'s tests are the one it drops · **MEDIUM (coverage)** · verified

**Correction to the premise, ruled by Tom on 2026-08-31 and applied here.** GitHub Actions being dormant
is **deliberate estate-wide policy, not a defect**. The 2026-08-29 audit filed it as a HIGH finding and
this audit initially repeated that; both were wrong, and the finding is withdrawn rather than restated.
The real gate is the nightly run on watson-1 (`command-surface/ops/ci-run.sh`, Tom's ruling 2026-08-29),
and it demonstrably works: last night's run covered `dashboard@main` red and `learning-app@dev/staging/main`
green, with the red chased and resolved by 02:11Z. That is a safety net functioning, not a gap.

So the question worth asking is the narrower one: **does the replacement cover what the workflows covered?**
Answered check-by-check against `.github/workflows/verify.yml` and `auto-merge-claude.yml`, whose gate sets
are identical to each other (9 steps each, verified line by line):

| verify.yml step | `ops/ci/ci-checks.sh` | |
|---|---|---|
| `pnpm install --frozen-lockfile` | `install` | ✅ |
| `pnpm --filter @ssi/core build` | `core-build` | ✅ |
| `pnpm --filter player-vue lint` | `player-lint` | ✅ |
| `pnpm --filter player-vue typecheck` | `player-typecheck` | ✅ |
| `pnpm typecheck:api` | `api-typecheck` | ✅ |
| **`pnpm --filter @ssi/core test`** | **— absent —** | ❌ |
| `pnpm --filter player-vue test` | `player-test` | ✅ |
| `pnpm test:api` | `api-test` | ✅ |
| `pnpm test:release-train` | `release-train-test` | ✅ |

**One check is missing, and it is the one verify.yml carries a comment explaining:**

> *Core tests — the shared-selector parity guard lives in `@ssi/core` (`selectionParity.test.ts`);
> without this step it would never run in CI, where the drift it guards would land.*

That is a guard someone added deliberately, with a written reason, because nothing else would catch the
drift. It is now the single check that no gate runs. `packages/core` holds **35 test files / 751 tests**,
including `selectionParity.test.ts`, `pricing/access.test.ts` and `pricing/trial.test.ts` — entitlement and
trial logic, which is the closest thing in that package to a security surface.

**Two candidate excuses, both checked and both false.** It is not red: run on today's `dev` it is
**35 files, 751 passing, 9 skipped, green in 4.5s**. And it does not hang the runner — `@ssi/core`'s script
is bare `"test": "vitest"`, which would be watch mode on a TTY, but run non-TTY under cron with `CI` unset
it exits 0 cleanly (measured, not assumed). So the omission looks like an oversight when the check list was
transcribed, not a decision. **The fix is one line in `ops/ci/ci-checks.sh`**, alongside `player-test`:
`run core-test "$PNPM8" --filter @ssi/core test -- --maxWorkers=2`. Not applied here — `ci-run.sh` is the
estate's live gate and lives in another repo; this audit writes findings, not fixes.

**A structural difference, stated descriptively rather than as a defect**, because it follows from the
ruling rather than contradicting it: Actions gated *before* code landed (per-push on dev/staging/main, on
every PR, and pre-merge on `claude/**` via `auto-merge-claude.yml`), whereas the nightly detects *after*
it has landed, once a day, skipping any SHA unchanged since its last green. Nothing now checks a branch
before it merges. That is a deliberate trade — detection in place of prevention, with a loud red notice as
the compensating control — and last night showed the loud half working. It is worth knowing rather than
worth fixing. The nightly is also *more* thorough in one respect: Actions skipped docs-only commits via
`paths-ignore`; the nightly runs the full suite on whatever SHA it finds.

**Where this leaves the tripwire convention.** Every one of these seven audits wrote its findings as tests
on the assumption that something runs them. Something does: `api-test` is on the nightly, so the 24
`*.security.test.ts` files are gated nightly on dev, staging and main. The convention is sound. The two
gaps in it are the `@ssi/core` step above and SEC0901-X-02 below.

### SEC0901-X-02 — the two orphaned specs now guard *closed* findings · **MEDIUM**, and a correction to 08-29

The 2026-08-29 audit reported all five specs in `vitest.security-audit.config.ts` **failing**, i.e. the
2026-08-18 findings 3, 4 and 5 still live eleven days on. **Run today, all five pass.** The remediation
closed them: `api/_utils/postgrestFilter.ts` provides `quoteFilterValue`/`safeIdToken` and
`api/school/class-progress.ts` now uses it; `codeAttemptThrottle.getClientIp` now keys on
`x-vercel-forwarded-for` (which the Vercel edge *overwrites*) and consults client-settable
`x-forwarded-for` / `x-real-ip` not at all.

That changes what those two files are. They have turned from *open findings* into *regression guards for
fixes somebody already paid for* — and they are collected by no gated config, so nothing would notice
them going red again. That the `*.security-audit.ts` glob rides no gate is **already filed and already
pinned** by `api/_utils/securityTestMachineryIntegrity.security.test.ts`; this audit does not re-file it.
It is worth restating only that the change of gate did not change this: the watson-1 nightly runs
`pnpm test:api`, which cannot collect them, and does not run `pnpm test:security-audit` at all — so these
two files are as ungated under the new arrangement as they were under the old one.
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

---

## 2. Coordinator verification of SEC0901-A-01 — independently confirmed, and the framing sharpened

Area A's headline is the only finding in this audit whose blast radius is irreversible, so the
coordinator re-derived it from the source rather than relaying it. **It is real, and the chain holds at
every link.** Three facts the area report did not state, each of which makes it worse rather than better:

**1. There is no uniqueness constraint to collide against.** `public.groups` carries exactly two
constraints — `groups_pkey PRIMARY KEY (id)` and `groups_parent_id_fkey` — and `idx_groups_path` is a
plain non-unique btree. Two root groups may hold a byte-identical `path`. `compute_group_path()` is a
pure slugify of `name` with no dedupe.

**2. The one control that looks like it would stop this is a UX warning the caller can switch off.**
`api/onboarding/provision.ts:264` reads:

```ts
if (!existingGroupId && !confirm_duplicate) {
  const duplicates = await findSiblingSlugCollisions(supabase, org_name, null)
  if (duplicates.length > 0) { res.status(409).json(duplicateNameBody(...)); return }
}
```

So the precondition is not "find a way past a check" — it is **one extra field in the request body**,
`confirm_duplicate: true`, on an endpoint gated by nothing but `verifyAuthToken`. The comment above it says
the warning *"fails open — a warning is a nicety, a blocked signup is a lost customer"*, which is a
perfectly good product decision that happens to be load-bearing for this bug in a way nobody intended.

**3. Nothing downstream narrows the blast radius.** `_utils/demoSchoolTeardown.ts` contains **no
`is_demo` / `is_test` filter of any kind**. It passes the resolved id list straight to
`deleteInChunks(supabase, 'groups', 'id', groupIds)` and `supabase.auth.admin.deleteUser(uid)`. The demo
flags that would have made this survivable exist on `learners` and are used elsewhere in the codebase —
they are simply not consulted here.

**Where the coordinator would reframe it.** Area A presents this as an attack, and rates it HIGH rather
than CRITICAL because it needs an admin's unrelated routine action to fire. That reasoning is sound as
far as it goes, but it undersells the finding, because **the attacker is the least likely way this
happens.** A deliberate attacker gains almost nothing: the org destroyed is their own throwaway. The
realistic trigger is an *accident* — a genuine customer names their organisation something a demo org is
already called, clicks past a duplicate-name warning that exists to be clicked past, and is then hard-
deleted, auth accounts and all, by an admin doing correct routine maintenance months later. No attacker
is required, no one involved does anything wrong, and there is no audit trail that would explain it
afterwards. Read that way it is a **data-loss defect that will eventually fire on its own**, and that,
not the attack, is the argument for fixing it. The fix is unchanged and is the same one-line move already
applied at three sibling sites: walk `parent_id` via `groupSubtree.descendantIds`, never match
`groups.path`.

Not fixed here — findings and tests only.

---

## 3. The areas, in one table

Full detail in each area's own report. Severity is this audit's, after coordinator review; where the
coordinator disagreed with an area's own rating, the area's reasoning is preserved in its report and the
disagreement is stated rather than silently overridden.

| ID | What | Sev | State |
|---|---|---|---|
| **SEC0901-A-01** | `_utils/demoSchoolGraph.resolveGroupSubtreeIds` resolves an org subtree by `groups.path` slug, feeding an unfiltered hard-delete + auth-account deletion | **HIGH** | **STILL LIVE** — §2 above |
| SEC0901-A-04b | `_utils/mintRateLimit.ts` still hand-rolls the spoofable `x-forwarded-for` bucket key that `codeAttemptThrottle` was fixed for | MEDIUM | STILL LIVE (per-IP backstop only; per-user limit unspoofable) |
| SEC0901-X-01 | the watson-1 nightly drops `pnpm --filter @ssi/core test` — 35 files / 751 tests, incl. the parity guard and the pricing suites | MEDIUM | open, one-line fix, another repo |
| SEC0901-X-04 | SEC25-D-02 residual: a signed-in caller can read a known learner's per-course practice minutes | MEDIUM | open by prior decision, day 7 |
| SEC0901-X-02 | the two `*.security-audit.ts` specs now guard *closed* findings and are collected by no gate | MEDIUM | open, two-line fix |
| SEC0901-B-01 | `invite/create` validates `grants_class_id` only for `teacher`/`student` types | LOW | privileged-caller-only |
| SEC0901-C-01 | `player-events.event_type` is length-capped but not allowlisted | LOW | self-attributed rows only |
| SEC0901-C-03 | `groups/{table,tree,[id]/home}` leak raw `String(error)` on the 500 path | LOW | authenticated callers |
| SEC0901-B-02 | `schoolSeats` cap is read-then-decide with no lock | LOW | **unproven** — no concurrency harness was built |
| SEC0901-B-03 | `try-link/create` returns raw DB errors | INFO | admin-only |
| SEC29-X-04 | anon-key fallback instead of fail-closed | INFO | **5 → 3**; `round-map` and `audioAccess` now fail closed |

### What held — the half of an audit that is not bad news

Recorded because "nothing found" is a result, and because the next audit should not re-sweep these:

- **The TENANCY-01 class is genuinely closed at three of four sites.** `invites.ts`,
  `orgPlatform.countSubtreeMembers` and `school/rate-compare.ts` (all four call sites) now walk
  `parent_id` via `descendantIds`/`fetchSubtree`. Only `demoSchoolGraph` was missed.
- **`postgrestFilter.ts` adoption is a closed class, not a lucky one.** Every real `.or()`/`.filter()`
  call site in `api/` is either using the sanitiser or structurally safe (regex-anchored digits,
  UUID-validated, or bound params). Area A checked them individually.
- **`cronAuth.ts` is correct** — constant-time, fails closed on every deployed env — and is adopted at
  both real cron routes.
- **All five code-guessing throttles** (`code/validate`, `code/redeem`, `auth/possession-redeem`,
  `try-link/validate`, `teacher/by-code`) key on the platform-attested bucket.
- **No IDOR, no mass assignment, no unauthorised write on any rewritten tenant endpoint** (Area C, 14
  endpoints). Every request-supplied id is re-checked against the caller's server-resolved scope; the
  coordinator independently re-verified `school/roster.ts` and `player-events.ts`'s identity resolution,
  including the play-as-class attribution exception, which is authorised via `resolveVisibleScope` rather
  than asserted by the client.
- **`me/standing.ts`'s k-anonymity and eligibility gates apply uniformly** to both the count and the
  distribution, with no cross-cohort probing lever found.
- **`glossSegments.ts` survived a 200k-character pathological input** with no catastrophic backtracking,
  and is not currently an XSS sink.
- **`test-doors.ts`'s central claim is true**: 8 of the 14 doors were source-traced and none writes to the
  server or to progress.
- **No secrets in the delta.** A scan of all 4,484 added lines for live keys, AWS ids, JWTs and private
  keys came back clean.

### Gaps — what this audit did not cover, and why

- No live-DB probing and no timing measurement: verified by code inspection instead. SEC0901-B-02's seat
  race is therefore **unproven** — it needs a concurrency harness nobody built.
- Areas B and C left specific threads: the `grants_class_id` read-side through `code/validate.ts`, and
  6 of the 14 test doors that rested on doc evidence rather than independent source tracing.
- Client-side coverage is thin by construction — the api vitest project cannot reach most of it, and this
  audit did not run the player-vue suite except where an area added a test to it.
- Deliberately not re-swept, having been done to death by five prior audits: injection as a *discovery*
  exercise, the privileged-gate roster, webhook signatures, join-code entropy, the DEFINER posture.
