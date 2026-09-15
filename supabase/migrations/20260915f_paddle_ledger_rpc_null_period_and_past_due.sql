-- #879 — two defects in the three Paddle grant writers installed by #857
-- (20260915e), found by Astra's cold-verify of that job. This file replaces the
-- three function bodies; the trigger DEFINITION, the refund signature and the
-- fail-closed reversal rule of #857 are UNCHANGED and are not reopened here.
-- No DROP/CREATE TRIGGER: pg_get_triggerdef must read identically after this.
--
-- DEFECT 1 — A REVOKED GRANT REOPENED WHEN p_period_start WAS NULL.
-- refresh_paid_paddle_grant's no-subscription-row branch guarded the clamp with
--     revoked_at IS NOT NULL AND NOT (p_period_start > revoked_at)
-- With p_period_start NULL that comparison is NULL, NOT NULL is NULL, and
-- `true AND NULL` is NULL, so the CASE fell through to its ELSE and pushed
-- expires_at out to the incoming period end while revoked_at stayed set.
-- Evaluated read-only against the live definition before this change: revoked_at
-- 2026-09-15, incoming period end 2027-09-15, result expires_at 2027-09-15 with
-- revoked_at 2026-09-15 retained. Production reads expires_at ALONE
-- (main:api/_utils/resolveEntitlements.ts), so that is a year of paid access for
-- a refunded learner, restored by an ordinary receipt or a replay.
-- Both live callers can supply NULL: api/teacher/paddle-webhook.ts:1788 and
-- :1799 both pass `p_period_start: data.billingPeriod?.startsAt || null`, so the
-- NULL branch is not hypothetical.
--
-- THE THREE-VALUED-LOGIC RULE ADOPTED, EVERYWHERE IN THIS FILE.
--     An unknown comparison never decides to reopen.
-- Every "is this period provably later than the revocation?" test is now written
-- coalesce(<comparison>, false). A NULL period start means NOT PROVEN LATER, so
-- the clamp applies and the marker is kept. The reversal path is unaffected: a
-- receipt that genuinely carries a later period start still clears the marker
-- and still reopens. This is applied to all four such tests, including the two
-- that were already safe by accident, so no reader has to re-derive it.
--
-- DEFECT 1b — THE CLAMP READ ONLY ONE OF THE TWO REVOCATION MARKERS.
-- refresh_paid_paddle_grant's ON CONFLICT branch clamped against
-- s.paddle_revoked_at only. A grant row can carry revoked_at with the
-- subscription row carrying no paddle_revoked_at — write_additional_paddle_grant
-- stamps exactly that, and a subscription row may not exist at all. In that
-- state greatest(...) pushed expiry out with revoked_at retained: the same
-- contradictory, production-open row as defect 1. The clamp now reads
-- coalesce(user_entitlements.revoked_at, s.paddle_revoked_at) — whichever marker
-- is set — and stamps revoked_at to match, so the row can no longer be
-- self-contradictory. This is strictly additive: it can only keep or add a
-- revocation, never remove one #857 would have kept.
--
-- DEFECT 2 — past_due DID THE OPPOSITE OF WHAT ITS OWN COMMENT PROMISED.
-- #857's comment says "past_due keeps the learner's existing dates (dunning is
-- not revocation)". The code revoked instead, in three places:
--   * the trigger's v_revoked_at took `NEW.status NOT IN ('active','cancelled')
--     THEN now()`, which includes past_due, so the past_due arms further down
--     were unreachable and expires_at was clamped to now() immediately, on the
--     INSERT path and on the NULL-period UPDATE path alike. Evaluated read-only
--     before this change: status past_due, no markers, period end 2027-09-15 →
--     v_revoked_at now(), v_expires_at now().
--   * write_additional_paddle_grant's INSERT set revoked_at = now() for any
--     status outside ('active','trialing','canceled','paused') — past_due —
--     BESIDE the future p_expires_at it was inserting. Evaluated read-only:
--     expires_at 2027-09-15 with revoked_at now(). That row is contradictory on
--     its face, and production (expiry only) and dev (revoked_at) read it
--     differently.
-- CODE MOVED, NOT THE COMMENT. The stated intent is the correct one and is now
-- what executes: paid dates are kept through Paddle's dunning retries.
-- Revocation happens on refund or chargeback (the durable paddle_revoked_at
-- marker of #857) or on final cancellation, never on a failed retry. A live
-- payer in dunning keeps access. Two comments in #857's bodies described the
-- unreachable arms and have been rewritten where the arms became reachable.
--
-- STATUS VOCABULARY, CHECKED AGAINST THE CALLERS.
-- The trigger reads subscriptions.status, our own enum (active | past_due |
-- cancelled | none, per SUB_STATUS_MAP at paddle-webhook.ts:75).
-- write_additional_paddle_grant's p_status is Paddle's RAW vocabulary: its
-- caller at paddle-webhook.ts:1212 passes `p_status: data.status` straight from
-- the webhook payload, which is why that function tests 'canceled' with one L
-- and 'trialing'. Both vocabularies spell past_due identically, so the fix keys
-- on the same literal in both places and no translation is introduced.
-- refresh_paid_paddle_grant reads no status at all: it fires on a PAID receipt,
-- where money has actually arrived, so extending on it is correct and past_due
-- does not arise. Unchanged in that respect.
--
-- THE FALLBACK STATUS 'none' IS DELIBERATELY LEFT REVOKED-NOW in the trigger.
-- Main's resolver grants the subscription path only on status === 'active', so
-- 'none' grants nothing there either; closing it mirrors main rather than
-- overriding it.
--
-- OBSERVED AND DELIBERATELY NOT CHANGED, so the next reader does not think it
-- was missed: write_additional_paddle_grant clamps expires_at to now() for
-- 'paused' on INSERT but not on ON CONFLICT, where paused falls through to
-- EXCLUDED.expires_at. That is an inconsistency of #857, it is not one of the
-- two defects this file was commissioned for, it does not reopen a REVOKED
-- grant, and widening into it here would put an unreviewed access change on the
-- money path. Logged for a later decision.
--
-- THE INVARIANT OF #857 IS UNCHANGED AND NOW HOLDS UNCONDITIONALLY:
--     while a paddle grant is revoked, its expires_at is clamped to the
--     revocation instant.
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

  -- Main's refund/chargeback state (see #857's header). Stamped durably on the
  -- row so no later main write can undo it. Only ever stamped once.
  IF NEW.paddle_revoked_at IS NULL
     AND NEW.status = 'cancelled'
     AND NEW.cancel_at_period_end IS TRUE THEN
    NEW.paddle_revoked_at := now();
  END IF;

  -- past_due is DUNNING, not revocation (#879): a failed retry must not revoke,
  -- and must not clamp. A durable refund marker still wins over it, and so does
  -- an explicitly paused subscription. The fallback status 'none' stays
  -- revoked-now, mirroring main's own status === 'active' gate.
  v_revoked_at := CASE
    WHEN NEW.paddle_revoked_at IS NOT NULL THEN NEW.paddle_revoked_at
    WHEN NEW.paddle_status = 'paused' THEN now()
    WHEN NEW.status = 'past_due' THEN NULL
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
    -- past_due keeps the learner's existing dates: neither extended nor cut
    -- short by a dunning retry. A revoked grant is still clamped even then.
    expires_at = CASE
      WHEN v_revoked_at IS NOT NULL THEN least(user_entitlements.expires_at, v_revoked_at)
      WHEN NEW.status = 'past_due' THEN user_entitlements.expires_at
      ELSE EXCLUDED.expires_at END,
    -- past_due leaves an existing revocation exactly as it found it: it can
    -- neither create one nor clear one.
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

-- Trigger definition intentionally NOT re-created: #857's BEFORE INSERT OR
-- UPDATE FOR EACH ROW binding is correct and pg_get_triggerdef is unchanged.

CREATE OR REPLACE FUNCTION public.refresh_paid_paddle_grant(p_subscription_id text, p_period_end timestamptz, p_period_start timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.subscriptions
    WHERE provider = 'paddle' AND provider_subscription_id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_period_end IS NULL THEN RAISE EXCEPTION 'Paid Paddle receipt has no period end'; END IF;
    -- #879: coalesce(..., false) so a NULL p_period_start reads as NOT PROVEN
    -- LATER than the revocation, keeps the marker, and applies the clamp.
    UPDATE public.user_entitlements SET
      revoked_at = CASE WHEN coalesce(p_period_start > revoked_at, false) THEN NULL ELSE revoked_at END,
      expires_at = CASE WHEN revoked_at IS NOT NULL AND NOT coalesce(p_period_start > revoked_at, false)
                        THEN least(greatest(expires_at, p_period_end), revoked_at)
                        ELSE greatest(expires_at, p_period_end) END
    WHERE source = 'paddle' AND source_ref = p_subscription_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Paid Paddle grant missing'; END IF;
    RETURN;
  END IF;
  -- Explicit reversal: only a receipt PROVABLY for a later period clears the
  -- durable marker. NULL reads as unproven and leaves it standing (#879).
  IF s.paddle_revoked_at IS NOT NULL AND coalesce(p_period_start > s.paddle_revoked_at, false) THEN
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
    -- #879 defect 1b: clamp against WHICHEVER marker is set — the grant row's
    -- own revoked_at or the subscription's paddle_revoked_at — not just the
    -- latter, and only reopen on a PROVABLY later period start.
    expires_at = CASE
      WHEN coalesce(p_period_start > coalesce(user_entitlements.revoked_at, s.paddle_revoked_at), false)
        THEN greatest(user_entitlements.expires_at, EXCLUDED.expires_at)
      WHEN coalesce(user_entitlements.revoked_at, s.paddle_revoked_at) IS NOT NULL
        THEN least(greatest(user_entitlements.expires_at, EXCLUDED.expires_at),
                   coalesce(user_entitlements.revoked_at, s.paddle_revoked_at))
      ELSE greatest(user_entitlements.expires_at, EXCLUDED.expires_at) END,
    -- and stamp the marker the clamp was taken from, so the row can never be
    -- expiry-clamped-but-unrevoked or revoked-but-open.
    revoked_at = CASE
      WHEN coalesce(p_period_start > coalesce(user_entitlements.revoked_at, s.paddle_revoked_at), false) THEN NULL
      ELSE coalesce(user_entitlements.revoked_at, s.paddle_revoked_at) END
  WHERE user_entitlements.learner_id = EXCLUDED.learner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paddle grant owner mismatch'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_additional_paddle_grant(
  p_learner_id uuid, p_ref text, p_starts_at timestamptz, p_expires_at timestamptz, p_status text
) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_ref IS NULL OR p_expires_at IS NULL THEN RAISE EXCEPTION 'Incomplete Paddle grant'; END IF;
  INSERT INTO public.user_entitlements
    (learner_id,source,source_ref,access_type,starts_at,expires_at,revoked_at)
  VALUES (p_learner_id,'paddle',p_ref,'full',coalesce(p_starts_at,now()),
    CASE WHEN p_status = 'paused' THEN least(p_expires_at,now()) ELSE p_expires_at END,
    -- p_status is Paddle's RAW vocabulary (paddle-webhook.ts:1212 passes
    -- data.status straight through), hence 'canceled' with one L. #879:
    -- past_due joins the non-revoking list — a failed retry is dunning, and
    -- inserting revoked_at = now() beside a future p_expires_at produced a row
    -- production and dev read differently.
    CASE WHEN p_status IN ('active','trialing','canceled','paused','past_due') THEN NULL ELSE now() END)
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
