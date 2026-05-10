-- Drop teachers.student_price_pence
--
-- v2 (20260425) flattened student pricing to a single £10/mo Paddle price.
-- The column has been carried as historical metadata since then but is no
-- longer driven by the teacher and is not read by any code path on signup,
-- profile edit, or /with/:code rendering. Drop it cleanly.
--
-- teacher_referrals.locked_price_pence stays — it's a price snapshot per
-- attribution and is still meaningful as audit context against future
-- price changes.

ALTER TABLE teachers DROP COLUMN IF EXISTS student_price_pence;
