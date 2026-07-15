-- 20260715_possession_mint_attempts.sql
--
-- Possession-based invite onboarding (docs/schools/email-deliverability-plan.md
-- Option A): a new pre-auth endpoint (api/auth/possession-redeem.ts) creates an
-- auth user + mints a session directly from invite-code possession, with no
-- OTP email round-trip (school mail gateways silently swallow our OTP mail).
--
-- This table is BOTH the rate limiter (per-code and per-IP counts over a
-- rolling window, checked before the expensive createUser/generateLink calls)
-- and the audit trail for that endpoint — same "small dedicated audit table"
-- shape as role_change_audit. There is no learner row yet at this point in
-- the flow (the learner is created later, inside api/code/redeem.ts), so
-- player_events (keyed on learner_id) can't carry these events.
--
-- Service-role-only: RLS on with no policies (deny-by-default, per RLS
-- doctrine rule 7 in CLAUDE.md) — the endpoint always writes via the
-- service-role client, which bypasses RLS.

create table if not exists public.possession_mint_attempts (
  id uuid primary key default gen_random_uuid(),
  invite_code_id uuid references public.invite_codes(id) on delete set null,
  email text,
  ip_hash text,
  outcome text not null,
  auth_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_possession_mint_attempts_code_time
  on public.possession_mint_attempts (invite_code_id, created_at desc);
create index if not exists idx_possession_mint_attempts_ip_time
  on public.possession_mint_attempts (ip_hash, created_at desc);

alter table public.possession_mint_attempts enable row level security;
-- No policies authored: deny-by-default for anon/authenticated; service role
-- bypasses RLS entirely, which is the only role that ever touches this table.

notify pgrst, 'reload schema';
