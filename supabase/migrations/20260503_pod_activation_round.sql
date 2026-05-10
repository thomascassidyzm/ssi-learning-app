-- Migration: Add pod_activation_round to course_enrollments
-- Date: 2026-05-03
-- Author: Tom + Claude
--
-- Purpose
-- -------
-- Per-learner pin for the Listening Pods (Layer 2) activation round.
--
-- The script generator's pod scheduling is purely a function of round number:
-- pod-round = main-round - activation + 1, then stage = f(pod-round - entryPodRound + 1).
-- For users who already had progress before pods were enabled (i.e. were past
-- round 6 when pods first appeared), the default activation of R6 means they
-- jump straight into stage 7 (eternal 2× hold) for sentences they've never
-- heard introduced — pedagogically broken.
--
-- This pin lets each enrollment record where pod-round 1 should be for that
-- learner. Set ONCE on first session after pods are visible (write-if-NULL
-- semantics in the player). For new users with current_round ≤ 6 the pin
-- stays NULL and the script generator falls back to the default R6.

ALTER TABLE course_enrollments
  ADD COLUMN IF NOT EXISTS pod_activation_round INT NULL;

COMMENT ON COLUMN course_enrollments.pod_activation_round IS
  'Per-learner pin for Listening Pods (Layer 2) activation round. Set once on first session after pods appear in this course. NULL = use default (R6).';
