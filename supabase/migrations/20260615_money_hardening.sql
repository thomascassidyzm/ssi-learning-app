-- ============================================================================
-- Money hardening — webhook idempotency, atomic accrual, atomic code claims,
-- and a UNIQUE on teacher_commissions.wise_transfer_id. All additive; handlers
-- fall back / fail open until this is applied. Apply PROMPTLY (see rollout):
-- until it lands, dedup and atomic accrual are BOTH inactive (the pre-migration
-- double-accrue-on-retry window persists).
-- ============================================================================

-- 1. SHARED webhook idempotency ledger (Paddle + Wise). Richer schema (with
--    event_type) so both handlers' inserts succeed; paddle inserts a subset.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL,            -- 'paddle' | 'wise'
  event_id     TEXT NOT NULL,            -- stable per-delivery key (see handlers)
  event_type   TEXT,                     -- audit/debug only; nullable
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);
CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_processed_at
  ON processed_webhook_events(processed_at);
COMMENT ON TABLE processed_webhook_events IS
  'Webhook idempotency ledger. Handlers INSERT (provider, event_id) before side effects; a 23505 on UNIQUE(provider,event_id) = already processed = skip. Degrades: if absent, handlers fail open.';
-- Service-role bypasses RLS; enable RLS with no policy so nothing else touches it.
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- 2. Atomic monthly commission accrual (replaces read-then-write). Conflict-safe
--    on the existing UNIQUE(teacher_id, period_start).
CREATE OR REPLACE FUNCTION public.accrue_teacher_commission(
  p_teacher_id   UUID,
  p_period_start DATE,
  p_period_end   DATE,
  p_pence        INTEGER
) RETURNS VOID
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  INSERT INTO teacher_commissions (teacher_id, period_start, period_end, accrued_pence, status)
  VALUES (p_teacher_id, p_period_start, p_period_end, GREATEST(p_pence, 0), 'accruing')
  ON CONFLICT (teacher_id, period_start) DO UPDATE
    SET accrued_pence = teacher_commissions.accrued_pence + EXCLUDED.accrued_pence,
        updated_at    = NOW();
$function$;
REVOKE EXECUTE ON FUNCTION public.accrue_teacher_commission(UUID, DATE, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.accrue_teacher_commission(UUID, DATE, DATE, INTEGER) TO service_role;

-- 3. Atomic code claims (close the over-redemption race on use_count). One
--    conditional UPDATE: counts a use ONLY if still active/unexpired/under cap.
CREATE OR REPLACE FUNCTION public.claim_invite_code_use(p_id UUID)
RETURNS UUID
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  UPDATE invite_codes
     SET use_count = use_count + 1
   WHERE id = p_id
     AND is_active
     AND (max_uses IS NULL OR use_count < max_uses)
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING id;
$function$;
REVOKE EXECUTE ON FUNCTION public.claim_invite_code_use(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_invite_code_use(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_entitlement_code_use(p_id UUID)
RETURNS UUID
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
  UPDATE entitlement_codes
     SET use_count = use_count + 1
   WHERE id = p_id
     AND is_active
     AND (max_uses IS NULL OR use_count < max_uses)
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING id;
$function$;
REVOKE EXECUTE ON FUNCTION public.claim_entitlement_code_use(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_entitlement_code_use(UUID) TO service_role;

-- 4. One Wise transfer -> exactly one commission row (partial UNIQUE; NULL rows
--    while accruing are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_commissions_wise_transfer_unique
  ON teacher_commissions(wise_transfer_id)
  WHERE wise_transfer_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
