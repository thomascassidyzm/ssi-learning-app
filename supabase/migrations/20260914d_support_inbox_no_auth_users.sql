-- support_inbox WITHOUT auth.users (job #680, fixes job #677)
-- ==========================================================
--
-- 20260914c built public.support_inbox WITH (security_invoker = on) and LEFT
-- JOINed auth.users five times to recover an email for history rows. Under
-- security_invoker the reading role needs SELECT on auth.users, which
-- service_role does not have and must not be given (RLS doctrine rule 6: never
-- reference auth.users; the reason carries from policies to views read through
-- the API). Verified live 15:45Z 2026-09-14: GET /rest/v1/support_inbox with
-- the service-role key returned 403 "permission denied for table users", so
-- nobody could run the "are there any messages?" query.
--
-- This recreates the view with the same columns, the same union shape, the
-- same school_is_test and the same SQL twin of the account code, and NO
-- reference to auth.users. reporter_email now comes from what the rows
-- themselves carry:
--   bug_reports        b.reporter_email (stamped at report time by 20260914b),
--                      else the learner's first verified email
--   support_messages   m.author_name, else the learner's first verified email
--   tester_feedback,
--   content_feedback,
--   handbook_questions the learner's first verified email, else null
-- learners.verified_emails is a public column already joined in every branch.
--
-- POSTURE unchanged: security_invoker on, revoked from anon and authenticated,
-- SELECT granted to service_role. Nothing is moved, dropped, deleted or
-- updated in any table. Additive only.
--
-- APPLIED 2026-09-14 by job #680 through the postgres role, one transaction.
-- Do not re-apply.

BEGIN;

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
    COALESCE(b.reporter_email, l.verified_emails[1]) AS reporter_email,
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

  UNION ALL

  SELECT
    'support_message',
    'support_thread',
    m.id,
    m.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    COALESCE(m.author_name, l.verified_emails[1]),
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
  WHERE m.direction = 'in'

  UNION ALL

  SELECT
    'tester_feedback',
    COALESCE(f.feedback_type, 'tester'),
    f.id,
    f.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    l.verified_emails[1],
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

  UNION ALL

  SELECT
    'content_feedback',
    COALESCE(c.feedback_type, 'flag'),
    c.id,
    c.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    l.verified_emails[1],
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
  WHERE c.user_id IS DISTINCT FROM 'phase8-presentation-author'

  UNION ALL

  SELECT
    'handbook_question',
    COALESCE(q.persona, 'handbook'),
    q.id,
    q.created_at,
    l.id,
    public.support_id_for_learner(l.id),
    l.verified_emails[1],
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
  LEFT JOIN public.learners l ON l.user_id = q.auth_user_id;

COMMENT ON VIEW public.support_inbox IS
  'One table to read: every in-app door (bug_reports all sources, inbound support_messages, and for history tester_feedback, content_feedback, handbook_questions) with who, school, course, build, device, body and the delivery stamp. No auth.users: legacy email comes from support_messages.author_name or learners.verified_emails. Service-role only. Jobs #677/#680, 2026-09-14.';

REVOKE ALL ON public.support_inbox FROM anon, authenticated;
GRANT SELECT ON public.support_inbox TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
