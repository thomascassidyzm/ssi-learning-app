-- 20260907_practice_minutes_scope_repoint_revoke.sql
--
-- CLOSES the residual recorded, deliberately, in
-- 20260825_sec25_d02_practice_minutes_gate.sql:
--
--   "a signed-in user can still call the _by_course variant with a learner
--    UUID they already know. Closing that means repointing the schools
--    composables at a server endpoint on the resolveVisibleScope pattern —
--    a separate pass, not this one."
--
-- This is that pass. Reproduced live 2026-09-07 as an ordinary signed-in test
-- learner with no role at all: one call with a stranger's learner UUID
-- returned that person's practice minutes across 33 courses.
--
-- WHY THE FUNCTION IS NOT GATED INTERNALLY. An is_ssi_admin() gate on the
-- named-learner path blanks every scoped dashboard SILENTLY — the
-- silent-empty failure CLAUDE.md's RLS doctrine names, and a worse outcome
-- than the leak because nobody notices. So the browser callers were repointed
-- FIRST, at POST /api/school/practice-by-course, which resolves the caller's
-- visible scope server-side (resolveVisibleScope) and refuses an out-of-scope
-- learner with a LOUD 403. All four are repointed:
--   composables/admin/useAdminCourses.ts        (platform-wide, ssi_admin page)
--   composables/admin/useAdminUserDetail.ts     (one named learner, ssi_admin page)
--   composables/schools/useAnalyticsData.ts     (scoped learner set)
--   views/schools/StudentProgressView.vue       (one learner)
-- and no `.rpc('admin_practice_minutes_by_course'` remains anywhere in
-- packages/player-vue/src.
--
-- ORDER OF OPERATIONS, which is the whole point: this migration is applied
-- ONLY ONCE the repointed client is live in production. A revoke that lands
-- ahead of its callers IS the blanking failure.
--
-- The internal NULL-argument guard from the August pass stays in place as
-- defence in depth; the function body is otherwise untouched.

begin;

revoke all on function public.admin_practice_minutes_by_course(uuid[]) from public;
revoke all on function public.admin_practice_minutes_by_course(uuid[]) from anon;
revoke all on function public.admin_practice_minutes_by_course(uuid[]) from authenticated;
grant execute on function public.admin_practice_minutes_by_course(uuid[]) to service_role;

commit;

notify pgrst, 'reload schema';
