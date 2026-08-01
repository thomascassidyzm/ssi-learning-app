-- Org trial backfill — start the 30-day clock on orgs that predate it.
--
-- SEPARATE FILE ON PURPOSE. 20260801_org_platform_billing.sql is pure schema
-- and is safe to apply whenever. THIS file writes to live customer rows: it
-- starts a real 30-day countdown on every existing org. Apply it deliberately,
-- when the org lane is ready to be exercised — not as a side effect of taking
-- the columns.
--
-- Without it, an org created before the clock existed sits on a NULL
-- platform_status forever, and isPlatformActive() fails OPEN on NULL — i.e.
-- free forever, and the trial/upgrade path is untestable on it. That is the
-- state the live 'Gwynedd Council' org is in today.
--
-- SCOPE — three deliberate exclusions, each one a way to avoid a phantom clock:
--   1. ROOT nodes only (parent_id IS NULL). A sub-group bills through its org;
--      stamping it would start a second competing clock on the same customer.
--   2. NOT school nodes. `groups` also holds the school NODES minted by
--      20260718_the_model_expand, whose billing lives on their `schools` row.
--   3. Only where platform_status IS NULL, so re-running never shortens a live
--      trial and never downgrades a PAYING org back to 'trial'. Idempotent.
--
-- Test/demo orgs are included by design: they should exercise the same clock
-- the real ones do, which is the whole point of a demo org.

BEGIN;

UPDATE public.groups g
SET platform_status = 'trial',
    platform_expires_at = now() + interval '30 days'
WHERE g.parent_id IS NULL
  AND g.platform_status IS NULL
  AND g.type IS DISTINCT FROM 'school'
  AND NOT EXISTS (
    SELECT 1 FROM public.schools s WHERE s.node_group_id = g.id
  );

COMMIT;
