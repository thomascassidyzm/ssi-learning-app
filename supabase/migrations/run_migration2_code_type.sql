ALTER TABLE invite_codes DROP CONSTRAINT IF EXISTS invite_codes_code_type_check;
ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_code_type_check CHECK (code_type IN ('ssi_admin', 'god', 'govt_admin', 'school_admin', 'teacher', 'student'));
