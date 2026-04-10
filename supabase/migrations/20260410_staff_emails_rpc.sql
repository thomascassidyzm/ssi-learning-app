-- RPC to fetch staff (teachers/school_admins) with their emails.
-- Uses SECURITY DEFINER to bypass column-level REVOKE on verified_emails.
-- Only returns staff roles, not students or regular learners.

CREATE OR REPLACE FUNCTION get_staff_with_emails()
RETURNS TABLE (
  user_id TEXT,
  display_name TEXT,
  educational_role TEXT,
  email TEXT
) AS $fn$
  SELECT
    l.user_id,
    l.display_name,
    l.educational_role,
    l.verified_emails[1] AS email
  FROM learners l
  WHERE l.educational_role IN ('teacher', 'school_admin', 'govt_admin')
  ORDER BY l.display_name;
$fn$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMENT ON FUNCTION get_staff_with_emails() IS 'Returns staff members with their primary email. SECURITY DEFINER bypasses verified_emails column revoke.';
