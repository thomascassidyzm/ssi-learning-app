-- 20260903_identity_merges.sql
--
-- ██ GATED — PARKED, NOT APPLIED. ██
-- Written on branch india-identity-model as part of the India identity model
-- (docs/identity/india-identity-model-2026-09-03.md §9/§12). dev/staging/prod
-- share ONE database, so this file must be applied deliberately, via the
-- canary method (supabase/secfix-toolkit/), when Tom green-lights the India
-- identity build — exactly the 20260704 gated-migration precedent. Do not
-- auto-apply; do not apply before the endpoints that consume it exist.
--
-- What it creates:
--   [1] identity_merges — the append-only audit ledger for every alias /
--       two-sided alias / merge / legacy landing. The record is sufficient
--       to reconstruct BOTH sides (fromIdentity snapshot + moved-row ids),
--       carries the I4 entitlement-union assertion for the conservation
--       tripwire, and records undo as first-class columns (undo is history,
--       never delete). Shape mirrors api/_utils/identity/mergeAudit.ts,
--       which is the contract until this table exists.
--   [2] learners.previous_user_ids — the auth-uid history column that
--       api/auth/cascade-user-id.ts's own header asks for ("A future
--       'previous_user_id' history column would let us prove the caller
--       once owned old_user_id and tighten more"). Appended on every
--       claim/merge; read by the dead-side tripwire and by cascade-user-id
--       to tighten its orphan guard into a provenance check.
--
-- Posture (CLAUDE.md doctrine 7 — explicit at creation): SERVICE-ROLE-ONLY.
-- Browsers never read or write the merge ledger; every consumer is a server
-- endpoint holding the service key. RLS enabled with no policies = deny-all
-- for anon/authenticated; service_role bypasses RLS by definition.

CREATE TABLE public.identity_merges (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now() NOT NULL,
    kind text NOT NULL
      CONSTRAINT identity_merges_kind_check
      CHECK (kind = ANY (ARRAY['alias', 'two_sided_alias', 'merge', 'legacy_land'])),
    -- auth uid of the session that performed the act (attributability, D9)
    initiated_by_auth_user_id text NOT NULL,
    -- full snapshot of the absorbed side: learner row, verified_emails,
    -- auth uids, anon id, RevenueCat app_user_id, entitlements at merge time
    from_identity jsonb NOT NULL,
    to_learner_id uuid NOT NULL,
    -- per-table arrays of row ids re-pointed — the undo's shopping list
    moved_rows jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- door + address proven, offer-accepted timestamp, corroboration
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- I4: entitlements(A) ∪ entitlements(B), asserted at merge time,
    -- re-checked by the conservation tripwire
    entitlement_union text[] DEFAULT '{}'::text[] NOT NULL,
    undone_at timestamptz,
    undone_by_auth_user_id text,
    undo_of uuid REFERENCES public.identity_merges(id)
);

COMMENT ON TABLE public.identity_merges IS
  'Append-only identity alias/merge audit ledger (India identity model, docs/identity/india-identity-model-2026-09-03.md §9). Every merge is attributable, reconstructable and undoable; undo writes its own row (undo_of) rather than deleting.';

-- Dead-side tripwire lookups: incoming events resolve absorbed identifiers
-- against the ledger.
CREATE INDEX identity_merges_to_learner_idx ON public.identity_merges (to_learner_id);
CREATE INDEX identity_merges_from_identity_gin ON public.identity_merges USING gin (from_identity jsonb_path_ops);

-- Service-role-only posture: RLS on, zero policies (deny-all for client roles).
ALTER TABLE public.identity_merges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.identity_merges FROM anon, authenticated;

-- [2] auth-uid history on learners. TEXT[] holding AUTH UIDS (the login
-- tokens), never learner PKs — the name states the identity per the
-- naming convention (CLAUDE.md, identity rationalisation).
ALTER TABLE public.learners
  ADD COLUMN previous_auth_user_ids text[] DEFAULT '{}'::text[] NOT NULL;

COMMENT ON COLUMN public.learners.previous_auth_user_ids IS
  'Every auth uid this learner row was previously linked to (appended by claim/merge, service-role only). Lets cascade-user-id prove the caller once owned old_user_id, and feeds the dead-side merge tripwire.';

-- Clients may read their own row but never write the history column.
REVOKE INSERT (previous_auth_user_ids), UPDATE (previous_auth_user_ids)
  ON TABLE public.learners FROM authenticated;

NOTIFY pgrst, 'reload schema';
