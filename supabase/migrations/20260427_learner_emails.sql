-- ============================================
-- learner_emails: multi-email per learner
--
-- A single learner can have multiple emails (different OAuth providers,
-- email changes kept on file, manually-added alternates). One row per
-- (learner, email) pair; one row per learner is flagged is_primary.
--
-- Kept in sync via triggers on auth.users, auth.identities, and learners.
-- One-time backfill at the end populates existing rows.
-- Idempotent — safe to run multiple times.
-- ============================================

-- 1. Table
CREATE TABLE IF NOT EXISTS learner_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id UUID NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT,                                 -- 'auth_user', 'google', 'apple', 'manual', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (learner_id, email)
);

CREATE INDEX IF NOT EXISTS idx_learner_emails_learner ON learner_emails(learner_id);
CREATE INDEX IF NOT EXISTS idx_learner_emails_email_lower ON learner_emails(lower(email));
CREATE INDEX IF NOT EXISTS idx_learner_emails_primary ON learner_emails(learner_id) WHERE is_primary;

COMMENT ON TABLE learner_emails IS 'All emails associated with a learner. Synced from auth.users + auth.identities via triggers.';

-- Phase 1 RLS — content/schools tables stay permissive for now
ALTER TABLE learner_emails DISABLE ROW LEVEL SECURITY;

-- 2. Trigger function: sync from auth.users (primary email)
CREATE OR REPLACE FUNCTION sync_learner_email_from_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $sync_user$
DECLARE
  l_id UUID;
BEGIN
  IF NEW.email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO l_id FROM learners WHERE user_id = NEW.id::text;
  IF l_id IS NULL THEN
    RETURN NEW; -- learner not yet created; sync_email_on_learner_insert handles backfill
  END IF;

  -- Demote any other primary first to keep the invariant
  UPDATE learner_emails
  SET is_primary = FALSE, updated_at = NOW()
  WHERE learner_id = l_id AND is_primary AND email != NEW.email;

  -- Upsert as primary
  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  VALUES (l_id, NEW.email, TRUE, NEW.email_confirmed_at IS NOT NULL, 'auth_user')
  ON CONFLICT (learner_id, email) DO UPDATE
  SET is_primary = TRUE,
      verified = NEW.email_confirmed_at IS NOT NULL,
      updated_at = NOW();

  RETURN NEW;
END;
$sync_user$;

DROP TRIGGER IF EXISTS sync_email_on_auth_user ON auth.users;
CREATE TRIGGER sync_email_on_auth_user
AFTER INSERT OR UPDATE OF email, email_confirmed_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION sync_learner_email_from_auth_user();

-- 3. Trigger function: sync from auth.identities (provider emails)
CREATE OR REPLACE FUNCTION sync_learner_email_from_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $sync_identity$
DECLARE
  l_id UUID;
  identity_email TEXT;
BEGIN
  identity_email := NEW.identity_data->>'email';
  IF identity_email IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO l_id FROM learners WHERE user_id = NEW.user_id::text;
  IF l_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  VALUES (l_id, identity_email, FALSE, TRUE, NEW.provider)
  ON CONFLICT (learner_id, email) DO UPDATE
  SET verified = TRUE,
      source = COALESCE(learner_emails.source, NEW.provider),
      updated_at = NOW();

  RETURN NEW;
END;
$sync_identity$;

DROP TRIGGER IF EXISTS sync_email_on_identity ON auth.identities;
CREATE TRIGGER sync_email_on_identity
AFTER INSERT OR UPDATE OF identity_data ON auth.identities
FOR EACH ROW EXECUTE FUNCTION sync_learner_email_from_identity();

-- 4. Trigger function: backfill on new learner row (auth user usually exists first)
CREATE OR REPLACE FUNCTION sync_learner_emails_on_learner_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $sync_learner$
BEGIN
  -- Pull primary email from auth.users
  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  SELECT NEW.id, u.email, TRUE, u.email_confirmed_at IS NOT NULL, 'auth_user'
  FROM auth.users u
  WHERE u.id::text = NEW.user_id AND u.email IS NOT NULL
  ON CONFLICT (learner_id, email) DO NOTHING;

  -- Pull all identity emails (may overlap with primary; ON CONFLICT skips dupes)
  INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
  SELECT NEW.id, i.identity_data->>'email', FALSE, TRUE, i.provider
  FROM auth.identities i
  WHERE i.user_id::text = NEW.user_id
    AND i.identity_data->>'email' IS NOT NULL
  ON CONFLICT (learner_id, email) DO NOTHING;

  RETURN NEW;
END;
$sync_learner$;

DROP TRIGGER IF EXISTS sync_emails_on_learner_insert ON learners;
CREATE TRIGGER sync_emails_on_learner_insert
AFTER INSERT ON learners
FOR EACH ROW EXECUTE FUNCTION sync_learner_emails_on_learner_insert();

-- 5. One-time backfill for existing learners
DO $backfill$
DECLARE
  inserted_primary INTEGER := 0;
  inserted_identity INTEGER := 0;
BEGIN
  -- Primary emails from auth.users
  WITH ins AS (
    INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
    SELECT l.id, u.email, TRUE, u.email_confirmed_at IS NOT NULL, 'auth_user'
    FROM learners l
    JOIN auth.users u ON u.id::text = l.user_id
    WHERE u.email IS NOT NULL
    ON CONFLICT (learner_id, email) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted_primary FROM ins;

  -- Identity emails (non-primary; deduped against above by unique constraint)
  WITH ins AS (
    INSERT INTO learner_emails (learner_id, email, is_primary, verified, source)
    SELECT l.id, i.identity_data->>'email', FALSE, TRUE, i.provider
    FROM learners l
    JOIN auth.identities i ON i.user_id::text = l.user_id
    WHERE i.identity_data->>'email' IS NOT NULL
    ON CONFLICT (learner_id, email) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO inserted_identity FROM ins;

  RAISE NOTICE 'Backfill complete: % primary, % identity emails inserted', inserted_primary, inserted_identity;
END $backfill$;

NOTIFY pgrst, 'reload schema';
