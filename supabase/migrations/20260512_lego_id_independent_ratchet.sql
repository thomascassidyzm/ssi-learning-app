-- Fix: ratchet highest_completed_lego_id INDEPENDENTLY of round_index.
--
-- The previous version of this trigger (migration
-- 20260504_highest_completed_round_index.sql) ratcheted only on
-- round_index. Whenever round_index advanced, it COPIED the paired
-- last_completed_lego_id into highest_completed_lego_id verbatim:
--
--     IF NEW.last_completed_round_index > prev_high_round THEN
--       NEW.highest_completed_round_index := NEW.last_completed_round_index;
--       NEW.highest_completed_lego_id    := NEW.last_completed_lego_id;
--     END IF;
--
-- This works fine for the main loop: each new round = one new LEGO
-- debut, and lego_id increases monotonically alongside round_index.
--
-- It breaks for infinite-play rounds. Those rounds have NO debut —
-- their primaryLegoKey (which the runtime writes as
-- last_completed_lego_id) is whichever LEGO was drawn FIRST by the
-- random-USE selection. That can be any LEGO in the course (recency-
-- weighted but still essentially arbitrary). So:
--
--   round 622 ("unfriendly" debut)  → ceiling = (622, S0300L02) ✓
--   round 623 (infinite play, random USE drew "longer")
--                                   → ceiling = (623, S0275L01) ✗
--
-- The legoId ceiling regressed even though round_index correctly
-- ratcheted forward. The runtime's "have you reached the end of the
-- course?" check uses the legoId ceiling, so any learner past the
-- main loop was misclassified as still in main-loop territory and
-- got bounced back into LEGO introductions on resume.
--
-- This migration:
--   1. Splits the ratchet into two independent guards — one per
--      ceiling field — so each only lifts when its OWN cursor field
--      advances. Lego_id uses lexicographic comparison, which matches
--      debut order because lego_id is the zero-padded SNNNNLNN format
--      (S0001L01 < S0001L02 < S0002L01 < ... < S0300L02).
--   2. Doesn't touch existing rows. The companion data-repair
--      migration (20260512_repair_broken_lego_id_ceilings.sql) lifts
--      any rows whose lego_id ceiling was already corrupted by the
--      old trigger.

CREATE OR REPLACE FUNCTION ratchet_highest_completed_round()
RETURNS TRIGGER AS $$
DECLARE
  prev_high_round INTEGER;
  prev_high_lego TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    prev_high_round := NULL;
    prev_high_lego := NULL;
  ELSE
    prev_high_round := OLD.highest_completed_round_index;
    prev_high_lego  := OLD.highest_completed_lego_id;
  END IF;

  -- round_index: lift if the cursor moved forward.
  IF NEW.last_completed_round_index IS NOT NULL AND
     (prev_high_round IS NULL OR NEW.last_completed_round_index > prev_high_round) THEN
    NEW.highest_completed_round_index := NEW.last_completed_round_index;
  ELSE
    NEW.highest_completed_round_index := prev_high_round;
  END IF;

  -- lego_id: lift INDEPENDENTLY of round_index. Lexicographic on the
  -- zero-padded SNNNNLNN format. A "backwards" lego_id cursor write
  -- (e.g. an infinite-play round whose primaryLegoKey is an earlier
  -- LEGO) no longer drags the ceiling down with it.
  IF NEW.last_completed_lego_id IS NOT NULL AND
     (prev_high_lego IS NULL OR NEW.last_completed_lego_id > prev_high_lego) THEN
    NEW.highest_completed_lego_id := NEW.last_completed_lego_id;
  ELSE
    NEW.highest_completed_lego_id := prev_high_lego;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger binding is unchanged from the 20260504 migration — the
-- BEFORE INSERT OR UPDATE OF last_completed_round_index OR
-- last_completed_lego_id wiring was already in place.
