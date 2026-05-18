-- Brain view: precomputed 2D positions for every LEGO in a course.
--
-- Populated by scripts/precompute-lego-positions.cjs (in ssi-dashboard-v7-clean),
-- which runs a D3 force simulation over structural edges and writes the final
-- coordinates here. The learning app reads from this table at runtime — no
-- physics in the browser.
--
-- Composite PK on (course_code, lego_id) so re-running the precompute simply
-- updates each row in place.

BEGIN;

CREATE TABLE IF NOT EXISTS course_lego_positions (
  course_code text NOT NULL,
  lego_id     text NOT NULL,
  x           real NOT NULL,
  y           real NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_code, lego_id)
);

COMMIT;

NOTIFY pgrst, 'reload schema';
