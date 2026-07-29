-- ⚠️ ALREADY APPLIED — DO NOT RE-APPLY. Retroactive record only.
--
-- family_members (FAMILY-PLAN-SPEC.md §1) was hand-applied to the live DB on
-- 2026-07-10 during the impl/family-plan branch authoring, with no migration
-- file committed anywhere. The live schema is truth (it's in schema.sql via
-- the 2026-07-13 snapshot, commit fc502ee8); this file exists so the
-- migrations dir tells the truth about how the table got there
-- (family-plan design pack §1.1, stage 1 hygiene item).
--
-- Posture (CLAUDE.md rule 7): RLS ON, ZERO policies — service-role-only; all
-- access via the /api/family/* endpoints ("hierarchy authz = endpoints"
-- doctrine). Supabase's grant-open creation default (ALL to anon +
-- authenticated) was revoked in a second pass the same day, leaving only
-- owner + service_role — see docs/DECISIONS.md 2026-07-10.
--
-- Semantics: the family umbrella IS the payer's subscriptions row
-- (plan_name = 'SSi Family'); this table is the only new data surface.
-- Removal is a stamp (removed_at + status='removed'), never a delete.
-- One live family per member (partial unique index); invites dedupe per
-- owner+email while live.

CREATE TABLE public.family_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_learner_id uuid NOT NULL,
    member_learner_id uuid,
    invited_email text,
    is_child_account boolean DEFAULT false NOT NULL,
    status text DEFAULT 'invited'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    removed_at timestamp with time zone,
    CONSTRAINT family_members_pkey PRIMARY KEY (id),
    CONSTRAINT family_members_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text, 'removed'::text]))),
    CONSTRAINT family_members_owner_learner_id_fkey FOREIGN KEY (owner_learner_id) REFERENCES public.learners(id),
    CONSTRAINT family_members_member_learner_id_fkey FOREIGN KEY (member_learner_id) REFERENCES public.learners(id)
);

COMMENT ON TABLE public.family_members IS 'SSi Family plan membership (FAMILY-PLAN-SPEC.md). The umbrella IS the payer''s subscriptions row (plan_name = ''SSi Family''); this table is the only new data surface. RLS ON, no policies — service-role-only, all access via /api/family/* endpoints (CLAUDE.md rule 7 posture + the "hierarchy authz = endpoints" doctrine). Removal is a stamp (removed_at + status=''removed''), never a delete.';

CREATE UNIQUE INDEX family_members_invite_dedupe ON public.family_members USING btree (owner_learner_id, invited_email) WHERE ((removed_at IS NULL) AND (invited_email IS NOT NULL));
CREATE UNIQUE INDEX family_members_one_family ON public.family_members USING btree (member_learner_id) WHERE ((removed_at IS NULL) AND (member_learner_id IS NOT NULL));
CREATE INDEX family_members_owner_idx ON public.family_members USING btree (owner_learner_id);

ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- Explicit posture, both layers: revoke the grant-open creation default so
-- only owner + service_role hold any privilege (DECISIONS.md 2026-07-10).
REVOKE ALL ON TABLE public.family_members FROM anon, authenticated;
GRANT ALL ON TABLE public.family_members TO service_role;

NOTIFY pgrst, 'reload schema';
