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

No new files go in this directory.
