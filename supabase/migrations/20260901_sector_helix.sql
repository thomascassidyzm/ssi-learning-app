-- THE SECTOR HELIX — the two new tables, additive only.
--
-- Design: ssi-dashboard-v7-clean docs/sector-helix/sector-helix-2026-08-31.md (§5).
-- `course_sectors` is the registry the cross-course union-ZUT gate reads
-- (services/course-builder/lib/course-family.cjs, on main): the gate is armed and
-- inert until a segment is registered here. Schema is verbatim from that repo's
-- tools/union-zut/course_sectors.sql, which this file supersedes as the applied
-- artefact.
--
-- `enrollment_threads` is the per-thread SCHEDULING state and nothing else —
-- cursor, ceiling, cycle index, pod ratchet, plus `active` (the toggle) and
-- `role` (the projection). Ownership is NOT here: ownership is global,
-- content-keyed (lego id), role-free and thread-free, and lives where it already
-- lives (lego_progress, the enrolment's own cursors). No existing learner's row
-- changes at rollout: a learner who never opens the modal has a design-identical
-- experience, byte for byte.
--
-- POSTURE (CLAUDE.md RLS doctrine rule 7 — every new table gets an explicit
-- posture at creation, never Supabase's grant-open default): BOTH tables are
-- SERVICE-ROLE-ONLY. RLS is on with no policies, anon/authenticated are revoked,
-- and every read/write goes through a server endpoint that already holds the
-- service key (api/courses/[code]/sectors.ts, api/me/threads.ts). That is the
-- deliberate alternative to authoring clever policies for a table whose only
-- client is our own server.

BEGIN;

-- ── The registry ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS course_sectors (
  base_course_code    text NOT NULL,
  sector_slug         text NOT NULL,
  sector_course_code  text NOT NULL PRIMARY KEY,
  roles               jsonb NOT NULL DEFAULT '[]'::jsonb,
  role_map            jsonb NOT NULL DEFAULT '{}'::jsonb,
  core_anchor_lego_id text,            -- 'S0040L02' — the core position the segment is authored against
  sector_pod_slug     text,
  status              text NOT NULL DEFAULT 'draft',   -- draft | live
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_course_code, sector_slug)
);

CREATE INDEX IF NOT EXISTS course_sectors_base_idx ON course_sectors (base_course_code);

COMMENT ON TABLE course_sectors IS
  'A sector segment is its own course code but one course to the learner. This table is what makes the course-builder ZUT gate read the whole family (services/course-builder/lib/course-family.cjs) and what bounds the segment''s vocabulary window to the base course up to core_anchor_lego_id.';

-- ── The learner's per-thread scheduling state ──────────────────────────────
CREATE TABLE IF NOT EXISTS enrollment_threads (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id                 uuid NOT NULL REFERENCES course_enrollments(id) ON DELETE CASCADE,
  sector_course_code            text NOT NULL,
  role                          text NOT NULL DEFAULT 'general',
  active                        boolean NOT NULL DEFAULT true,
  last_completed_round_index    integer,
  current_cycle_index           integer NOT NULL DEFAULT 0,
  highest_completed_round_index integer,
  highest_completed_lego_id     text,
  completed_pod_rounds          integer NOT NULL DEFAULT 0,
  pod_activation_round          integer,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, sector_course_code)
);

CREATE INDEX IF NOT EXISTS enrollment_threads_enrollment_idx ON enrollment_threads (enrollment_id);

COMMENT ON TABLE enrollment_threads IS
  'Per-thread SCHEDULING state for the sector helix — cursor, ceiling, cycle index, pod ratchet, plus the active toggle and the role projection. Ownership is deliberately absent: it is global, content-keyed and thread-free. Review needs no state here because spaced repetition is positional within each script, so a parked thread (active=false) resumes intact. The schema allows many rows per enrolment (parked sectors); the player merges core plus exactly one active row.';

-- ── Posture: service-role only, stated in the same file as the revokes ─────
ALTER TABLE course_sectors     ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_threads ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON course_sectors     FROM anon, authenticated;
REVOKE ALL ON enrollment_threads FROM anon, authenticated;

GRANT ALL ON course_sectors     TO service_role;
GRANT ALL ON enrollment_threads TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
