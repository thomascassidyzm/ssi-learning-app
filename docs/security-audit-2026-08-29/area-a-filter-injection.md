# Area A — PostgREST filter-string injection & predicate-construction sweep

2026-08-29. Sweep of every `.ts` under `api/` (excluding `*.test.ts`) for
template-literal / concatenated interpolation into a PostgREST filter-DSL
method (`.or()`, `.filter()`, `.match()`, `.like()`, `.ilike()`, `.in()`,
`.not()`, `.textSearch()`, `.rpc()` with a dynamic name, `.order()`/`.select()`
with dynamic columns). This angle has never been swept before across five
prior audits. Tests: `api/_security/sec29-a-filter-injection.security.test.ts`.

## Method

`.eq()`, `.neq()`, `.gt()`/`.lt()`/`.gte()`/`.lte()`, and `.in()` called with
an **array** are safe by construction — supabase-js sends the value as a
single bound operand (or a properly-encoded array), and a single value never
gets re-parsed for DSL delimiters (`,` `.` `(` `)`). The genuinely dangerous
surface is anywhere a **string built by the server** (via template literal or
`+`) is handed to `.or()`, `.filter()`, `.match()`, `.in()` (as a manually
built `(a,b,c)` list inside a string), or `.like()`/`.ilike()` — because the
receiving side re-parses that whole string as filter grammar, so a comma,
dot, paren, `%`, `_` or `"` in an interpolated value can restructure the
predicate.

## Census — every interpolation site found

| # | File:line | Method | Interpolated value | Origin | Classification | Verdict |
|---|---|---|---|---|---|---|
| 1 | `api/school/class-progress.ts:224` | `.or()` | `roundIndex` | request body `args[]`, cast `any[]`, no runtime type check | (a) attacker-controlled | **Live finding** — already filed 2026-08-18 Finding 4. See below. |
| 2 | `api/school/class-progress.ts:254` | `.or()` | `ratchetHighestTo.legoId` | request body `args[]`, same as above | (a) attacker-controlled | **Live finding** — same as #1. |
| 3 | `api/groups/[id]/invites.ts:132` | `.or()` | `path` (twice) | `groups.path`, DB-computed via `compute_group_path()` trigger | (c) server-derived, but from an attacker-**creatable** row (org name) | **Control holds against metacharacter injection** — `path`'s charset is `[a-z0-9]` + `-` + `/` only (see Finding SEC29-A-04 below on why). The row IS exploitable, but as a **slug-collision** (TENANCY-01, already filed critical, still live), not as a syntax injection. |
| 4 | `api/groups/[id]/invites.ts:140` | `.or()` | `groupIds.join(',')` (twice) | `groups.id` values from the query at line 129–132 (real UUIDs from the DB) | (c) server-derived | Control holds. |
| 5 | `api/groups/[id]/invites.ts:412` | `.or()` | `groupId`, `ownSchoolId` | `groupId` = `req.query.id` (path param); `ownSchoolId` server-resolved | groupId is (a) attacker-controlled **only when the caller is admin** — see below | **New, low-severity finding SEC29-A-05.** |
| 6 | `api/school/rate-compare.ts:119,230` (`subtreeClassIdsForGroupPath`, called from lines 180, 209, 267, 282) | `.like()` | `path` | `groups.path` | (b) semi-controlled — attacker-creatable via org name collision | **New finding SEC29-A-06 (medium)** — see below. |
| 7 | `api/_utils/orgPlatform.ts:142` (`countSubtreeMembers`) | `.like()` | `path` | `groups.path` | (b) semi-controlled | **New finding SEC29-A-02 (medium)** — characterized, see test file. |
| 8 | `api/_utils/demoSchoolGraph.ts:30` (`resolveGroupSubtreeIds`) | in-memory `.filter()` (JS array, not PostgREST) | `path` | `groups.path` | (b) semi-controlled | **New finding SEC29-A-03 (low/medium, admin-only blast radius)** — characterized, see test file. |
| 9 | `api/admin/users.ts:299` | `.ilike()` | `search` | query string | (a) attacker-controlled, but caller is already ssi_admin (full read access) and `.ilike()` takes a single plain value (no DSL re-parse of `%`/`_` beyond ordinary LIKE wildcards) | Control holds. |
| 10 | `api/groups/[id]/rate-compare.ts` (post `c2f04665`) | — | `descendantIds()` (parent_id walk) | — | n/a | Control holds — this file was fixed by the 2026-08-06 pass; **not** vulnerable. Included for contrast with #6. |
| 11 | `api/_utils/schoolScope.ts` `schoolsForGroupSubtree`, `isStrictDescendantGroup`; `api/_utils/groupRollups.ts` `computeNodeExtras` | — | — | — | n/a | Control holds — fixed by `c2f04665`, walk `parent_id` via `descendantIds`. |
| 12 | `api/groups/[id]/home.ts:515,574,581`, `api/_utils/demoSchoolRefresh.ts:119`, `api/_utils/demoNodeRefresh.ts:202`, `api/_utils/groupRollups.ts:148,161,187,205`, `api/_utils/groupLeaderTag.ts:137`, `api/_utils/orgPlatform.ts:153`, `api/_utils/vadVisibility.ts:228` | `.in('tag_value', batch.map(id => \`GROUP:${id}\`))` etc. | `id` | DB-sourced UUIDs from an already-scoped prior query, passed as an **array** | (c) server-derived, array-encoded | Control holds — `.in()` with an array is safely encoded per-element; the ids themselves are real UUIDs from the DB, not attacker text. |
| 13 | `api/code/redeem.ts:48` | `.rpc(rpcName, …)` | `rpcName` | closed TypeScript union (`'claim_invite_code_use' \| 'claim_entitlement_code_use'`) | (c) server-derived, compile-time-closed | Control holds. |
| 14 | All other `.rpc()` call sites (11 total) | `.rpc('literal_name', {...})` | n/a — literal names | — | n/a | Control holds — no dynamic RPC names anywhere in `api/`. |
| — | `.order(...)`, `.select(...)` across `api/` | — | — | — | n/a | **Zero** dynamic column names found. All `.order()` calls use string literals; all dynamic `.select(...)` sites (`GROUP_COLUMNS`, `CLASS_SELECT`, `BUNDLE_PHRASE_COLUMNS`, etc.) are server-defined `const` column lists, never built from request input. |

Sites 12–14 and the `.order`/`.select` line are the "census for completeness"
rows the brief asked for — checked, all clean, no write-up needed beyond the
table.

## Findings

### SEC29-A-01 — class-progress.ts ratchet-filter injection (already filed, still live + new evidence)
**Severity: high (already rated so on 2026-08-18). Not re-filed as new — confirmed still live, plus one new piece of evidence.**

`api/school/class-progress.ts` `setLivePosition`/`setMode` build
`.or(\`last_completed_round_index.is.null,last_completed_round_index.lte.${roundIndex}\`)`
and `.or(\`last_completed_lego_id.is.null,last_completed_lego_id.lt.${ratchetHighestTo.legoId}\`)`
from `req.body.args`, cast `const a: any[] = Array.isArray(args) ? args : []` with
no runtime type validation before being spread positionally into the method
handlers (confirmed by reading `api/school/class-progress.ts` lines 374–390
and 209–258 on this branch, 2026-08-29). A comma in either value appends a
disjunct to the `.or()`, dissolving the forward-only progress ratchet these
calls exist to enforce. Reachable by any teacher/school_admin with the class
in `resolveVisibleScope`.

This is exactly SEC-AUDIT-2026-08-18 Finding 4. **New evidence this sweep
adds**: the file that characterizes it,
`api/school/class-progress.untrustedArgs.security-audit.ts`, is named with a
`.security-audit.ts` suffix, not `.test.ts`. `vitest.api.config.ts`'s
`include: ['api/**/*.test.ts']` does not match it — **the test has never run
in CI**, on this branch or (by the same glob) on `dev`. Verified directly:
`sec29-a-filter-injection.security.test.ts`'s first test reads the live
config and asserts the glob excludes any `*security-audit*` filename. A "fix"
to this finding could regress silently because the assertion that would catch
it was never wired up. Recommended fix (not applied): rename the existing
file to `class-progress.untrustedArgs.security.test.ts` (matching this
sweep's own naming convention) so it actually runs.

### SEC29-A-02 — `countSubtreeMembers` (orgPlatform.ts) cross-tenant member-count leak
**Severity: medium. New finding. Characterized in the test file, real production code exercised.**

`api/_utils/orgPlatform.ts:countSubtreeMembers` resolves an org's subtree via
`.like('path', \`${path}%\`)` — the exact pattern the 2026-08-06 pass
(`c2f04665`) replaced everywhere else with a `parent_id` walk
(`groupSubtree.descendantIds`) after discovering that `compute_group_path()`
slugifies the org name with no uniqueness constraint, so two orgs named the
same thing (a real, already-demonstrated occurrence — TENANCY-01) get the
identical `groups.path`. This function was not touched by that commit (it is
not in its file list) and still carries the bug.

`countSubtreeMembers` is called from exactly one place,
`api/org/subscription.ts:112`, to compute the `member_count` shown to an
org-leader on their own billing/dashboard surface ("N seats paid, M people").
On a slug collision, a leader's own dashboard silently reports a headcount
that includes an unrelated tenant's staff and students — a real cross-tenant
information leak (aggregate count only, not names), reachable by any
govt_admin whose org happens to share a slugified name with another org.
**Not currently used as a billing-enforcement input** in this codebase (the
entitlement gate in the same handler is driven by `platform_status`/
`platform_expires_at`, not `memberCount`) — so this is a display leak, not a
billing-evasion vector, as far as this sweep could verify (grepped every
caller of `countSubtreeMembers`; there is exactly one).

Suggested fix (not applied): route through `groupSubtree.descendantIds`
exactly as `schoolsForGroupSubtree` now does.

### SEC29-A-03 — `resolveGroupSubtreeIds` (demoSchoolGraph.ts) merges same-slug tenants
**Severity: low/medium (admin-only reachability, but real collateral-damage risk). New finding. Characterized, real production code exercised.**

`api/_utils/demoSchoolGraph.ts:resolveGroupSubtreeIds` has the identical bug
in a plain in-memory JS filter (`path === rootPath || path.startsWith(rootPath + '/')`)
rather than a PostgREST string, so it is not "injectable" by an outside actor
in the traditional sense, but it is the same slug-collision mechanism as
TENANCY-01 and was likewise missed by `c2f04665`. It feeds
`discoverDemoOrgGraph` (`api/admin/demo-schools.ts`, used by the
expire/ban/purge sweep) and `api/admin/demo-leaf.ts`.

Reachability is admin-only (these are `/api/admin/*` routes), so this is not
a privilege-escalation finding — an ssi_admin already has full data access.
The real risk is **collateral damage**: an admin expiring or purging a demo
org would have that operation's "everyone in this org" graph silently include
a same-slugged sibling org's staff and students. Given TENANCY-01 already
proves duplicate org names occur in this system (the founder-reported
"Deborah Testing" incident), this is not a hypothetical precondition.

Suggested fix (not applied): same as SEC29-A-02 — walk `parent_id` via
`descendantIds` instead of matching `groups.path`.

### SEC29-A-04 — invites.ts:132 is a slug-collision bug, not a syntax-injection bug (clarifying note, not a new finding)
**Severity: n/a (clarifies TENANCY-01's mechanism). Confirms, does not extend, area-c-reconciliation.md's COORD-02.**

Verified `supabase/schema.sql`'s `compute_group_path()` trigger:
`v_slug := LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'))`, so
every character outside `[a-zA-Z0-9]` — including every PostgREST filter-DSL
metacharacter (`,` `.` `(` `)` `%` `_` `"` `'`) — is replaced with `-` before
`groups.path` is ever stored. `api/groups/[id]/invites.ts:132`'s
`.or(\`path.eq.${path},path.like.${path}/%\`)` therefore **cannot** be
restructured by a crafted org name; the only way this line misbehaves is the
already-filed TENANCY-01 mechanism (two DIFFERENT orgs computing the SAME
`path` value and being treated as one subtree). This sweep found no
metacharacter-injection path into `groups.path` anywhere. Locked with a test
against the real slugify rule (`sec29-a-filter-injection.security.test.ts`).

This matters because it changes the fix shape: TENANCY-01's fix is
uniqueness/disambiguation of `path` (or, better, the `parent_id`-walk
replacement already used elsewhere), not string-escaping — escaping would not
touch the actual bug.

### SEC29-A-05 — invites.ts:412 unvalidated `req.query.id` reaches `.or()` for admin callers only
**Severity: info / hardening opportunity, not exploitable today. New observation.**

`resolveGroupTreeCaller`/`callerCanSeeGroup` (`api/_utils/groupTreeAuth.ts`)
short-circuits to `true` for any `isAdmin` caller **before** validating
`groupId`'s shape at all. For a non-admin leader, the same `groupId` is
checked via `isWithinLeaderSubtree` → `isStrictDescendantGroup`, which fetches
the whole `groups` forest into memory and does a plain `===`/array-membership
check — a crafted non-UUID `groupId` simply fails to match any real row and
the caller is 403'd before `groupId` ever reaches line 412's `.or(\`grants_group_id.eq.${groupId},...\`)`.
So the interpolation is only ever reached with a caller-supplied,
unvalidated `groupId` when the caller is already `ssi_admin`/`god` — a fully
trusted principal who already has unrestricted read access to `invite_codes`
via the service-role client. Traced through: no privilege elevation, no
cross-tenant reach beyond what the admin already has. Filed as info because
"parse and validate the identifier at the edge, even for trusted callers" is
still good practice and it is the one `.or()` site in the estate that skips
it — but this sweep found no exploitable consequence.

## Explicit gaps

- Did not attempt to enumerate every RPC function body (`analytics_class_sessions_scoped`,
  `get_cascade_courses`, `admin_practice_minutes`, etc.) for injection risk
  inside the function definitions themselves — out of scope for a filter-DSL
  sweep of `api/**`, and per the rules of this audit, no DB/DDL access was
  used to read function bodies. If any of those functions build dynamic SQL
  internally from their parameters, that is a different, DB-side finding this
  sweep cannot see from `api/` alone.
- Did not build a full HTTP-handler-level characterization test for
  `api/school/rate-compare.ts` (SEC29-A-06 below) — the handler has enough
  upstream dependencies (`resolveVisibleScope`, `isEntityCoverageExpired`,
  `rateCompare.ts` aggregation helpers, `analytics_class_sessions_scoped` RPC)
  that a hermetic full-handler test would mostly be re-testing plumbing
  already covered by SEC29-A-02/03's characterization of the identical
  `.like('path', ...)` bug shape in `orgPlatform.ts` and `demoSchoolGraph.ts`.
  Verified by code reading only (cited file:line in the census table above);
  rated medium confidence-by-reading, not test-proven. Flagging as
  `SEC29-A-06` below rather than silently folding into A-02/A-03 because its
  blast radius (comparison-average pooling into `rate-compare` results) is
  distinct from a raw membership/headcount leak.

### SEC29-A-06 — `subtreeClassIdsForGroupPath` (school/rate-compare.ts) pools a same-slug tenant's classes into comparison averages
**Severity: medium. New finding, verified by code reading (not test-characterized — see gap above).**

`api/school/rate-compare.ts`'s private `subtreeClassIdsForGroupPath` (lines
118–129) is called from four sites — `loadEntityMeta` (line 180, resolving
the **entity's own** classIds for a group-level comparison), and
`resolveCohort`'s `group`→`group` (209), `school`→`group` (230), `group`→`region`
(267) and `group`→`global`/`global_all_courses` (282) branches — and every one
uses the unfixed `.like('path', ...)` pattern. This is the sibling file to
`api/groups/[id]/rate-compare.ts`, which the `c2f04665` commit DID fix (it now
imports and uses `descendantIds`); `api/school/rate-compare.ts` is a
different file with the same job and was not touched by that commit at all.

Effect: on a slug collision, an org/group's own "rate of progress" figure
(entity-level, via `loadEntityMeta`) and every comparison average it's shown
against (region/global) are computed over a class pool that silently includes
an unrelated tenant's classes. The response never names another entity
(K_FLOOR / sovereignty design in `rateCompare.ts` holds), so this is not a
raw-identity leak — but it is real data influence from one tenant's activity
on another's reported numbers, and in the `loadEntityMeta` case it directly
inflates/dilutes the caller's OWN reported classIds, not just the comparison
cohort.

Suggested fix (not applied): same as A-02/A-03 — replace
`subtreeClassIdsForGroupPath`'s `.like('path', ...)` with a `parent_id` walk
via `descendantIds`, matching what `api/groups/[id]/rate-compare.ts` already
does.

## Summary

- **14 interpolation-site groups** examined across the census (some are
  multi-line duplicates of the same pattern in the same file).
- **Classification split**: 2 sites (a) fully attacker-controlled
  (class-progress.ts, already filed); 1 site (a) attacker-controlled but
  admin-only reachable (invites.ts:412, not exploitable); 4 site-groups (b)
  semi-controlled via attacker-creatable DB rows (rate-compare.ts x2 files,
  orgPlatform.ts, demoSchoolGraph.ts — 3 of these are genuinely new findings,
  1 already fixed); remainder (c) server-derived/closed-set, all controls
  hold.
- **Ranked findings**: SEC29-A-01 (high, already filed, new CI-gap evidence) >
  SEC29-A-02 / SEC29-A-06 / SEC29-A-03 (medium — three instances of the same
  slug-collision bug class the 2026-08-06 pass missed, in three different
  files) > SEC29-A-05 (info, no exploitable consequence found).
- **Headline result**: the `.or()`/`.filter()` metacharacter-injection angle
  this sweep was chartered to find turned up **no new syntax-injection
  vulnerability** — `groups.path`'s enforced charset closes that door
  everywhere it's used, and the one place attacker-controlled data reaches
  `.or()` unvalidated (class-progress.ts) was already known. What the sweep
  DID find, by tracing every `path`-based predicate to its root, is that the
  2026-08-06 tenancy-collision fix (`c2f04665`) covered `schoolScope.ts`,
  `groupRollups.ts`, and `groups/[id]/rate-compare.ts` but left **three other
  callers of the same vulnerable pattern** — `orgPlatform.ts`,
  `demoSchoolGraph.ts`, and `school/rate-compare.ts` — completely untouched.
