-- ============================================================================
-- offline_leases — server-authoritative record of each learner's offline
-- DOWNLOAD lease, per course. Backs the 30-day "Spotify handshake".
--
-- v1 was stateless (the client held the lease; the server only answered "are you
-- entitled right now?"). This table makes the server the authority, which buys:
--
--   1. REVOCATION kill-switch — a refund/chargeback sets revoked_at and the next
--      online validate locks that download mid-window (v1 could only let it run
--      out the remaining days).
--   2. TRIAL-USED memory — a non-payer's free 30-day taste is recorded here, so
--      wiping IndexedDB + re-downloading does NOT mint a fresh taste.
--
-- Model (see useEntitlement.offlineRenews + reference_ssi_offline_trial_model):
--   - Offline download is open to everyone; the lease governs longevity.
--   - Payer (active sub / full|course entitlement / admin) → lease RENEWS: each
--     online validate slides expires_at = now()+30d, is_trial = false.
--   - Non-payer → a single free 30-day TASTE: is_trial = true; expires_at is set
--     once at first download and NOT slid. Once it lapses the row stays, so a
--     re-download is recognised as trial-used (not a fresh taste).
--   - revoked_at set → locked regardless of expiry.
--
-- All writes go through the service role (api/entitlement/offline-lease.ts). RLS
-- exposes only own-row reads (defense in depth; the client reads via the API).
-- ============================================================================

create table if not exists public.offline_leases (
  id                uuid primary key default gen_random_uuid(),
  learner_id        uuid not null references public.learners(id) on delete cascade,
  course_code       text not null,
  granted_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  last_validated_at timestamptz not null default now(),
  is_trial          boolean     not null default true,
  subscription_id   text,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (learner_id, course_code)
);

create index if not exists offline_leases_learner_idx on public.offline_leases (learner_id);

alter table public.offline_leases enable row level security;

-- Own-row reads only — canonical learner_id → learners.id predicate (CLAUDE.md).
drop policy if exists offline_leases_owner_select on public.offline_leases;
create policy offline_leases_owner_select on public.offline_leases
  for select
  using (learner_id in (select id from public.learners where user_id = auth.uid()::text));

-- ── Revocation kill-switch (manual today; future admin UI) ──────────────────
-- Refund / chargeback → lock this learner's offline downloads on next check:
--   update public.offline_leases set revoked_at = now()
--     where learner_id = '<learner-uuid>';            -- (optionally) and course_code = '<code>';
-- Restore:
--   update public.offline_leases set revoked_at = null where learner_id = '<learner-uuid>';

notify pgrst, 'reload schema';
