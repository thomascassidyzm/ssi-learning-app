-- Production (main, ea0683f) predates the grants ledger. Its refund/chargeback
-- writer sets only `status='cancelled', cancel_at_period_end=true, updated_at`
-- on public.subscriptions; it cannot write paddle_revoked_at, because that
-- column did not exist when main was cut. The #837 mirror trigger therefore
-- read a full refund as an ordinary cancellation and left the grant OPEN until
-- current_period_end — a refunded annual learner keeps access for a year.
-- Confirmed on live rows 2026-09-15 by replaying that exact UPDATE in a rolled
-- back transaction (supabase/secfix-toolkit/canary_851_refund_revokes_grant.cjs).
--
-- The fix teaches the trigger main's refund signature. That signature is
-- distinguishable from every other writer:
--   * only the adjustment refund/chargeback path writes status='cancelled'
--     together with cancel_at_period_end=true in the same statement;
--   * it writes NOTHING else, so plan_id, plan_name, current_period_end and
--     provider_customer_id are all unchanged from OLD — every webhook upsert
--     path writes those four, so requiring them unchanged cannot miss a refund
--     and excludes an ordinary subscription.updated/canceled write;
--   * a period-end cancellation arrives as status='cancelled' with
--     cancel_at_period_end=false and a null current_period_end (all twelve
--     live cancelled rows look exactly like that), so it is untouched and
--     keeps #837's behaviour of access to the paid period end;
--   * the reverse adjustment writes status='active', cancel_at_period_end=false,
--     which clears revoked_at again through the existing CASE. A repeat write
--     on an already-refunded row simply re-stamps revoked_at, which is a no-op.
-- The clamp can only ever fire on a row whose status is NOT 'active', which on
-- main had no access at all before #837, so it cannot cut a live payer off.
-- Fail-soft is preserved: nothing here raises.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.mirror_paddle_individual_grant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE is_provider_revocation boolean;
BEGIN
  IF NEW.provider <> 'paddle' OR NEW.provider_subscription_id IS NULL THEN RETURN NEW; END IF;
  -- Main's refund signature: cancelled + cancel_at_period_end in one UPDATE
  -- that touched no billing column. Treated as a revocation at now().
  is_provider_revocation := TG_OP = 'UPDATE'
    AND NEW.paddle_revoked_at IS NULL
    AND NEW.status = 'cancelled'
    AND NEW.cancel_at_period_end IS TRUE
    AND NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id
    AND NEW.plan_name IS NOT DISTINCT FROM OLD.plan_name
    AND NEW.current_period_end IS NOT DISTINCT FROM OLD.current_period_end
    AND NEW.provider_customer_id IS NOT DISTINCT FROM OLD.provider_customer_id;
  -- A missing period must never become a lifetime grant. Historical cancelled
  -- rows without a period end need a provider lookup before they can migrate.
  IF NEW.current_period_end IS NULL THEN
    UPDATE public.user_entitlements SET revoked_at =
      CASE WHEN NEW.paddle_revoked_at IS NOT NULL THEN NEW.paddle_revoked_at
           WHEN is_provider_revocation THEN now()
           WHEN NEW.paddle_status = 'paused' OR NEW.status = 'none' THEN now()
           ELSE revoked_at END
    WHERE source = 'paddle' AND source_ref = NEW.provider_subscription_id AND learner_id = NEW.learner_id;
    RETURN NEW;
  END IF;
  INSERT INTO public.user_entitlements
    (learner_id, source, source_ref, access_type, granted_courses, starts_at, expires_at, revoked_at)
  VALUES (NEW.learner_id, 'paddle', NEW.provider_subscription_id, 'full', NULL,
    NEW.created_at, NEW.current_period_end,
    CASE WHEN NEW.paddle_revoked_at IS NOT NULL THEN NEW.paddle_revoked_at
         WHEN is_provider_revocation THEN now()
         WHEN NEW.paddle_status = 'paused' THEN now()
         WHEN NEW.status NOT IN ('active', 'cancelled') THEN now() ELSE NULL END)
  ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
    expires_at = CASE WHEN NEW.status = 'past_due' THEN user_entitlements.expires_at
                      ELSE EXCLUDED.expires_at END,
    revoked_at = CASE WHEN NEW.status = 'past_due' AND NEW.paddle_revoked_at IS NULL
                      THEN user_entitlements.revoked_at ELSE EXCLUDED.revoked_at END
  WHERE user_entitlements.learner_id = EXCLUDED.learner_id;
  -- Fail-soft, deliberately (job #837): this mirror is additive and fires on
  -- every subscriptions write, including production's Paddle webhook on main.
  IF NOT FOUND THEN
    RAISE WARNING 'Paddle grant owner mismatch: % retained by its existing owner', NEW.provider_subscription_id;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
