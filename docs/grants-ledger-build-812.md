# Grants ledger and Play rail — build #812

## Landing gap

The worktree contains the implementation. Git cannot write its shared metadata:

```
fatal: Unable to create '/home/tomcassidy/SSi/ssi-learning-app/.git/worktrees/812-build-on-astra-grants-ledger-goo/index.lock': Read-only file system
```

Git blocked committing, pushing and promotion. No persistent schema migration or backfill was applied while the code remained undeployable. Main was never modified. Database canaries applied the migration inside a transaction and rolled it back. No Paddle billing API call was made. No conversation token was supplied, so progress and document-publication endpoints were skipped.

## Implementation

- `supabase/migrations/20260915_individual_grants_ledger.sql`: additive columns, source backfill and unique source references on `user_entitlements`. Existing production writers retain their source through a trigger. No RLS policy changes.
- `api/_utils/resolveEntitlements.ts` and `courseAccess.ts`: start, expiry and revocation checks. Once a Paddle grant exists, the retained subscription row cannot bypass its revocation. Family cover still comes from the unchanged family resolver.
- `useCheckout.ts`: resolves the buyer's `learners.id` and sends it alongside the auth id. Premium and Family webhooks prefer that domain identity, keeping legacy fallback.
- Paddle subscription writes mirror to grants in the same database transaction. Refunds carry a distinct marker so an unrelated subscription update cannot undo them. Raw Paddle status distinguishes pause from cancellation. Paid events extend grants through an RPC; a later paid period can restore access after a refund. Purchases suppressed by the existing plan-precedence guard get separate grants without changing the retained subscription row.
- `api/store/play-verify.ts` and `play-rtdn.ts`: verified receipts through a thin publisher interface, Google JWT OAuth via Node crypto, authenticated Pub/Sub push, package and product allowlists, acknowledgement, expiry from the publisher, and grant writes through a service-role-only RPC. Purchase-token ownership survives restores and linked-token replacement. The RPC serialises tokens, deduplicates notifications atomically with the write, and rejects stale verification snapshots. Revocation hints cannot override a freshly verified recovery. Active Play/Paddle overlap is logged, not prevented.
- `tools/grants/paddle-backfill.mjs`: read-only unless `DRY_RUN=false`; apply requires a reviewed snapshot and checks locked rows against that snapshot before inserting. Existing grants are preserved. `supabase/secfix-toolkit/canary_individual_grants_20260915.cjs` is rollback-only.

Sources include `admin` and `email_allowlist`; `apple` has no handler. Paddle remains its own detail table. Play grants cover the catalogue. All current individual Paddle subscriptions also resolve catalogue-wide in the existing code. Code and email-grant references include the learner id, preserving the existing per-learner uniqueness of both redemption paths; using only the code id would make the required global unique index reject valid redemptions.

## Database dry run

[Seven active rows and twelve missing-expiry records](grants-ledger-paddle-dry-run-2026-09-15.md) were read from the live database. All twelve cancelled subscriptions have `current_period_end = null`; they are excluded until their real expiry is retrieved from Paddle. No expiry was invented. The seven active rows can be inserted independently after the schema migration, with a fresh reviewed snapshot. The script cannot apply before its RPC has landed.

## Wiring still required

Google Play Console/service-account credentials are absent. Configure these on staging before enabling the handlers:

- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: service account with Android Publisher purchase access.
- `GOOGLE_PLAY_PACKAGE_NAME`: exact Play app package. The checked-in Capacitor shell currently uses `com.saysomethingin.devwrap`; do not guess a production listing id.
- `GOOGLE_PLAY_SUBSCRIPTION_IDS`: comma-separated allowed subscription product ids, including the monthly India product.
- `GOOGLE_PLAY_PUBSUB_AUDIENCE`: exact authenticated push audience.
- `GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL`: the Pub/Sub push identity.
- Existing Supabase server URL and service-role credentials.

The app must send its canonical learner id through Play Billing's obfuscated account field when purchasing, and post `{ purchaseToken, courseCode }` with its auth bearer token to `/api/store/play-verify`. The result contains the server course-access verdict for the caller; restoring another learner's token never signs the caller into that learner's account or grants them access. Native purchase execution remains unwired and `STORE_BILLING_WIRED` remains false; this build supplies the server rail. No real Play receipt could be tested without Console wiring. Staging learner wall, fresh grant, revoked grant and family playback remain unverified because the build could not be committed or promoted.

Implementation references: [Google subscription resource](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2), [Google RTDN reference](https://developer.android.com/google/play/billing/rtdn-reference).

## Verification

The kept checkout identity test from `/d/e1d47d72` was reinstated for the own-ledger contract. It failed on unchanged checkout because only the auth id was sent; its positive control passed. After the fix it passed, and a Family case was added. Existing checkout fixtures now supply the learner lookup. The API and player typechecks passed after building the worktree's core package and restoring the already-declared Capacitor CLI dependency locally.

Final verification completed on 2026-09-15:

- `pnpm run typecheck:api` and `pnpm --filter player-vue typecheck`: passed.
- `pnpm run test:api --maxWorkers=2`: 247 files passed, 7 skipped; 2,717 tests passed, 26 skipped, 10 todo. No estate-wide runner was used.
- `pnpm test:premerge`: passed. API invariants and player invariants passed; changed-file suites passed with 273 API tests and 300 player tests.
- Final Paddle scope: tenant, payer-email and billing-intent addressing, downgrade, plan change and webhook characterisation: 65 passed, 2 todo.
- Final Play publisher and handler tests: 14 passed, including signed OAuth JWTs, authenticated push, package rejection, failed receipts, acknowledgement failure, hold/grace, delayed revocation, pending cancellation and restore ownership.
- The reinstated identity test was red before the production fix and green after; Premium and Family paths passed. The existing family resolver tests passed unchanged.
- Rollback-only SQL canary passed against the shared database. It exercised source migration and preserved RLS, transactional Paddle renewal/failure/refund, separate purchases and resume, paid recovery after refund, Play duplicate/stale events and linked-token ownership, backfill preservation and service-role RPC access. Every canary rolled back.
- `git diff --check`: passed.

No staging playback evidence is claimed. No production code, real billing or persistent database rows were changed.
