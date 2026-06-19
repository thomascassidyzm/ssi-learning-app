-- 20260619_current_learner_id_bridge.sql
--
-- Identity rationalisation, Phase 0: the ONE auth→learner bridge.
--
-- Two identities exist and both should: auth.uid() (Supabase login token) and
-- learners.id (the canonical identity for all domain data). The recurring
-- confusion came from translating between them ad hoc in many places. This
-- function is the single translation point: auth uid → learner.id.
--
-- learners.user_id is TEXT and holds the auth uid, so we cast auth.uid() to
-- text for the lookup and return the uuid learner PK. STABLE + SECURITY DEFINER
-- so it can be used inside RLS policies without recursing through learners' own
-- policies. Additive — nothing depends on it yet; introduced so future RLS and
-- server resolution use one definition instead of hand-rolled joins.

create or replace function public.current_learner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.learners where user_id = auth.uid()::text limit 1
$$;

grant execute on function public.current_learner_id() to authenticated, anon, service_role;

notify pgrst, 'reload schema';
