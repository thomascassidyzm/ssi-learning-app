# supabase/migrations — ARCHIVED (history only)

**The canonical record of the database's current state is [`../schema.sql`](../schema.sql)** —
a `pg_dump` of the live Supabase `public` schema (tables, functions/RPCs, RLS
policies, grants, indexes, triggers). Regenerate it with `../snapshot-schema.sh`
after any applied DB change.

The 158 timestamped `.sql` files that used to live here were the historical
*path* to that state. Every one has already been applied to the live DB, so they
are no longer needed to understand or reproduce current state — `schema.sql`
holds it. They remain in **git history**:

```bash
git log --oneline --diff-filter=D -- supabase/migrations      # find the removal commit
git show <commit>^:supabase/migrations/<file>.sql             # read any archived migration
```

## Workflow going forward

1. Apply a change to the live DB (psql / direct connection — same as today).
2. Run `./supabase/snapshot-schema.sh` to refresh `schema.sql`.
3. Commit the updated `schema.sql`.

Step 2 was skipped between 25 August and 5 September 2026, and `schema.sql`
went ten tables out of date while live code queried them. Two checks now catch
that:

- `api/schema-snapshot.test.ts` — runs in CI, needs no credential; fails if any
  relation the shipping code names in `.from('…')` is absent from `schema.sql`.
- `./supabase/check-schema-drift.sh` — read-only; compares the snapshot's
  relations against the live DB and names the differences. **Not in CI**, because
  CI has no database credential and should not be given one; run it by hand or
  from a nightly job on a machine that already holds `.env.psql`.

No new files go in this directory.
