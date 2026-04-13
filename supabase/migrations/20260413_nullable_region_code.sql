-- Make region_code nullable on govt_admins — groups are the primary
-- access mechanism now, region_code is backward compat only.
ALTER TABLE govt_admins ALTER COLUMN region_code DROP NOT NULL;
