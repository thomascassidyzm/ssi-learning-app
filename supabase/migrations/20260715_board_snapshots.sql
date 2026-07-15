-- board_snapshots — frozen, dated, revocable board reports.
--
-- Living board report spec §5 (docs/board/living-board-report-spec.md):
-- freezing a report resolves every {{metric:...}} token server-side and
-- stores the fully-resolved document as one row, served to the outside
-- world by an unguessable share_code — the proven try-link trust model
-- (capability-by-unguessability, mint-gated, revocable). No board member
-- ever gets live DB access.
--
-- Table posture at creation (RLS doctrine rule 7, CLAUDE.md): service-role
-- only. RLS is enabled with ZERO policies (deny-by-default for anon/
-- authenticated), and — because Supabase's schema-wide default privileges
-- grant ALL on new tables to anon/authenticated as well as service_role —
-- this migration explicitly REVOKEs those default grants in the same file
-- (doctrine rule 2: every REVOKE carries its GRANTs alongside it; here the
-- only GRANT needed is the service_role one, restated for clarity even
-- though it's already implied by the default privileges).
--
-- Both application endpoints use the service-role client and so bypass RLS
-- entirely by design:
--   * api/admin/board-snapshot.ts   — POST freeze / GET list / POST revoke (admin-gated)
--   * api/board/snapshot/[code].ts  — public, single-row lookup by share_code

CREATE TABLE IF NOT EXISTS public.board_snapshots (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    timestamp with time zone NOT NULL DEFAULT now(),
    label         text NOT NULL,
    report_month  text NOT NULL,
    payload       jsonb NOT NULL,
    share_code    text NOT NULL UNIQUE,
    revoked_at    timestamp with time zone,
    created_by    text NOT NULL
);

COMMENT ON TABLE public.board_snapshots IS
  'Frozen, fully-resolved board reports for external sharing. Service-role-only (RLS on, no policies) — every access goes through api/admin/board-snapshot.ts (mint/list/revoke, admin-gated) or api/board/snapshot/[code].ts (public single-row lookup by share_code).';
COMMENT ON COLUMN public.board_snapshots.payload IS
  'Self-contained resolved document: authored markdown + resolved metric values/methods/as-of timestamps at freeze time. The share route renders only this — never a live query.';
COMMENT ON COLUMN public.board_snapshots.share_code IS
  '128-bit random, URL-safe. Not sequential, not derived from label — capability-by-unguessability, same trust model as try_links.code.';
COMMENT ON COLUMN public.board_snapshots.created_by IS
  'auth uid (learners.user_id) of the admin who minted this snapshot.';

CREATE INDEX IF NOT EXISTS idx_board_snapshots_share_code ON public.board_snapshots (share_code);

ALTER TABLE public.board_snapshots ENABLE ROW LEVEL SECURITY;
-- Deliberately zero CREATE POLICY statements — deny-by-default for anon/authenticated.

REVOKE ALL ON TABLE public.board_snapshots FROM anon;
REVOKE ALL ON TABLE public.board_snapshots FROM authenticated;
GRANT ALL ON TABLE public.board_snapshots TO service_role;

NOTIFY pgrst, 'reload schema';
