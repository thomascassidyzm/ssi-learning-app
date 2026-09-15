-- Expand only: the production deployment still uses the original columns.
BEGIN;
ALTER TABLE public.user_entitlements
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_verified_at timestamptz;

UPDATE public.user_entitlements
SET source = CASE WHEN entitlement_code_id IS NOT NULL THEN 'code'
                  WHEN email_access_grant_id IS NOT NULL THEN 'email_allowlist'
                  ELSE 'gift' END
WHERE source IS NULL;
UPDATE public.user_entitlements SET source_ref = entitlement_code_id::text || ':' || learner_id::text
WHERE source = 'code' AND source_ref IS NULL AND entitlement_code_id IS NOT NULL;
UPDATE public.user_entitlements SET source_ref = email_access_grant_id::text || ':' || learner_id::text
WHERE source = 'email_allowlist' AND source_ref IS NULL AND email_access_grant_id IS NOT NULL;

-- Old production writers must continue to work. Code ids are shared across
-- learners, so a code reference includes the learner id of its redemption.
CREATE OR REPLACE FUNCTION public.stamp_individual_grant_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.source IS NULL THEN
    NEW.source := CASE WHEN NEW.entitlement_code_id IS NOT NULL THEN 'code'
                      WHEN NEW.email_access_grant_id IS NOT NULL THEN 'email_allowlist'
                      ELSE 'gift' END;
  END IF;
  IF NEW.source_ref IS NULL AND NEW.source = 'code' AND NEW.entitlement_code_id IS NOT NULL THEN
    NEW.source_ref := NEW.entitlement_code_id::text || ':' || NEW.learner_id::text;
  ELSIF NEW.source_ref IS NULL AND NEW.source = 'email_allowlist' THEN
    NEW.source_ref := NEW.email_access_grant_id::text || ':' || NEW.learner_id::text;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stamp_individual_grant_source
BEFORE INSERT ON public.user_entitlements
FOR EACH ROW EXECUTE FUNCTION public.stamp_individual_grant_source();
ALTER TABLE public.user_entitlements ADD CONSTRAINT user_entitlements_source_check
CHECK (source IN ('paddle', 'play', 'apple', 'invoice', 'code', 'gift', 'admin', 'email_allowlist'));
CREATE UNIQUE INDEX user_entitlements_source_ref_unique
ON public.user_entitlements(source, source_ref) WHERE source_ref IS NOT NULL;


-- Refunds must differ from cancellation at the paid period end. The old
-- subscription writes stay in place and their trigger writes the grant in
-- the very same transaction. Family resolution keeps its existing behaviour.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paddle_revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS paddle_status text;
CREATE OR REPLACE FUNCTION public.mirror_paddle_individual_grant()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.provider <> 'paddle' OR NEW.provider_subscription_id IS NULL THEN RETURN NEW; END IF;
  -- A missing period must never become a lifetime grant. Historical cancelled
  -- rows without a period end need a provider lookup before they can migrate.
  IF NEW.current_period_end IS NULL THEN
    UPDATE public.user_entitlements SET revoked_at =
      CASE WHEN NEW.paddle_revoked_at IS NOT NULL THEN NEW.paddle_revoked_at
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
  -- A grant already owned by another learner leaves the ledger untouched and
  -- warns; it must never be the reason a real subscriber's renewal fails.
  IF NOT FOUND THEN
    RAISE WARNING 'Paddle grant owner mismatch: % retained by its existing owner', NEW.provider_subscription_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER mirror_paddle_individual_grant
AFTER INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.mirror_paddle_individual_grant();

-- Receipt verification happens before this RPC. Only the service role can
-- call it. The token lock, dedup record and grant change are one transaction.
CREATE OR REPLACE FUNCTION public.apply_play_grant(
  p_learner_id uuid, p_token text, p_starts_at timestamptz, p_expires_at timestamptz,
  p_revoked_at timestamptz, p_observed_at timestamptz, p_event_id text,
  p_linked_token text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE owner_id uuid; prior_verified timestamptz;
BEGIN
  IF p_token IS NULL OR length(p_token) = 0 OR p_starts_at IS NULL OR p_expires_at IS NULL
     OR p_observed_at IS NULL THEN RAISE EXCEPTION 'Incomplete verified purchase'; END IF;
  -- Serialise linked tokens in deterministic order for upgrades and restores.
  PERFORM pg_advisory_xact_lock(hashtextextended(t, 812))
  FROM (SELECT DISTINCT unnest(ARRAY[p_token, p_linked_token]) AS t) tokens
  WHERE t IS NOT NULL ORDER BY t;
  SELECT learner_id, provider_verified_at INTO owner_id, prior_verified
  FROM public.user_entitlements WHERE source = 'play' AND source_ref = p_token FOR UPDATE;
  IF owner_id IS NULL AND p_linked_token IS NOT NULL THEN
    SELECT learner_id INTO owner_id FROM public.user_entitlements
      WHERE source = 'play' AND source_ref = p_linked_token FOR UPDATE;
  END IF;
  owner_id := coalesce(owner_id, p_learner_id);
  IF p_event_id IS NOT NULL THEN
    INSERT INTO public.processed_webhook_events(provider, event_id, event_type)
      VALUES ('play', p_event_id, 'receipt_verified') ON CONFLICT (provider, event_id) DO NOTHING;
    IF NOT FOUND THEN RETURN owner_id; END IF;
  END IF;
  IF prior_verified IS NOT NULL AND prior_verified > p_observed_at THEN RETURN owner_id; END IF;
  INSERT INTO public.user_entitlements
    (learner_id, source, source_ref, access_type, starts_at, expires_at, revoked_at, provider_verified_at)
  VALUES (owner_id, 'play', p_token, 'full', p_starts_at, p_expires_at, p_revoked_at, p_observed_at)
  ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
    starts_at = EXCLUDED.starts_at, expires_at = EXCLUDED.expires_at,
    revoked_at = EXCLUDED.revoked_at, provider_verified_at = EXCLUDED.provider_verified_at;
  IF p_linked_token IS NOT NULL AND p_linked_token <> p_token THEN
    UPDATE public.user_entitlements SET revoked_at = p_observed_at, provider_verified_at = p_observed_at
    WHERE source = 'play' AND source_ref = p_linked_token AND learner_id = owner_id
      AND (provider_verified_at IS NULL OR provider_verified_at <= p_observed_at);
  END IF;
  RETURN owner_id;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_play_grant(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_play_grant(uuid,text,timestamptz,timestamptz,timestamptz,timestamptz,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.backfill_paddle_grants(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE expected jsonb; current_row public.subscriptions%ROWTYPE; n integer := 0;
BEGIN
  FOR expected IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    SELECT * INTO STRICT current_row FROM public.subscriptions
      WHERE id = (expected->>'id')::uuid FOR UPDATE;
    IF to_jsonb(current_row) <> expected THEN RAISE EXCEPTION 'Subscription changed since dry run: %', current_row.id; END IF;
    IF current_row.provider <> 'paddle' OR current_row.status NOT IN ('active', 'cancelled')
       OR current_row.provider_subscription_id IS NULL OR current_row.current_period_end IS NULL THEN
      RAISE EXCEPTION 'Incomplete subscription: %', current_row.id;
    END IF;
    INSERT INTO public.user_entitlements
      (learner_id, source, source_ref, access_type, starts_at, expires_at, revoked_at)
    VALUES (current_row.learner_id, 'paddle', current_row.provider_subscription_id,
      'full', current_row.created_at, current_row.current_period_end,
      CASE WHEN current_row.paddle_revoked_at IS NOT NULL THEN current_row.paddle_revoked_at
           WHEN current_row.paddle_status = 'paused' THEN now() ELSE NULL END)
    ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
    IF FOUND THEN n := n + 1;
    ELSIF NOT EXISTS (SELECT 1 FROM public.user_entitlements WHERE source = 'paddle'
      AND source_ref = current_row.provider_subscription_id AND learner_id = current_row.learner_id) THEN
      RAISE EXCEPTION 'Backfill grant owner mismatch';
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.backfill_paddle_grants(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_paddle_grants(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.refresh_paid_paddle_grant(p_subscription_id text, p_period_end timestamptz, p_period_start timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
DECLARE s public.subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.subscriptions
    WHERE provider = 'paddle' AND provider_subscription_id = p_subscription_id FOR UPDATE;
  IF NOT FOUND THEN
    IF p_period_end IS NULL THEN RAISE EXCEPTION 'Paid Paddle receipt has no period end'; END IF;
    UPDATE public.user_entitlements SET expires_at = greatest(expires_at, p_period_end),
      revoked_at = CASE WHEN p_period_start > revoked_at THEN NULL ELSE revoked_at END
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
    coalesce(p_period_end,s.current_period_end),s.paddle_revoked_at)
  ON CONFLICT (source, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
    expires_at = greatest(user_entitlements.expires_at, EXCLUDED.expires_at),
    revoked_at = CASE WHEN p_period_start > user_entitlements.revoked_at THEN NULL ELSE user_entitlements.revoked_at END
  WHERE user_entitlements.learner_id = EXCLUDED.learner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paddle grant owner mismatch'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_paid_paddle_grant(text,timestamptz,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_paid_paddle_grant(text,timestamptz,timestamptz) TO service_role;
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
    expires_at = CASE WHEN p_status = 'past_due' THEN user_entitlements.expires_at ELSE EXCLUDED.expires_at END,
    revoked_at = CASE WHEN p_status = 'past_due' THEN user_entitlements.revoked_at
                      ELSE coalesce(user_entitlements.revoked_at,EXCLUDED.revoked_at) END
  WHERE user_entitlements.learner_id = EXCLUDED.learner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Paddle grant owner mismatch'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.write_additional_paddle_grant(uuid,text,timestamptz,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.write_additional_paddle_grant(uuid,text,timestamptz,timestamptz,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
