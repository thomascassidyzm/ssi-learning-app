-- onboarding_messages — the live source for the onboarding email/in-app series
-- (docs/onboarding/onboarding-series-draft.md). Content as data, editable from
-- /admin/onboarding without a deploy — same idiom as board_snapshots
-- (20260715_board_snapshots.sql): service-role-only table, RLS on with zero
-- policies (deny-by-default for anon/authenticated), all access mediated by
-- api/admin/onboarding-messages.ts (admin-gated). The eventual send system
-- (cron + sender, not yet built) reads this table as its source of truth.
--
-- Table posture at creation (RLS doctrine rule 7, CLAUDE.md): service-role
-- only, per doctrine rule 2 the REVOKE of Supabase's default anon/authenticated
-- grants ships in this same file alongside the GRANT.

CREATE TABLE IF NOT EXISTS public.onboarding_messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_key         text NOT NULL UNIQUE,
    title               text NOT NULL,
    channel             text NOT NULL CHECK (channel IN ('email', 'in_app')),
    subject             text,
    preheader           text,
    body                text NOT NULL,
    trigger_description text NOT NULL,
    notes               text,
    sort_order          integer NOT NULL,
    active              boolean NOT NULL DEFAULT false,
    created_at          timestamp with time zone NOT NULL DEFAULT now(),
    updated_at          timestamp with time zone NOT NULL DEFAULT now(),
    updated_by          text
);

COMMENT ON TABLE public.onboarding_messages IS
  'Live-editable source for the onboarding message series. Service-role-only (RLS on, no policies) — every access goes through api/admin/onboarding-messages.ts (admin-gated). The send system (cron, not yet built) reads this table directly; this IS the copy, not a mirror of it.';
COMMENT ON COLUMN public.onboarding_messages.message_key IS
  'Stable slug used by the (future) send system to look up a message, e.g. verify_email, welcome_day1. Never reused across messages.';
COMMENT ON COLUMN public.onboarding_messages.body IS
  'Markdown. Editor is a textarea + preview — no WYSIWYG dependency.';
COMMENT ON COLUMN public.onboarding_messages.notes IS
  'Design-note asides carried over from the source draft (docs/onboarding/onboarding-series-draft.md) — rationale for future editors, never sent to learners.';
COMMENT ON COLUMN public.onboarding_messages.active IS
  'Whether the send system should consider this message live. Defaults false — nothing sends until the sender/cron pipeline exists regardless of this flag.';
COMMENT ON COLUMN public.onboarding_messages.updated_by IS
  'auth uid (learners.user_id) of the admin who last saved this row.';

CREATE INDEX IF NOT EXISTS idx_onboarding_messages_sort_order ON public.onboarding_messages (sort_order);

ALTER TABLE public.onboarding_messages ENABLE ROW LEVEL SECURITY;
-- Deliberately zero CREATE POLICY statements — deny-by-default for anon/authenticated.

REVOKE ALL ON TABLE public.onboarding_messages FROM anon;
REVOKE ALL ON TABLE public.onboarding_messages FROM authenticated;
GRANT ALL ON TABLE public.onboarding_messages TO service_role;

NOTIFY pgrst, 'reload schema';
