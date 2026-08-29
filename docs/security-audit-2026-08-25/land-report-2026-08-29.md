# Landing the stranded 2026-08-25 security remediation

Job #141, 2026-08-29. Branch `security/remediation-2026-08-25` → `origin/dev`.

## 1. The branch is off this machine

`git push origin security/remediation-2026-08-25` — **done first, before any review**,
at tip `2482c095`. Origin previously held only the 3-commit D-02 tail (`1f1900f4`);
it now holds all 39. It is no longer single-copy regardless of anything else below.

One correction to the brief's premise, in Tom's favour: the five shard branches
`security/rem-0825-w1`…`w5` were *already* on origin, so the underlying work was
not literally one-copy — but the integration branch that merged them was, and that
is the artifact everything else was built on.

## 2. What I ran, and what passed

Everything ran in a throwaway worktree `~/SSi/wt-secrem-land`, on the **merge result**
(`origin/dev` + the branch), never on the primary checkout. The primary checkout's
`fix/listening-meta-self-healing-2026-08-24` state was not touched.

The merge into `origin/dev` was **clean — zero conflicts**.

| Gate | Result |
|---|---|
| `pnpm --filter @ssi/core build` | ✅ exit 0 |
| `pnpm --filter player-vue typecheck` | ✅ exit 0 |
| `pnpm --filter player-vue test` | ✅ **2600 passed**, 3 skipped, 3 todo (251 files) |
| `pnpm --filter player-vue lint` | ✅ exit 0 — **0 errors**, 155 warnings (the bar is zero errors) |
| `pnpm run typecheck:api` | ✅ exit 0 |
| `pnpm run test:api` | ✅ **1456 passed**, 5 skipped, 8 todo (131 files) |

All six green. GitHub Actions CI is dead (billing, job #140) — I did not wait for it,
and this local run is the substitute gate.

## 3. Live-database verification

The one DB-touching item is **SEC25-D-01** (pinning `search_path` on SECURITY DEFINER
functions). I ran the branch's own canary against the live DB in rollback mode, and
then verified the end state independently through the Postgres catalogue.

- Canary `canary_definer_search_path.cjs`: **17 passed, 0 failed**, rolled back.
- **The migration is already applied and live.** Pre-state showed 70 DEFINER functions
  in `public` and **0 unpinned**. Direct `pg_proc` query confirms **0 functions missing
  an explicit `pg_temp`**. So merging the migration file changes nothing operationally —
  the DB half was committed back on 2026-08-25.
- The failure mode I went looking for — a function with an empty `search_path=""` that
  would make the migration's DO-block throw — **does not exist** in this DB (0 rows).

I also checked, against live data, every place the diff tightens a validator, to prove
it breaks no real user:

| Check | Result |
|---|---|
| Weak `ABC-123` `ssi_admin`/`god` codes that SEC25-X-03 retro-invalidates | **0** (2 admin codes exist, both already strong-format) |
| Live `course_code`s failing the new `^[a-z0-9_]{1,64}$` validator | **0 of 149** |
| Lego ids that `safeIdToken()` would silently mutate | **0** |
| `possession_mint_attempts` CHECK constraint that would reject the new `email_verify_attempt` outcome | **none** — no CHECK on the table |
| Tracked files that the new `.gitignore` `/.*` rule would shadow | **0** |
| Root org groups sharing a slug path (the TENANCY-01 collision) | **0** — the fix is preventive; nobody's data was actually exposed |
| `groups` table size vs. the whole-table read in `fetchSubtree` | 52 rows — no truncation risk |

## 4. Second opinion, from outside the house family

Dispatched **#142** on `terra` (OpenAI Codex CLI), read-only, in its own worktree. It
read the diff and returned three "blockers". I verified each rather than taking them
at face value, and **none of the three holds as a merge blocker**:

**Its B1 — the MX-lookup throttle in `emailValidation.ts` is per-lambda-instance and so
dilutes across cold starts.** *Technically correct, wrong severity.* The function
**fails open** — over-budget returns `null` = "inconclusive", so it denies nobody. Before
this change there was **no bound at all**, so it strictly improves. The code itself states
the trade-off in its own comment. Holding it back would be worse security, not better.
Logged as a follow-up, not a holdback.

**Its B2 — the code-attempt throttle is a non-atomic check-then-insert, racy under parallel
requests.** *Real, and entirely pre-existing.* The diff on that file touched only the header
comment and `getClientIp`; `isIpOverLimit` and `logAttempt` are untouched. Holding the branch
back would leave the **forgeable bucket key** in place — the far worse bug, and the one this
branch actually fixes. Logged as a follow-up.

**Its B3 — the canary is not a real two-direction canary.** *Partly fair.* It is right that
9 of the 13 probed functions "errored identically before and after", which proves little
about those 9, and that three altered functions aren't probed at all. But I ran the canary
live and independently confirmed the end state through `pg_proc`, and the "nothing else moved"
half (grants, owner, body, `prosecdef` byte-identical) did assert meaningfully. The DB change
has been live and correct for four days. Not a blocker; the canary's probe quality is a
follow-up.

Codex's own conclusion on the main body agrees with mine: *"No confirmed legitimate-user
regression found in the tenancy/authz handlers or the remaining input/webhook pass."*

## 5. What I checked myself

Against the repo's RLS/canary doctrine: **no clever RLS policies anywhere in this diff** —
all hierarchy authz is in server-mediated endpoints, which is exactly the doctrine's division
of labour. The migration contains no policy or grant change (so nothing to pair GRANTs with),
and ends with `NOTIFY pgrst, 'reload schema'`.

The doctrine's **identity trap** — `player_events.user_id` is a `uuid` that holds `learners.id`,
not the auth uid — is handled correctly: `api/player-events.ts` maps the verified auth uid
through `learners` to the learner PK, and never compares against `auth.uid()`.

The substantive fixes I read closely and judged sound:

- **SEC25-X-03** — an `ABC-123` code (a 13.8M keyspace) could be guessed straight into
  `platform_role = 'ssi_admin'`. This was the worst one. Closed at both mint and redeem.
- **TENANCY-01/02/04/05** — subtree membership was computed by *slug path prefix*. Slugs
  aren't unique and root-org creation is self-serve, so naming your own org after a victim's
  gave you their whole invite ledger. Now walks `parent_id`. Genuinely serious, well fixed.
- **AUTH-CORE-05** — the rate-limit bucket key was a client-written header. Now
  platform-attested (`x-vercel-forwarded-for`, then the socket peer, then a shared bucket).
- **AUTH-CORE-06** — a `.single()` collision probe that failed **open** exactly when two
  learners already shared an address, i.e. precisely when it mattered.
- **INPUT-02/03/06** — values interpolated into PostgREST `.or()` filter *expressions*
  (a DSL string, not a bound parameter), plus an allow-list on `lego_progress` updates so
  the write can't undo its own ownership check.
- **INPUT-04** — telemetry attributed from an unsigned cookie. I specifically verified the
  replacement is wired end-to-end: `getToken` is passed at **both** real `usePlayerLog` call
  sites, and `useAuth.getToken` genuinely exists — so signed-in attribution survives rather
  than silently going null.

## 6. Held back

**Nothing.** Every one of the 33 fixes is on `dev`.

I want to be plain that this is a positive finding rather than a skipped step: the three
candidates for holding back all failed the test in the same direction — holding them would
have *restored a worse bug*. The two codex blockers are pre-existing or honestly-documented
partial mitigations that strictly improve on what `dev` had; and every tightened validator
I could test against live data came back with zero affected rows.

## 7. Follow-ups (not blocking, worth a future job)

1. Move the code-attempt throttle from count-then-insert to an atomic DB admission —
   it is bypassable by parallelising. Pre-existing, now the weakest link in that path.
2. The MX-lookup throttle is per-instance. If the DNS-beacon shape ever matters, it needs
   ledger-backed state; note the cache's wholesale `clear()` on overflow lets any caller
   reset everyone's budget on a warm instance.
3. Strengthen the DEFINER canary's probes: 9 of 13 error identically both sides and prove
   nothing; 3 altered functions aren't probed at all.
4. Nine of the `analytics_*` DEFINER functions **error in production today**, before and
   after the migration. Pre-existing and unrelated to this branch, but nobody seems to have
   noticed, and it means those analytics RPCs are dead.

## 8. Gap I could not close

CI itself. GitHub Actions is down for billing, so nothing verified this in a clean-room
environment — only this machine, with its own node_modules and its own resolved lockfile.
The six commands are the same ones CI runs, but "green here" is not identical to "green in CI".

