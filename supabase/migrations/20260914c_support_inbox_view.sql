-- ONE TABLE TO READ: support_inbox
-- ================================
--
-- Tom's ruling, 2026-09-14 15:01Z (job #677): "are there any messages from
-- anyone yet?" is answered from ONE place. This view unions every in-app door:
--
--   bug_reports          every source (learner, schools_dashboard, tester_widget,
--                        content_flag); delivered_at = posted_at
--   support_messages     inbound only (direction 'in'), joined to the thread's
--                        school or group; delivered_at = answered_at
--   tester_feedback      history: the tester widget's old table (nothing ever
--                        read it); delivered_at is null for all of it
--   content_feedback     history: the old content flag table; delivered_at =
--                        resolved_at. Popty's own presentation-author rows
--                        (user_id 'phase8-presentation-author') are excluded
--                        because they are a pipeline robot, not a person.
--   handbook_questions   the Handbook's "ask" door (api/handbook-questions, on
--                        a branch, table live); delivered_at = answered_at
--
-- Each row carries: door, source, who (account_code, reporter_email, roles),
-- school where relevant, course, build, device, body, created_at and the
-- delivery stamp. For bug_reports the identity columns are the ones stamped
-- at report time, falling back to a live join for rows written before those
-- columns existed; for every other table they are joined NOW from learners and
-- auth.users, which is the best history can do. school_is_test rides along so
-- the watcher can tell a test school's rows from a real one's.
--
-- support_id_for_learner(uuid) is the SQL twin of packages/core's
-- supportIdForLearnerId: the first 40 bits of the learner id in Crockford
-- base32 as XXXX-XXXX, the code Settings shows. The two are asserted equal in
-- api/report/bug.test.ts's fixture by the job that applied this.
--
-- POSTURE: security_invoker on (RLS doctrine rule 5); every underlying table is
-- RLS-on with no policies for anon/authenticated, and the view itself is
-- revoked from both, so only the service role (the one watcher on watson-1)
-- can read it. Nothing is moved, dropped, deleted or updated. Additive only.
--
-- APPLIED 2026-09-14 by job #677 through the postgres role, one transaction.
-- Do not re-apply.

BEGIN;

CREATE OR REPLACE FUNCTION public.support_id_for_learner(l uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN l IS NULL THEN NULL ELSE
    substr(code, 1, 4) || '-' || substr(code, 5)
  END
  FROM (
    SELECT string_agg(
      substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ', ((v >> (5 * (7 - i))) & 31)::int + 1, 1),
      '' ORDER BY i
    ) AS code
    FROM (SELECT ('x' || substr(replace(l::text, '-', ''), 1, 10))::bit(40)::bigint AS v) t,
         generate_series(0, 7) AS i
  ) c
$$;

-- A view's column list cannot be reordered in place, so it is recreated. It
-- has no dependents.
DROP VIEW IF EXISTS public.support_inbox;
CREATE VIEW public.support_inbox
WITH (security_invoker = on) AS
  SELECT
    'bug_report'::text          AS door,
    b.source                    AS source,
    b.id                        AS id,
    b.created_at                AS created_at,
    b.learner_id                AS learner_id,
    COALESCE(b.account_code, public.support_id_for_learner(b.learner_id)) AS account_code,
    COALESCE(b.reporter_email, u.email) AS reporter_email,
    COALESCE(b.platform_role, l.platform_role) AS platform_role,
    COALESCE(b.educational_role, l.educational_role) AS educational_role,
    b.school_role               AS school_role,
    b.school_id                 AS school_id,
    s.school_name               AS school_name,
    s.is_test                   AS school_is_test,
    b.group_id                  AS group_id,
    b.course_code               AS course_code,
    b.app_version               AS build,
    b.deployment_env            AS deployment_env,
    b.device                    AS device,
    b.route                     AS route,
    b.body                      AS body,
    b.context                   AS context,
    b.screenshot_url            AS screenshot_url,
    b.posted_at                 AS delivered_at
  FROM public.bug_reports b
  LEFT JOIN public.schools s ON s.id = b.school_id
  LEFT JOIN public.learners l ON l.id = b.learner_id
  LEFT JOIN auth.users u ON u.id::text = b.auth_user_id

  UNION ALL

  SELECT
    'support_message',
    'support_thread',
    m.id,
    m.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    u.email,
    l.platform_role,
    l.educational_role,
    CASE WHEN t.school_id IS NOT NULL THEN 'school_admin' WHEN t.group_id IS NOT NULL THEN 'govt_admin' END,
    t.school_id,
    s.school_name,
    s.is_test,
    t.group_id,
    NULL,
    m.envelope #>> '{client,build_version}',
    NULL,
    m.envelope #> '{client,device_info}',
    m.envelope #>> '{client,route}',
    m.body,
    m.envelope,
    NULL,
    m.answered_at
  FROM public.support_messages m
  JOIN public.support_threads t ON t.id = m.thread_id
  LEFT JOIN public.schools s ON s.id = t.school_id
  LEFT JOIN public.learners l ON l.user_id = m.author_user_id
  LEFT JOIN auth.users u ON u.id::text = m.author_user_id
  WHERE m.direction = 'in'

  UNION ALL

  SELECT
    'tester_feedback',
    COALESCE(f.feedback_type, 'tester'),
    f.id,
    f.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    u.email,
    l.platform_role,
    l.educational_role,
    NULL, NULL, NULL, NULL, NULL,
    NULL,
    f.build_version,
    NULL,
    f.device_info,
    f.route,
    COALESCE(f.title, '') || CASE WHEN f.description IS NOT NULL AND f.description <> '' THEN E'\n\n' || f.description ELSE '' END,
    NULL,
    f.screenshot_url,
    NULL
  FROM public.tester_feedback f
  LEFT JOIN public.learners l ON l.user_id = f.user_id
  LEFT JOIN auth.users u ON u.id::text = f.user_id

  UNION ALL

  SELECT
    'content_feedback',
    COALESCE(c.feedback_type, 'flag'),
    c.id,
    c.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    u.email,
    l.platform_role,
    l.educational_role,
    NULL, NULL, NULL, NULL, NULL,
    c.course_code,
    NULL,
    NULL,
    NULL,
    NULL,
    COALESCE(c.comment, 'Flagged phrase: "' || COALESCE(c.session_context ->> 'known_text', '?') || '" / "' || COALESCE(c.session_context ->> 'target_text', '?') || '"'),
    c.session_context,
    NULL,
    c.resolved_at
  FROM public.content_feedback c
  LEFT JOIN public.learners l ON l.id::text = c.user_id
  LEFT JOIN auth.users u ON u.id = l.user_id::uuid
  WHERE c.user_id IS DISTINCT FROM 'phase8-presentation-author'

  UNION ALL

  SELECT
    'handbook_question',
    COALESCE(q.persona, 'handbook'),
    q.id,
    q.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    u.email,
    l.platform_role,
    l.educational_role,
    NULL, NULL, NULL, NULL, NULL,
    NULL,
    NULL,
    q.env,
    NULL,
    q.route,
    q.question,
    jsonb_build_object('node_id', q.node_id, 'status', q.status),
    NULL,
    q.answered_at
  FROM public.handbook_questions q
  LEFT JOIN public.learners l ON l.user_id = q.auth_user_id
  LEFT JOIN auth.users u ON u.id::text = q.auth_user_id;

COMMENT ON VIEW public.support_inbox IS
  'One table to read: every in-app door (bug_reports all sources, inbound support_messages, and for history tester_feedback, content_feedback, handbook_questions) with who, school, course, build, device, body and the delivery stamp. Service-role only. Job #677, 2026-09-14.';

REVOKE ALL ON public.support_inbox FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
