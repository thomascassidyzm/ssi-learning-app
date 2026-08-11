# Security audit 2026-08-11 — coordinator sweep: PostgREST `.or()` filter injection

**Scope of this file:** one targeted sweep run by the audit coordinator, not a whole area.
The five area reports live alongside it in `docs/security-audit-2026-08-11/`.

**Method:** enumerated every `.or()`, `.filter()`, `.like()` and `.ilike()` call in `api/**`
(8, 0, 3 and 3 sites respectively, excluding tests), traced each interpolated value back to
its source, and judged injectability. Read-only; nothing was executed against a live database.

**Why `.or()` specifically:** PostgREST parses the `.or()` argument as a *filter expression* —
commas separate filters, parentheses group them. A value interpolated there is code, not data.
By contrast `.eq(col, value)` / `.ilike(col, pattern)` pass the value as its own query
parameter, so a comma in it is inert. This distinction is the whole finding.

---

## COORD-01 — `search` query param injected into a service-role `.or()` filter

- **Severity:** medium (high primitive, admin-gated reach)
- **File:** `api/admin/users.ts:317` (value read at `:291`, service-role client at `:263`)
- **Confidence:** confirmed by test — `api/_security/coordinator-postgrest-filter-injection.security.test.ts`

```ts
// api/admin/users.ts:291
const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
...
// api/admin/users.ts:316-318
const orParts = [`display_name.ilike.%${search}%`]
if (learnerIdsMatchingEmail.length > 0) orParts.push(`id.in.(${learnerIdsMatchingEmail.join(',')})`)
query = query.or(orParts.join(','))
```

`search` reaches the template literal unescaped. A comma in it adds a second top-level clause
to the OR group; a `)` can close the `id.in.(…)` group early. The test asserts this directly:
`?search=x,platform_role.eq.ssi_admin` produces the two-clause expression
`display_name.ilike.%x,platform_role.eq.ssi_admin%`.

**What an attacker does / gets.** The endpoint is gated by `verifyAdmin` (`:251`), so this is
not an anonymous hole. What raises it above cosmetic is line 263: the query runs on
`SUPABASE_SERVICE_ROLE_KEY`, so any injected predicate is evaluated with **RLS bypassed**. The
realistic exploit is therefore (a) an admin's browser or an admin-held link carrying a crafted
`search`, or (b) a lower-trust operator who holds admin on this surface widening their own read
beyond the intended `display_name`/`email` search — arbitrary predicates over the `learners`
table, including columns the endpoint never selects, used as a boolean oracle. It is a read
primitive only: `.or()` cannot reach a different table or write.

Also unescaped on the same line: `%` and `_` are ILIKE wildcards. `?search=%` matches every
learner; repeated wildcards force a full scan on a service-role query — a cheap DoS lever.

**Recommended fix (described, not applied).** Escape or reject before interpolation: strip/reject
`, ( ) .` and backslash-escape `%` and `_`, so one search term can only ever produce one filter
clause. The `id.in.(…)` part is safe as built (uuids from the DB) but should be constructed from
a validated uuid list for the same reason. A shared `escapePostgrestFilterValue()` in
`api/_utils/` would give every future `.or()` site one obvious right answer. Do not "fix" this by
dropping to `.ilike()` alone — the OR across name+email is the feature.

---

## COORD-02 — `groups.path` interpolation is safe, and *why* (control that holds)

- **Severity:** info — no defect. Recorded because the safety is non-obvious and load-bearing.
- **Files:** `api/groups/[id]/invites.ts:132`, `:140`, `:302`, `:412`

```ts
.or(`path.eq.${path},path.like.${path}/%`)
```

`path` looks user-controlled — it derives from group *names*, which humans type. It is not,
because `groups.path` is computed by the DB trigger `compute_group_path()` (`supabase/schema.sql`),
whose slug line is `LOWER(REGEXP_REPLACE(NEW.name, '[^a-zA-Z0-9]+', '-', 'g'))`. Every
metacharacter that matters to PostgREST — comma, paren, dot, quote — is collapsed to `-` before
it can reach `path`. `groupSlug()` in `api/_utils/groupSlug.ts` mirrors that line exactly.

So the injection safety of four call sites rests on a charset invariant enforced in SQL, in
another file, for an unrelated reason (path-prefix subtree matching). That is exactly the kind of
implicit dependency that breaks silently when someone later widens the slug to allow, say,
apostrophes in Welsh names. The test file pins it: six injection-shaped names are slugged and
asserted to stay within `^[a-z0-9-]*$`.

The sibling `.or()` sites at `:140`, `:302` and `:412` interpolate uuid lists read back from the
database, and `:412` interpolates `groupId` from `req.query.id`.

## COORD-03 — `req.query.id` reaches an `.or()` expression unvalidated

- **Severity:** low (defence-in-depth; not currently exploitable)
- **File:** `api/groups/[id]/invites.ts:412`, id read at `:91`
- **Confidence:** UNVERIFIED as exploitable — I could not construct a reaching input, and did not
  test against a live database. Reported as hardening, not as a live hole.

```ts
// :91  — no shape validation at all
const groupId = req.query.id as string
if (!groupId) { ... }
...
// :412
? query.or(`grants_group_id.eq.${groupId},grants_school_id.eq.${ownSchoolId}`)
```

`groupId` is never validated as a uuid. Two things stop it being a hole today, and both are
accidents of control flow rather than deliberate guards:

1. `callerCanSeeGroup()` (`api/_utils/groupTreeAuth.ts:92-99`) returns `true` unconditionally when
   `caller.isAdmin`, **without checking the group exists** — so for an ssi_admin the authz gate
   passes any string whatsoever. It is not the thing stopping this.
2. The vulnerable branch is only taken when `ownSchoolIdForNode(supabase, groupId)` returns
   non-null, which requires `groupId` to name a real school node. A junk id falls to the
   `query.eq('grants_group_id', groupId)` branch, where the value is parameterised and inert.

That means the safety margin is one refactor wide. **Recommended fix:** validate `req.query.id`
against a uuid regex at `:91` and 400 otherwise — the same guard belongs on every
`api/**/[id]` route, and would also turn a class of PostgREST 500s into clean 400s. Separately,
`callerCanSeeGroup`'s admin short-circuit returning `true` for a non-existent group is worth
tightening on its own merits; flagged to the tenancy area (#139) as it owns that helper.

---

## Gaps (explicit)

- **No live database access was used and no request was made to staging or production.** Every
  claim above is from reading code; the two CURRENT-BEHAVIOUR assertions are proven against the
  handler with a mocked Supabase client, not against PostgREST itself. The precise parse of
  `display_name.ilike.%x,platform_role.eq.ssi_admin%` by a real PostgREST instance is therefore
  **inferred from its documented grammar, not observed.** Someone with a safe read-only instance
  should confirm the two-clause parse before this is prioritised as medium rather than low.
- `compute_group_path()` is quoted from the comment block in `api/_utils/groupSlug.ts`, which
  states it mirrors `supabase/schema.sql`. I did not re-read the live trigger definition in the
  database, so COORD-02's invariant is verified against the repo, not against production.
- This sweep covered `.or/.filter/.like/.ilike` only. Other injection classes (raw `rpc`, path
  traversal, SSRF, mass assignment, prototype pollution) are area #140's scope and are reported
  separately.
