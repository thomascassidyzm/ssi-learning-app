-- #857 — SECOND attempt at the production refund hole. Supersedes 20260915d
-- (#851), which is left in place: it is applied, and this file replaces the
-- function it defined rather than reverting it.
--
-- WHY #851 DID NOT CLOSE PRODUCTION. Production runs `main` at ea0683f, which
-- predates the grants ledger. Its resolver, api/_utils/resolveEntitlements.ts,
-- selects `id, access_type, granted_courses, expires_at, redeemed_at,
-- entitlement_code_id` and filters on expires_at ALONE — it never reads
-- revoked_at, and never selects it. #851 stamped revoked_at on the refund
-- signature and left expires_at at the subscription's current_period_end, so a
-- refunded annual learner kept production access for a year. Only expires_at
-- closes production. (dev/staging read starts_at + revoked_at and were closed.)
--
-- WHY THE FOUR-COLUMN EXCLUSIVITY ARGUMENT IS DROPPED. #851 gated on plan_id,
-- plan_name, current_period_end and provider_customer_id all being unchanged
-- from OLD, reasoning that every webhook upsert writes all four. Two refutations,
-- both correct: (i) the held-plan branch of main's subscription.updated handler
-- (main:api/teacher/paddle-webhook.ts:512-525) builds `patch = holdPlan ? base :
-- {...base, plan_name, plan_id}` and omits both plan fields; (ii) comparing OLD
-- with NEW cannot tell you which columns a statement WROTE, only which values
-- CHANGED, so an ordinary write carrying unchanged values is indistinguishable
-- from the refund write by that test. The test is therefore not exclusive and is
-- gone.
--
-- THE SIGNATURE, RE-DERIVED, AND WHY IT IS SAFE. Main's refund/chargeback writer
-- (paddle-webhook.ts:2118-2121) sets status='cancelled', cancel_at_period_end=true.
-- Every other main writer sets status from SUB_STATUS_MAP and
-- cancel_at_period_end from `!!data.scheduledChange`, so the pair can ALSO be
-- produced by one other case: a PAUSED subscription (SUB_STATUS_MAP maps
-- paddle's `paused` to 'cancelled') carrying a scheduled change, e.g. a
-- scheduled resume. That collision is real and is NOT argued away here. It is
-- accepted, because the rule below is justified by CONSEQUENCE rather than by
-- provenance:
--   * main's courseAccess.ts grants the subscription path only when
--     status === 'active', so in the cancelled+pending state main by itself
--     grants NOTHING. Mirroring that state as closed can only ever restore
--     main's own pre-ledger behaviour; it cannot take away access main would
--     have given.
--   * it can therefore never cut off a live payer: the branch is unreachable on
--     status='active'. Live today: 5 active rows with cancel_at_period_end=false
--     and 2 with cancel_at_period_end=true (scheduled cancellations) — all
--     status='active', all untouched.
--   * a PERIOD-END cancellation arrives as cancelled with
--     cancel_at_period_end=false (all twelve live cancelled rows), so paid
--     access to current_period_end is kept, unchanged from #837.
-- The rule is state-based, not transition-based: no OLD, no TG_OP. A row that
-- arrives in that state by INSERT is treated the same as one that reaches it by
-- UPDATE.
--
-- THE DURABLE MARKER. The trigger becomes BEFORE ROW so it can stamp
-- NEW.paddle_revoked_at on the subscriptions row itself. That column exists
-- (20260915_individual_grants_ledger.sql) and main NEVER writes it, so once
-- stamped it survives every later write main makes — including the reverse
-- adjustment's status='active', cancel_at_period_end=false, which is
-- byte-indistinguishable from an ordinary replay and must NOT reopen the grant.
-- CONSEQUENCE, STATED PLAINLY: a refund reversed on production stays CLOSED
-- until main carries dev's writer (which clears paddle_revoked_at explicitly) or
-- an operator reopens it. Fail-closed on money is the deliberate default.
--
-- THE INVARIANT THIS FILE ESTABLISHES, ACROSS ALL THREE WRITERS:
--     while a paddle grant is revoked, its expires_at is clamped to the
--     revocation instant.
-- revoked_at alone is invisible to production; the clamp is what production
-- obeys. #851's ON CONFLICT branch set expires_at = EXCLUDED.expires_at
-- unconditionally, so the next non-past_due write pushed expiry back out to
-- current_period_end and reopened production — that is the replay hole. The two
-- ledger RPCs carry the same hole (refresh_paid_paddle_grant's
-- greatest(expires_at, period_end) and write_additional_paddle_grant's
-- expires_at = EXCLUDED.expires_at), and staging is the only live Paddle webhook
-- destination, so both write to this same shared database. All three are
-- clamped below.
--
-- Fail-soft is preserved: nothing here raises that did not raise before.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.mirror_paddle_individual_grant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_revoked_at timestamptz;
  v_expires_at timestamptz;
BEGIN
  IF NEW.provider <> 'paddle' OR NEW.provider_subscription_id IS NULL THEN RETURN NEW; END IF;

  -- Main's refund/chargeback state (see header). Stamped durably on the row so
  -- no later main write can undo it. Only ever stamped once.
  IF NEW.paddle_revoked_at IS NULL
     AND NEW.status = 'cancelled'
     AND NEW.cancel_at_period_end IS TRUE THEN
    NEW.paddle_revoked_at := now();
  END IF;

  v_revoked_at := CASE
    WHEN NEW.paddle_revoked_at IS NOT NULL THEN NEW.paddle_revoked_at
    WHEN NEW.paddle_status = 'paused' THEN now()
    WHEN NEW.status NOT IN ('active', 'cancelled') THEN now()
    ELSE NULL END;

  -- A missing period must never become a lifetime grant. Historical cancelled
  -- rows without a period end need a provider lookup before they can migrate.
  IF NEW.current_period_end IS NULL THEN
    UPDATE public.user_entitlements
      SET revoked_at = coalesce(v_revoked_at, revoked_at),
          expires_at = CASE WHEN v_revoked_at IS NULL THEN expires_at
                            ELSE least(expires_at, v_revoked_at) END
    WHERE source = 'paddle' AND source_ref = NEW.provider_subscription_id AND learner_id = NEW.learner_id;
    RETURN NEW;
  END IF;

  v_expires_at := CASE WHEN v_revoked_at IS NULL THEN NEW.current_period_end
                       ELSE least(NEW.current_period_end, v_revoked_at) END;

  INSERT INTO public.user_entitlements
    (learner_id, source, source_ref, access_type, granted_courses, starts_at, expires_at, revoked_at)
  VALUES (NEW.learner_id, 'paddle', NEW.provider_subscription_id, 'full', NULL,
    NEW.created_at, v_expires_at, v_revoked_at)
  ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
    -- past_due keeps the learner's existing dates (dunning is not revocation),
    -- but a revoked grant is clamped even then.
    expires_at = CASE
      WHEN v_revoked_at IS NOT NULL THEN least(user_entitlements.expires_at, v_revoked_at)
      WHEN NEW.status = 'past_due' THEN user_entitlements.expires_at
      ELSE EXCLUDED.expires_at END,
    revoked_at = CASE
      WHEN NEW.status = 'past_due' AND NEW.paddle_revoked_at IS NULL THEN user_entitlements.revoked_at
      ELSE EXCLUDED.revoked_at END
  WHERE user_entitlements.learner_id = EXCLUDED.learner_id;
  -- Fail-soft, deliberately (job #837): this mirror is additive and fires on
  -- every subscriptions write, including production's Paddle webhook on main.
  IF NOT FOUND THEN
    RAISE WARNING 'Paddle grant owner mismatch: % retained by its existing owner', NEW.provider_subscription_id;
  END IF;
  RETURN NEW;
END;
$$;

-- AFTER ROW cannot assign NEW. Re-create as BEFORE ROW so the marker lands on
-- the subscriptions row in the same statement. Fires before
-- update_subscriptions_updated_at by name order, which reads nothing we write.
DROP TRIGGER IF EXISTS mirror_paddle_individual_grant ON public.subscriptions;
CREATE TRIGGER mirror_paddle_individual_grant
  BEFORE INSERT OR UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.mirror_paddle_individual_grant();

-- Same invariant in the paid-receipt RPC: a receipt for a period that started
-- BEFORE the revocation must not push expiry back past it. A receipt for a
-- genuinely later period clears the marker first and is unaffected — that is
-- the explicit reversal path and it stays open.
CREATE OR REPLACE FUNCTION public.refresh_paid_paddle_grant(p_subscription_id text, p_period_end timestamptz, p_period_start timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.subscriptions
    WHERE provider = 'paddle' AND provider_subscription_id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_period_end IS NULL THEN RAISE EXCEPTION 'Paid Paddle receipt has no period end'; END IF;
    UPDATE public.user_entitlements SET
      revoked_at = CASE WHEN p_period_start > revoked_at THEN NULL ELSE revoked_at END,
      expires_at = CASE WHEN revoked_at IS NOT NULL AND NOT (p_period_start > revoked_at)
                        THEN least(greatest(expires_at, p_period_end), revoked_at)
                        ELSE greatest(expires_at, p_period_end) END
    WHERE source = 'paddle' AND source_ref = p_subscription_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Paid Paddle grant missing'; END IF;
    RETURN;
  END IF;
  IF s.paddle_revoked_at IS NOT NULL AND p_period_start > s.paddle_revoked_at THEN
    UPDATE public.subscriptions SET paddle_revoked_at = NULL WHERE id = s.id AND paddle_revoked_at = s.paddle_revoked_at;
    s.paddle_revoked_at := NULL;
  END IF;
  IF coalesce(p_period_end, s.current_period_end) IS NULL THEN
    RAISE EXCEPTION 'Paid Paddle receipt has no period end';
  END IF;
  INSERT INTO public.user_entitlements
    (learner_id,source,source_ref,access_type,starts_at,expires_at,revoked_at)
  VALUES (s.learner_id,'paddle',p_subscription_id,'full',s.created_at,
    CASE WHEN s.paddle_revoked_at IS NULL THEN coalesce(p_period_end,s.current_period_end)
         ELSE least(coalesce(p_period_end,s.current_period_end), s.paddle_revoked_at) END,
    s.paddle_revoked_at)
  ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
    expires_at = CASE WHEN s.paddle_revoked_at IS NOT NULL
                      THEN least(greatest(user_entitlements.expires_at, EXCLUDED.expires_at), s.paddle_revoked_at)
                      ELSE greatest(user_entitlements.expires_at, EXCLUDED.expires_at) END,
    revoked_at = CASE WHEN p_period_start > user_entitlements.revoked_at THEN NULL ELSE user_entitlements.revoked_at END
  WHERE user_entitlements.learner_id = EXCLUDED.learner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paddle grant owner mismatch'; END IF;
END;
$$;

-- And in the additional-grant writer, which preserved revoked_at but pushed
-- expires_at out to the incoming value, reopening production on the same row.
CREATE OR REPLACE FUNCTION public.write_additional_paddle_grant(
  p_learner_id uuid, p_ref text, p_starts_at timestamptz, p_expires_at timestamptz, p_status text
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_ref IS NULL OR p_expires_at IS NULL THEN RAISE EXCEPTION 'Incomplete Paddle grant'; END IF;
  INSERT INTO public.user_entitlements
    (learner_id,source,source_ref,access_type,starts_at,expires_at,revoked_at)
  VALUES (p_learner_id,'paddle',p_ref,'full',coalesce(p_starts_at,now()),
    CASE WHEN p_status = 'paused' THEN least(p_expires_at,now()) ELSE p_expires_at END,
    CASE WHEN p_status IN ('active','trialing','canceled','paused') THEN NULL ELSE now() END)
  ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
    expires_at = CASE
      WHEN user_entitlements.revoked_at IS NOT NULL
        THEN least(user_entitlements.expires_at, user_entitlements.revoked_at)
      WHEN p_status = 'past_due' THEN user_entitlements.expires_at
      ELSE EXCLUDED.expires_at END,
    revoked_at = CASE WHEN p_status = 'past_due' THEN user_entitlements.revoked_at
                      ELSE coalesce(user_entitlements.revoked_at,EXCLUDED.revoked_at) END
  WHERE user_entitlements.learner_id = EXCLUDED.learner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paddle grant owner mismatch'; END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
