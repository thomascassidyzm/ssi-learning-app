-- is_test flag for schools/groups — SEPARATE axis from is_demo.
--
-- is_demo = synthetic seeded data (fake-schools-with-real-data, IME demo
--   estate) written by a seeding script for a demo dataset.
-- is_test = ANY school/group that is not a genuine paying/pilot customer —
--   soak-test creations, E2E test fixtures, owner test accounts, etc. This is
--   a SUPERSET of is_demo: every is_demo=true row is also is_test=true, but
--   most is_test rows were never seeded as "demo data" — they're real signups
--   Tom or an agent made while testing the onboarding/schools flow.
--
-- Board metrics must count neither. schools.total switches from is_demo to
-- is_test (see api/_utils/boardMetrics.ts) because is_demo alone undercounts
-- test schools by 11/17 — every currently-existing school is test data; there
-- is no real pilot school yet (2026-07-15 board correction).
--
-- Data migration below flags the 17 schools / 8 groups that exist today, by
-- exact id, as verified live against the DB on 2026-07-15. New test schools
-- going forward should be flagged at creation time by whatever admin/demo
-- script creates them (see api/admin/act-as scripts).

ALTER TABLE schools ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN schools.is_test IS
  'Not a genuine paying/pilot customer — soak-test/E2E/owner-test school. Superset of is_demo (seeded demo data). Board metrics (schools.total) exclude is_test, never is_demo alone.';
COMMENT ON COLUMN groups.is_test IS
  'Not a genuine paying/pilot customer — soak-test/E2E/owner-test group. Superset of is_demo.';

UPDATE schools SET is_test = true WHERE id IN (
  '3978af23-19ef-4cf9-ab94-0e716e64a6ed', -- Gaelscoil na Mara (is_demo)
  'cc0ba726-942b-474c-9037-735008529a45', -- Sakura International School (is_demo)
  '38f85a1e-814f-49de-8452-e676555e5dbf', -- Ysgol Gynradd y Garn (is_demo)
  'b50c8ecb-b3d2-4155-9b81-0406678f6746', -- 日本-001
  'fc81a15f-88b3-4e46-8f50-c84a1a536e6b', -- Aran's Irish School
  '440bd184-9877-429e-930d-44852ff2541d', -- Salesian College
  '46b5aaec-34c2-4437-b480-d45408827716', -- Salesian-2
  '096438ed-b3a1-4579-b33d-895f3fcda1fb', -- E2E School 1783958726227
  '3429994d-2f2a-4725-8e47-8abe63e4e7f7', -- Tom School 001
  '59ec8b40-62aa-4640-be79-e88cfcefa368', -- Gwynedd School 001
  '23348bd3-41e4-40dd-9a01-c0a9d87bf4c7', -- Gwynedd School 002
  'f13777bd-204a-4b85-a617-9bc206ae7713', -- Gwynedd School 003
  '030256f0-8fa6-4570-a3f8-b3f5dab3a9ae', -- Bangor 001
  '2fd27c83-936f-4810-a88b-7d7b32315cee', -- Sunrise Public School, Pune (is_demo)
  '08ae8828-8ee3-48d9-8443-00d8f815b8ec', -- St. Mary's Academy, Kochi (is_demo)
  'df9a7eb0-2236-4d79-861d-b4784ccea1b4', -- Green Valley International, Jaipur (is_demo)
  'eae2749f-6682-4090-a8c8-53977dc887a3'   -- Python 001
);

UPDATE groups SET is_test = true WHERE id IN (
  '2a0fdb87-1239-435d-b327-0519e1d92598', -- Gaelscoileanna Píolótach (is_demo)
  'a79cc097-4613-4cd7-b394-171f123645c3', -- Tom Test Group
  'ceee815a-462c-4652-a781-5a62c7be6210', -- E2E Region 1783958726227 (renamed)
  'ba23682c-6de8-4981-b479-258c4499adf4', -- Tom Test Group
  'c7db460c-75a8-48d2-8de7-1278449c88c8', -- Gwynedd Ed Test
  '0fe746e0-a355-4cfd-8eb0-2dfef711abd6', -- Bangor
  '2d98bc20-a9c7-4fed-b69a-aa64038ded2a', -- IME Demo Programme (is_demo)
  '903dad89-3382-42c6-b595-3932bc4b0f3a'   -- Python Community District
);

NOTIFY pgrst, 'reload schema';
