# Tenth security audit — Area C: the intel / reporting surface

Date: 2026-09-12. Findings and tests only. No behaviour changed, no fix applied, no migration
written, no live database read, no network call. Every claim below is asserted over repo source in
`api/_security/sec0912t-c-intel-surface.security.test.ts` (green, pure: `node:fs`, `node:path`,
vitest, plus the pure arithmetic exported by `api/_utils/orgFunderExport.ts`).

## 0. Scope, and what the census got slightly wrong

Read in full: `api/intel/{courses,findings,leaving,person,pulse,weak-points,where-and-what,working}.ts`,
`api/org/{intel,vad,funder-export}.ts`, `api/admin/board-metrics.ts`, `api/board/snapshot/[code].ts`,
and the utilities they import: `realLearnerPopulation`, `entitlementCohort`, `boardMetrics`,
`groupTreeAuth`, `orgLeader`, `vadVisibility`, `vadProsody`, `groupSubtree`, `schoolScope`
(subtree half), `classPractice` (people scope), `inAppTime`, `schoolCoverageGate`, `orgFunderExport`,
`codeGen`, `schoolNode`. Client callers were traced to confirm reachability
(`insight/data/orgIntel.ts`, `insight/data/vadScope.ts`, `components/admin/OrgFunderNumbers.vue`,
`views/BoardSnapshotView.vue`).

The brief said none of these had been security-reviewed. The ninth audit's README (2026-09-12)
does list "Intel surface (8 endpoints + org/intel)" as *clear on gating* and names `org/intel.ts`
in SEC0912-A-02. So gating had been glanced at; tenancy internals, aggregation, untrusted args and
the funder file had not. Those are what this pass did.

## 1. Findings

### SEC0912T-C-01 — MEDIUM — the funder export has no small-cell floor, and its 16-24 sub-cohort attaches an age band to a person

**Where.** `api/org/funder-export.ts` (handler) and `api/_utils/orgFunderExport.ts`
(`measureFolded`, `toCsv`). Every window carries two measure blocks, `all` and `aged16to24`, for
whatever `?groupId=` the caller names, and the whole subtree under it.

**Why it is a defect.** The handler's own header promises: *"The age tick is reported only as a
cohort size, never attached to a person … the export must not undo that by handing the funder an
identifiable list of who ticked."* The existing test checks that no id, name or email is in the
file. Nothing checks the size of the cell. `aged16to24.registered = 1` beside `totalMinutes = 47`
is one person's age band and one person's minutes; with two registered and one aged,
`all − aged16to24` is the other person's minutes. The leader already holds the roster with names
(the org lens lists people by name and learner id), so the fragment resolves to a person
immediately. The age band is otherwise readable only by the learner who ticked it
(`api/org/enrol.ts` reads `age_band_16_24` from the caller's own enrolment rows), so this is new
information to the leader, and the file is built to be forwarded to the funder.

**Who can reach it.** Any govt_admin or school_admin, through `resolveGroupTreeCaller` +
`callerCanSeeGroup`, naming any node in their own subtree. Child groups exist precisely to split a
cohort, so small cells are the expected case, not an edge.

**Blast radius.** One field (16-24 yes/no) plus minutes, per small cell, to a leader who is already
trusted with the roster; onward to a funder as an unnamed count that the leader can name. Not a
cross-tenant read, not a takeover. Real because the code makes a written privacy promise the
numbers break.

**Fix shape (not applied).** Reuse the surface's own constant (`K_FLOOR = 5`, as in
`weak-points.ts` / `where-and-what.ts`): when `aged16to24.registered < K_FLOOR`, or
`all.registered − aged16to24.registered < K_FLOOR`, emit the sub-cohort as nulls with a
`tooFewToSay: true` marker in JSON and blank cells in CSV. **That floor alone is NOT sufficient**,
and the counterexample is job #449's: a parent node reporting 12 registered / 6 aged and a child
node reporting 11 / 5 both clear a per-export floor of five, yet subtracting one release from the
other names the single excluded person's age tick. Any floor has to hold across the *set* of
releases a leader can obtain — parent and child, and one window against another — not per file.
`where-and-what` is NOT the pattern to copy here (see the corrected clearance below): its floor is
one whole-response flag, not per-row suppression. The characterization test goes red the
moment `K_FLOOR`/`kFloor`/`tooFewToSay` appears in either file, so the fix will announce itself.

### SEC0912T-C-02 — LOW/MEDIUM — `org/intel` is a fifth write-before-authz instance, and this area first cleared it

**Raised by cross-family verification** (GPT-6 Astra, job #449·G, given the claim and the published
evidence only), confirmed here against source.

**Where.** `api/org/intel.ts:471-477` (the `Promise.all` that races `resolveGroupTreeCaller` against
a read of the entire `groups` forest and three lookups of the caller-named id) and `:489` / `:500`
(`ensureSchoolNode`, which INSERTs a `groups` row and UPDATEs `schools.node_group_id` under the
service role) — both before the gate at `:512`.

**Why it matters.** Area C pinned `org/vad.ts` as the fourth instance of the ninth audit's
SEC0912-A-02 class *and in the same pass cleared `org/intel` as gating "before any read"*. Both
cannot be true. Any caller who resolves as some leader can name an arbitrary school id and mint a
node for a tenant they have no rights over, then be told 403. The 404-vs-403 existence oracle
(A-03) rides along.

**Severity.** LOW as a disclosure — the racing reads are discarded when `caller` is null, so nothing
leaks — MEDIUM as a write, because it is an unauthorised mutation of another tenant's row.

**Fix shape (not applied).** Await the caller before the wave, and move `ensureSchoolNode` after
`callerCanSeeGroup`, as the A-02 remediation intends for all five instances.

**The lesson worth keeping.** A clearance is a claim like any other. This one was wrong because it
described the endpoint's *intent* rather than its statement order, and it was caught by a reader who
had the evidence but not the reasoning.

### Recurring instances of already-known classes (one line each)

- **SEC0912-B-02 class, raw error text.** `api/org/vad.ts` returns `e.message` in its 500 body
  (leader-reachable). `api/admin/board-metrics.ts` does the same, admin-only. Pinned as
  characterization; the fix shape is the shared `serverError()` the ninth audit proposed.
- **SEC0912-A-02 class, write before authz.** `api/org/vad.ts` → `resolveVadScope` mints a
  client-named school's node (`ensureSchoolNode`: INSERT `groups`, UPDATE `schools`, service role)
  *before* `isWithinLeaderSubtree` answers. A-02 named `org/intel`, `home` and `rate-compare`; vad
  is a fourth instance. The A-03 404-vs-403 existence oracle rides with it. Source ordering pinned.

## 2. Checked and cleared

| Question | Verdict |
|---|---|
| **Doors** — the eight `api/intel/*` and `board-metrics` | `verifyAdmin` before the service client, every one; `applyCors` GET-only. Admin-eyes only. |
| **Doors** — `org/intel`, `funder-export` | `resolveGroupTreeCaller` (ssi_admin/god, else own `govt_admins` row, else a school_admin's own school node, else 403) then `callerCanSeeGroup` on the *resolved* node, before any class, enrolment or policy row is read. **CORRECTED 2026-09-12** — that holds for the COHORT reads only. `org/intel` races the caller resolution against a read of the whole group forest, and can WRITE a school node, before the gate. See SEC0912T-C-02 below. `funder-export` does gate before its reporting reads. |
| **Doors** — `org/vad` | `resolveVadCaller` → `resolveVadScope` → `isDenied` → reads. The learner door is self, or `resolveVisibleScope`'s set, or admin; the class door is `scope.classIds` or the leader subtree; the reads take `scope.learnerIds`, never the query value. `fetchProsodyAggs([])` means nobody, not "no filter". |
| **Board snapshot `[code]`** | Public by design, capability-by-unguessability: `generateShareCode()` is `randomBytes(16)` base64url (128 bits, CSPRNG). Table is RLS-on, zero policies, `service_role` grant only. Reader projects four fields, 404s on missing *or* revoked, and the markdown is rendered into typed blocks with no `v-html`/`innerHTML`. |
| **Tenancy** — path strings | No `.path`, `startsWith(`, `.like(`/`.ilike(`, `LIKE` or `rootOfPath` anywhere in scope. The predicate is one copy: `callerCanSeeGroup → isWithinLeaderSubtree → isStrictDescendantGroup → descendantIds` over `parent_id`. `org/intel`, `vadVisibility.schoolIdsForNodeSubtree` and `funder-export.fetchSubtree` all widen through the same walk. Scope roots come from the verified auth uid; `groupTreeAuth`/`vadVisibility` never touch `req.query`/`req.body`. |
| **Untrusted args** | No `.or()`, `.filter('…')`, `.like()`, `.textSearch()` in scope. The one `in.(…)` string (`where-and-what`) is the compile-time `FIREHOSE_EVENTS` list. `course`/`id` are sliced to 64 and bound with `.eq`; `days` is `Math.min/max` clamped. Funder RPC args are bound JSON with `groupIds` server-derived; both RPCs are `service_role`-only in `schema.sql`. |
| **Funder CSV** | Every cell is a number or a label built from a regex-validated value (`YYYY-MM`, `all_time`, `since_YYYY-MM-DD`); `org_display_name` never enters the CSV; no cell can start `= + - @`. Filename is built from `month` *after* `monthWindow()` validated it. |
| **K-floor where it exists** | `weak-points` exports `K_FLOOR = 5` and empties rows / nulls shares under it. **CORRECTED 2026-09-12** — `where-and-what` exports the same constant but applies it ONCE to the whole response (`tooFewToSay: all.size < K_FLOOR`) and returns every country and device row regardless; it is not a per-row suppressor and C-01's fix must not copy it as one. Admin-only, so the consequence there is small. `leaving` and `person` are per-person by design and admin-only; `leaving` caps at 200 rows. `org/intel` and `org/vad` are per-person by the founder's hierarchy ruling (2026-08-20), so no floor is expected there. |
| **`test_learner_ids()`** | Granted to `anon` and `authenticated` in `schema.sql`, contrary to its own COMMENT and to `realLearnerPopulation.ts` ("service_role only"). Harmless: it is SECURITY INVOKER, so under a learner JWT it sees only `learners_select` (own row or `can_view_learner_data`). Pinned so a future DEFINER conversion without a REVOKE goes red. The two prose claims are wrong and worth correcting. |
| **Identity trap** | Every `learner_id` in scope is `learners.id`; `player_events.user_id` is read as `learners.id` in `vadProsody` and `realLearnerPopulation.isMachineEvent`; auth uids appear only in `groupTreeAuth`/`vadVisibility`/`classPractice.ownAccountLearners` on TEXT columns. No mixing found. |

## 3. Out of scope, noted for the coordinator

`api/org/enrol.ts` decides "same org" for the one-cohort rule with `rootOfPath(group.path)` — the
first segment of the *name-derived slug path*. That is exactly the class SEC0912-A-01 found in SQL
(`is_govt_admin_over_group()`, fixed job #300) and the class `groupSubtree.ts` documents as having
merged two "Deborah Testing" tenants live. It is on the money path, so it belongs to whichever
sibling holds enrolment, not here; it is not asserted in this file.

## 4. Honest gaps

- **No live state.** Whether any real org today has a sub-group small enough for C-01 to name a
  person is a live question; the shape is proven, the instance is not. Live grants were not
  compared with `schema.sql`.
- **`baselineFrom` is regex-checked but not range-checked** (`2026-99-99` passes to Postgres and
  becomes a 500 "Internal server error"). Nuisance, not security; not counted as a finding.
- The public snapshot route has no rate limit of its own on code probing; at 128 bits that is not a
  reachable consequence, so it is not a finding.
