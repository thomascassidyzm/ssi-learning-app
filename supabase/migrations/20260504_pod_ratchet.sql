-- Migration: Pod ratchet — independent counter for Listening Pod (Layer 2) progress
-- Date: 2026-05-04
-- Author: Tom + Claude
--
-- Purpose
-- -------
-- Listening Pods used to be baked into the script with stage progression
-- keyed off main_round - activation + 1. That coupled pod state to main-flow
-- position, which broke under belt-skipping (huge avalanche of pod content)
-- and going-back (pods would re-fire content already heard).
--
-- New model (Option A): pods are an independent track. Pod-round = number of
-- pod laps the learner has actually played to completion + 1. The runtime
-- scheduler (usePodLapScheduler) reads this counter, composes the next lap,
-- plays it, and increments on completion. Skipping a lap leaves the counter
-- unchanged — the listening work has to be done.
--
-- pod_activation_round (added 2026-05-03) still gates the main-round at which
-- pods START FIRING for that user. Stage progression is now decoupled.

ALTER TABLE course_enrollments
  ADD COLUMN IF NOT EXISTS completed_pod_rounds INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN course_enrollments.completed_pod_rounds IS
  'Independent counter for Listening Pods (Layer 2). Increments by 1 each time a pod lap plays to completion. Skipped laps leave it unchanged so the same content plays next session. Course-reset path should set this back to 0 (and pod_activation_round back to NULL).';
