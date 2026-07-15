-- 20260715b_possession_mint_attempts_error_detail.sql
--
-- Adds the underlying error message to possession_mint_attempts so a
-- mint_failed outcome is diagnosable without a live repro. Prompted by the
-- 2026-07-15 staging incident where GoTrue rejected verifyOtp({email,
-- token_hash}) ("Only the token_hash and type should be provided") — the
-- audit row recorded outcome=mint_failed but nothing about why.

alter table public.possession_mint_attempts
  add column if not exists error_detail text;

notify pgrst, 'reload schema';
