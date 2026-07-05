-- Bound the privileged bearer codes (Tom, 2026-07-04: "bind them").
--
-- All four TST-* tester codes and both ssi_admin codes (SSI-GOD-2026,
-- GOD-IMDA) are already is_active=false, but carried max_uses=NULL
-- (unlimited) and expires_at=NULL (never). This pins bounds so a future
-- reactivation can never be unlimited:
--   • tester codes: small headroom over current use + 90-day expiry;
--   • ssi_admin/god codes: no headroom, pinned already-expired.
-- Redeem path blocks when use_count >= max_uses or past expires_at
-- (api/code/redeem.ts), so these bounds bite even if is_active is flipped.
-- New privileged codes are already force-bounded at creation by
-- api/_utils/codeGuard.ts; this covers the legacy rows it predates.

UPDATE public.invite_codes
   SET max_uses = use_count + 5,
       expires_at = now() + interval '90 days'
 WHERE code_type = 'tester'
   AND (max_uses IS NULL OR expires_at IS NULL);

UPDATE public.invite_codes
   SET max_uses = GREATEST(use_count, 1),
       expires_at = now()
 WHERE code_type IN ('ssi_admin', 'god')
   AND (max_uses IS NULL OR expires_at IS NULL);
