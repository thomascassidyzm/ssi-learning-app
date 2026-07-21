-- Close the invite-redemption duplicate-user_tags race (advisor plan 012).
--
-- The teacher / school_admin_join / student branches of api/code/redeem.ts
-- insert a user_tags row after a check-then-act dedup READ, with no
-- unique-violation backstop. Two concurrent redemptions of the same invite by
-- the same user (multi-tab, or a retry after a timeout — the client
-- single-flight only covers one tab) both pass the dedup read and both insert,
-- producing duplicate ACTIVE SCHOOL:/CLASS: tags. Downstream .single()/count
-- reads over user_tags then error or double-count the member — the same class
-- of bug that produced "3 schools rows for one admin" before the 2026-07-13
-- schools/govt_admins unique indexes landed
-- (20260713_school_admin_unique_natural_key.sql — this file mirrors it).
--
-- The index is PARTIAL on active rows (removed_at IS NULL) — the soft-delete
-- column verified from the codebase (redeem.ts invite path .is('removed_at',
-- null); 20260716b_class_learner_entity.sql ut.removed_at IS NULL). A removed
-- tag must be re-addable later, so removed rows are deliberately excluded from
-- the constraint. The key matches redeem.ts's dedup read exactly
-- (user_id, tag_type, tag_value) — role_in_context is intentionally NOT part of
-- the key, mirroring that read (a user cannot hold two active tags for the same
-- school/class distinguished only by role).
--
-- STEP 1 dedupe MUST precede the CREATE UNIQUE INDEX: the index cannot be
-- created while duplicate active rows exist. Keep the earliest active row per
-- (user_id, tag_type, tag_value) group (lowest added_at, id as tiebreaker) and
-- soft-delete the rest rather than hard-DELETE, preserving provenance
-- (Tom's row-level DB provenance) — the survivor is the authoritative tag.
--
-- ================= NOT YET APPLIED — CANARY REQUIRED =================
-- This migration is UNVERIFIED against the live (shared dev/staging/prod) DB.
-- It MUST go through supabase/secfix-toolkit/'s canary runbook (apply in one
-- txn, replay real redemption queries, assert index holds AND legit
-- redemptions still succeed, COMMIT iff green), staged on `staging` first.
-- A human must first verify against live: (a) no unique index already exists on
-- these columns, (b) the dedupe touches only true duplicates, (c) the
-- removed_at predicate matches live schema. See plan 012 Step 1.
-- =====================================================================

-- Step 1: soft-delete duplicate ACTIVE rows, keeping the earliest per group.
UPDATE public.user_tags AS dup
SET removed_at = now()
WHERE dup.removed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM public.user_tags AS keep
    WHERE keep.removed_at IS NULL
      AND keep.user_id = dup.user_id
      AND keep.tag_type = dup.tag_type
      AND keep.tag_value = dup.tag_value
      AND (keep.added_at, keep.id) < (dup.added_at, dup.id)
  );

-- Step 2: enforce one active tag per (user_id, tag_type, tag_value).
CREATE UNIQUE INDEX IF NOT EXISTS user_tags_active_natural_key
  ON public.user_tags (user_id, tag_type, tag_value)
  WHERE (removed_at IS NULL);

NOTIFY pgrst, 'reload schema';
