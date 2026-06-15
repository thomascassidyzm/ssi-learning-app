-- ============================================================================
-- ACCESS: email allowlist (pre-grant) + forgiving codes
-- ============================================================================
-- Two independent improvements to the free-access path, shipped together:
--
--   (A) EMAIL ALLOWLIST / PRE-GRANT — paste emails, those users get free
--       access automatically on sign-in (no code to type). New table
--       email_access_grants, RLS-ON with NO policy (service-role only — nobody
--       can enumerate who's been granted). A grant is applied at most once per
--       learner via a unique (learner_id, email_access_grant_id) index on
--       user_entitlements.
--
--   (B) FORGIVING CODES — a typed code resolves regardless of case, hyphens,
--       or spaces. Achieved with a STORED generated `code_normalized` column on
--       both code tables (upper, alphanumerics only), exposed through the two
--       validation views; the API queries against it.
--
-- DO NOT APPLY AUTOMATICALLY — Tom applies this by hand. Migration file only.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────
-- (B) FORGIVING CODES — normalized columns + indexes + view exposure
-- ─────────────────────────────────────────────────────────────────────────

-- Stored, generated normalized form: uppercase, strip everything non-alnum.
-- So 'ZVK-078', 'zvk-078', 'ZVK 078', 'zvk078' all normalize to 'ZVK078'.
ALTER TABLE entitlement_codes
  ADD COLUMN IF NOT EXISTS code_normalized text
  GENERATED ALWAYS AS (upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))) STORED;

ALTER TABLE invite_codes
  ADD COLUMN IF NOT EXISTS code_normalized text
  GENERATED ALWAYS AS (upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'))) STORED;

-- Plain (NOT unique) indexes for fast lookup. Deliberately non-unique so this
-- migration can't fail if two pre-existing codes happen to collide once
-- normalized (e.g. 'AB-12' vs 'AB12'). Lookups use .maybeSingle()/.single()
-- which surface a duplicate as an error rather than silently picking one.
CREATE INDEX IF NOT EXISTS idx_entitlement_codes_normalized
  ON entitlement_codes (code_normalized);

CREATE INDEX IF NOT EXISTS idx_invite_codes_normalized
  ON invite_codes (code_normalized);

-- Recreate the two validation views to also expose code_normalized.
-- Keep EVERY existing column + the security posture (anon REVOKE is implicit:
-- secfix_12 flipped these to security_invoker=on and only the service role
-- reads them; we keep granting to anon for backwards-compat as the originals
-- did, then leave the secfix lock-down untouched). Re-applying security_invoker
-- after CREATE OR REPLACE because a replace can reset view options.

CREATE OR REPLACE VIEW public.invite_code_validation AS
  SELECT id, code, code_normalized, code_type, grants_region, grants_school_id,
         grants_class_id, metadata, max_uses, use_count, expires_at, is_active
  FROM invite_codes;
ALTER VIEW public.invite_code_validation SET (security_invoker = on);
GRANT SELECT ON public.invite_code_validation TO anon;

CREATE OR REPLACE VIEW public.entitlement_code_validation AS
  SELECT id, code, code_normalized, access_type, granted_courses, duration_type,
         duration_days, label, max_uses, use_count, expires_at, is_active,
         grants_platform_role, grants_dashboard_courses
  FROM entitlement_codes;
ALTER VIEW public.entitlement_code_validation SET (security_invoker = on);
GRANT SELECT ON public.entitlement_code_validation TO anon;


-- ─────────────────────────────────────────────────────────────────────────
-- (A) EMAIL ALLOWLIST / PRE-GRANT — email_access_grants table
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_access_grants (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                     text NOT NULL,
  -- normalized for case-insensitive matching against the verified auth email
  email_normalized          text GENERATED ALWAYS AS (lower(trim(email))) STORED,
  access_type               text NOT NULL DEFAULT 'full',      -- 'full' | 'courses'
  granted_courses           text[],
  duration_type             text DEFAULT 'lifetime',           -- 'lifetime' | 'time_limited'
  duration_days             int,
  grants_platform_role      text,                              -- optional dashboard access
  grants_dashboard_courses  text[],
  label                     text,
  is_active                 boolean DEFAULT true,
  created_by                text,
  created_at                timestamptz DEFAULT now(),
  redeemed_at               timestamptz,
  redeemed_by_learner_id    uuid
);

CREATE INDEX IF NOT EXISTS idx_email_access_grants_email_normalized
  ON email_access_grants (email_normalized);

-- RLS ON with NO policy = deny-all for anon/authenticated. Only the service
-- role (bypassrls) reads/writes this table — via /api/access/* endpoints. This
-- prevents any client from enumerating who has been pre-granted free access.
ALTER TABLE email_access_grants ENABLE ROW LEVEL SECURITY;


-- ─────────────────────────────────────────────────────────────────────────
-- (A) IDEMPOTENCY — link entitlements back to the grant that created them
-- ─────────────────────────────────────────────────────────────────────────

-- Nullable: code-redeemed entitlements leave this NULL; allowlist-applied ones
-- carry the grant id so we apply each grant at most once per learner.
ALTER TABLE user_entitlements
  ADD COLUMN IF NOT EXISTS email_access_grant_id uuid;

-- A grant is applied at most once per learner. Partial so the existing
-- code-entitlement rows (email_access_grant_id IS NULL) are unaffected — a
-- plain unique index would collapse all NULLs incorrectly on some setups; a
-- partial index over the non-null rows is the precise idempotency guard.
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_entitlements_learner_grant
  ON user_entitlements (learner_id, email_access_grant_id)
  WHERE email_access_grant_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────
NOTIFY pgrst, 'reload schema';
