-- Org / workplace platform billing (founder-specced 2026-08-01).
--
-- An "org" is a class-less group node (THE MODEL: groups is the ONE recursive
-- node; `type` is a display label only). Orgs price EXACTLY as schools price
-- teachers: £15/seat/month or £150/seat/year, card upfront via Paddle, seats =
-- the Paddle quantity on a single per-seat price, cancel anytime, access ends
-- at plan end. A new org gets a 30-day all-language trial which converts IN
-- PLACE at upgrade — no re-provisioning, the same row just flips status.
--
-- Shape is deliberately the SAME QUINTET already on `schools`
-- (platform_status / platform_expires_at / seats / provider_*) so the webhook,
-- the gate (api/_utils/platformStatus.isPlatformActive) and the manager UI are
-- one code path with a different table, not a parallel billing system.
--
-- EXPAND-ONLY and idempotent. Every column is nullable with NO default, which
-- matters: `groups` also holds the school NODES (20260718_the_model_expand),
-- whose billing lives on their `schools` row. A DEFAULT 'trial' here would
-- start a phantom second clock on every one of them. NULL = "this node is not
-- a billed org", and isPlatformActive() already fails OPEN on NULL.
--
-- No RLS posture change: `groups` is an existing org table (RLS-off by design
-- until the gated org-RLS pass), and new columns inherit table grants.

BEGIN;

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS platform_status text,
  ADD COLUMN IF NOT EXISTS platform_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS seats integer,
  ADD COLUMN IF NOT EXISTS provider_subscription_id text,
  ADD COLUMN IF NOT EXISTS provider_customer_id text;

-- Same vocabulary as schools_platform_status_check, so the shared gate and the
-- shared status map can never drift apart. NULL stays legal (= not a billed org).
ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_platform_status_check;
ALTER TABLE public.groups ADD CONSTRAINT groups_platform_status_check
  CHECK (platform_status IS NULL OR platform_status = ANY (ARRAY[
    'trial'::text, 'active'::text, 'past_due'::text, 'expired'::text, 'cancelled'::text
  ]));

ALTER TABLE public.groups DROP CONSTRAINT IF EXISTS groups_seats_check;
ALTER TABLE public.groups ADD CONSTRAINT groups_seats_check
  CHECK (seats IS NULL OR seats >= 1);

COMMENT ON COLUMN public.groups.platform_status IS
  'Org platform-subscription lifecycle: trial|active|past_due|expired|cancelled. NULL = not a billed org node (e.g. a school node, whose billing lives on its schools row) — the gate FAILS OPEN on NULL. Gate = active OR (trial AND platform_expires_at > now).';
COMMENT ON COLUMN public.groups.platform_expires_at IS
  'End of the current paid period, or end of the 30-day trial. Set ABSOLUTELY from the Paddle billing period by the webhook (idempotent on retry/out-of-order).';
COMMENT ON COLUMN public.groups.seats IS
  'Paid member seats = Paddle quantity on the per-seat org price (£15/seat/mo, £150/seat/yr). Mirrors schools.teacher_seats.';
COMMENT ON COLUMN public.groups.provider_subscription_id IS
  'Paddle subscription id backing this org. Lookup key for webhook events that carry no custom data (e.g. cancellations raised in Paddle itself).';

-- The webhook resolves an org by subscription id when customData is absent.
CREATE INDEX IF NOT EXISTS idx_groups_provider_subscription_id
  ON public.groups (provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

-- Live-org gate lookups filter on status; tiny partial index keeps them cheap.
CREATE INDEX IF NOT EXISTS idx_groups_platform_status
  ON public.groups (platform_status)
  WHERE platform_status IS NOT NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';
