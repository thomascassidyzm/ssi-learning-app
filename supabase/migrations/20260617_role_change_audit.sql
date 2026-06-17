-- Role-change audit + admin-grant hardening (2026-06-17)
--
-- Context: platform_role / educational_role could be granted via several paths
-- (admin panel update-user-role, invite codes, entitlement codes, email
-- allowlist) with NO database record of who granted what, when, or how — and
-- with no self-promotion guard. A set of never-expiring, unlimited-use
-- ssi_admin bearer codes (e.g. SSI-GOD-2026) were live in invite_codes.
--
-- This migration adds an append-only audit log. The grant endpoints write to it
-- via the service role (which bypasses RLS); ssi_admins can read it. The
-- self-promotion guard and code expiry/max_uses enforcement live in the API
-- layer (api/admin/update-user-role.ts, api/invite/create.ts,
-- api/entitlement/create.ts) since that is where actor identity is known.

CREATE TABLE IF NOT EXISTS role_change_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  -- WHO made the change (auth uid). null = system / migration.
  actor_user_id      text,
  -- WHOM it was applied to. Both kept because different paths know different
  -- ids: the admin panel has learners.id; code redemption has the auth uid.
  target_learner_id  uuid,
  target_user_id     text,
  -- WHAT changed.
  field              text NOT NULL,   -- 'platform_role' | 'educational_role' | 'dashboard'
  old_value          text,
  new_value          text,
  -- HOW. 'update-user-role' | 'invite-code' | 'entitlement-code' | 'email-allowlist'
  source             text NOT NULL,
  code_used          text,
  detail             jsonb
);

CREATE INDEX IF NOT EXISTS idx_role_change_audit_target_learner ON role_change_audit(target_learner_id);
CREATE INDEX IF NOT EXISTS idx_role_change_audit_target_user   ON role_change_audit(target_user_id);
CREATE INDEX IF NOT EXISTS idx_role_change_audit_actor         ON role_change_audit(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_role_change_audit_occurred      ON role_change_audit(occurred_at DESC);

-- RLS: writes are service-role only (service role bypasses RLS, so no INSERT
-- policy is needed and none is added — clients cannot forge audit rows).
-- Reads are limited to platform admins. Uses the canonical learners subquery
-- (learners.user_id holds the auth uid as TEXT — see CLAUDE.md RLS notes) so it
-- works whether or not the is_ssi_admin() helper is present in this DB.
ALTER TABLE role_change_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_change_audit_admin_read ON role_change_audit;
CREATE POLICY role_change_audit_admin_read ON role_change_audit
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM learners l
      WHERE l.user_id = auth.uid()::text
        AND (l.platform_role = 'ssi_admin' OR l.educational_role = 'god')
    )
  );

NOTIFY pgrst, 'reload schema';
