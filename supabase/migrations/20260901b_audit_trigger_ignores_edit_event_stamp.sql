-- 20260901b_audit_trigger_ignores_edit_event_stamp.sql
-- Companion to 20260901_content_edit_identity.sql.
--
-- audit_content_change() writes a full before-image row to content_audit_log
-- whenever an UPDATE OVERWRITES pre-existing non-null editorial data, skipping
-- auto-maintained bookkeeping columns (version, updated_at, created_at).
--
-- last_edit_event_id is exactly that kind of column: it is stamped by the save
-- path, not typed by an editor. Left out of the ignore list it would, from the
-- SECOND stamped save of any row onwards, look like an overwrite of editorial
-- data and pull a whole before-image into a table that already holds 4.0M rows
-- — including for saves that change no content at all (a QA mark-checked, say).
-- Adding it keeps the audit log meaning what it says and costs nothing.
--
-- Body is otherwise byte-identical to the deployed function.

CREATE OR REPLACE FUNCTION public.audit_content_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  pk_val TEXT;
  old_json JSONB;
  new_json JSONB;
  k TEXT;
  has_overwrite BOOLEAN := false;
  -- auto-maintained bookkeeping columns bump on every UPDATE; they are not
  -- editorial content, so changes to them alone must not trigger an audit.
  ignore_cols TEXT[] := ARRAY['version','updated_at','created_at','last_edit_event_id'];
BEGIN
  old_json := to_jsonb(OLD);

  -- Only audit a change that OVERWRITES pre-existing (non-null) editorial data,
  -- or a DELETE. A pure first-fill (changed columns went from NULL/absent to a
  -- value, as in automated course builds writing content for the first time)
  -- carries no rollback value and is skipped.
  IF TG_OP = 'UPDATE' THEN
    new_json := to_jsonb(NEW);
    FOR k IN SELECT jsonb_object_keys(new_json) LOOP
      IF NOT (k = ANY(ignore_cols))
         AND (old_json->k) IS DISTINCT FROM (new_json->k)
         AND (old_json->k) IS NOT NULL
         AND jsonb_typeof(old_json->k) <> 'null' THEN
        has_overwrite := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT has_overwrite THEN
      RETURN NULL;
    END IF;
  END IF;

  pk_val := COALESCE(
    old_json->>'id', old_json->>'course_code', old_json->>'lego_id',
    old_json->>'seed_id', old_json->>'voice_id'
  );

  INSERT INTO content_audit_log (
    table_name, change_type, primary_key, old_row, changed_by_uid
  ) VALUES (
    TG_TABLE_NAME, TG_OP, pk_val, old_json, auth.uid()
  );

  RETURN NULL;
END;
$function$;

COMMENT ON COLUMN public.content_audit_log.changed_by_uid IS
  'auth.uid() at the time of the change. STRUCTURALLY ALWAYS NULL: every writer of course content connects as service_role, where auth.uid() is null. 4,013,923 rows as of 2026-09-01 and not one carries a uid. Editor identity is captured at the application layer instead — see content_edit_events.';
