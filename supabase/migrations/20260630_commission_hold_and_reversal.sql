-- 20260630_commission_hold_and_reversal.sql
--
-- ADDITIVE, fail-safe migration for the Paddle webhook commission rework.
--
-- Tom's decision: a TUTOR student's flat £5 commission is HELD for the 30-day
-- refund window before it can be paid out, and must be REVERSED cleanly if the
-- student is refunded/charged-back while still held (or carried as a clawback if
-- already paid out). This adds the columns + RPCs to support that.
--
-- Everything here is additive and the webhook tolerates its absence (it falls
-- back to the pre-existing read-then-write path / 4-arg accrue RPC), so this can
-- be deployed before OR after the code without breaking live payers.

BEGIN;

-- 1. New columns on the monthly accrual ledger (nullable / defaulted → safe on
--    existing rows).
ALTER TABLE public.teacher_commissions
  ADD COLUMN IF NOT EXISTS hold_until timestamp with time zone;

ALTER TABLE public.teacher_commissions
  ADD COLUMN IF NOT EXISTS clawback_pence integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.teacher_commissions.hold_until IS
  'Earliest payout time for this period''s accrual = latest contributing transaction''s paid_at + 30-day refund window. NULL on legacy rows (treated as already past hold).';
COMMENT ON COLUMN public.teacher_commissions.clawback_pence IS
  'Pence to subtract at payout time for reversals (refund/chargeback) that arrived AFTER the commission was already paid out. Net payable = accrued_pence - clawback_pence.';

-- 2. Allow the new lifecycle statuses. Drop + recreate the CHECK additively so
--    existing values ('accruing'/'pending_payout'/'paid'/'failed') stay valid.
ALTER TABLE public.teacher_commissions
  DROP CONSTRAINT IF EXISTS teacher_commissions_status_check;
ALTER TABLE public.teacher_commissions
  ADD CONSTRAINT teacher_commissions_status_check
  CHECK (status = ANY (ARRAY[
    'accruing'::text,
    'held'::text,
    'pending_payout'::text,
    'paid'::text,
    'failed'::text,
    'reversed'::text
  ]));

-- 3. Held accrual RPC (new 5-arg overload; the legacy 4-arg accrue_teacher_commission
--    is left in place for backward compatibility). Inserts/updates the monthly row
--    with status 'held' and advances hold_until to the latest contributing
--    transaction's window. Never downgrades a row that has already moved past held
--    (paid / pending_payout) — it only bumps accrued_pence in that case.
CREATE OR REPLACE FUNCTION public.accrue_teacher_commission_held(
  p_teacher_id uuid,
  p_period_start date,
  p_period_end date,
  p_pence integer,
  p_hold_until timestamp with time zone
) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO teacher_commissions (teacher_id, period_start, period_end, accrued_pence, status, hold_until)
  VALUES (p_teacher_id, p_period_start, p_period_end, GREATEST(p_pence, 0), 'held', p_hold_until)
  ON CONFLICT (teacher_id, period_start) DO UPDATE
    SET accrued_pence = teacher_commissions.accrued_pence + EXCLUDED.accrued_pence,
        -- keep the row 'held' only while it is still accruing/held; never
        -- resurrect a paid/pending/failed row's status.
        status = CASE
                   WHEN teacher_commissions.status IN ('accruing', 'held') THEN 'held'
                   ELSE teacher_commissions.status
                 END,
        hold_until = GREATEST(
          COALESCE(teacher_commissions.hold_until, EXCLUDED.hold_until),
          EXCLUDED.hold_until
        ),
        updated_at = NOW();
$$;

-- 4. Reversal RPC. If the period is still recoverable (accruing/held) we subtract
--    from accrued_pence (floored at 0, and flipped to 'reversed' if it hits 0).
--    If it was already paid/pending we record the amount as a clawback instead.
CREATE OR REPLACE FUNCTION public.reverse_teacher_commission(
  p_teacher_id uuid,
  p_period_start date,
  p_pence integer
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row teacher_commissions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM teacher_commissions
   WHERE teacher_id = p_teacher_id AND period_start = p_period_start
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN; -- nothing accrued for this period; nothing to reverse
  END IF;

  IF v_row.status IN ('accruing', 'held') THEN
    UPDATE teacher_commissions
       SET accrued_pence = GREATEST(accrued_pence - GREATEST(p_pence, 0), 0),
           status = CASE
                      WHEN GREATEST(accrued_pence - GREATEST(p_pence, 0), 0) = 0 THEN 'reversed'
                      ELSE status
                    END,
           updated_at = NOW()
     WHERE id = v_row.id;
  ELSE
    -- already paid out / pending payout: carry as a clawback against future net.
    UPDATE teacher_commissions
       SET clawback_pence = clawback_pence + GREATEST(p_pence, 0),
           updated_at = NOW()
     WHERE id = v_row.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.accrue_teacher_commission_held(uuid, date, date, integer, timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.accrue_teacher_commission_held(uuid, date, date, integer, timestamp with time zone) TO service_role;
REVOKE ALL ON FUNCTION public.reverse_teacher_commission(uuid, date, integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.reverse_teacher_commission(uuid, date, integer) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
