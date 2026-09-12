-- is_govt_admin_over_group(): the subtree is parent_id, never the slug path
-- ========================================================================
--
-- SEC0912-A-01 (job #297, confirmed live by job #299, fixed by job #300).
-- The predicate behind four live SELECT policies — schools_select_admin_subtree,
-- classes_select_admin_subtree, support_threads_own_read,
-- support_messages_own_read — decided "is this group under mine?" by comparing
-- `groups.path` strings. `path` is derived from the NAME by compute_group_path()
-- and nothing makes it unique: live today, eight root orgs share `my-school`,
-- two share `rogiet-primary-school`, two share `ysgol-gyfun-tredegar`. A
-- govt_admin of one would satisfy the predicate for the other. The 2026-08-25
-- audit (TENANCY-02/04/05) repointed every TypeScript copy of this rule at
-- parent_id (api/_utils/groupSubtree.ts); the fix stopped at the language
-- boundary. This carries it across.
--
-- The rewrite walks UP from the target through parent_id and asks whether any
-- ancestor (the target itself included) is a group this user governs. Walking
-- up is a single chain, so the cost per RLS row test is O(depth) — the live
-- forest is 3 deep — rather than the size of the admin's subtree. A depth cap
-- guards a corrupt parent chain, as descendantIds() guards a cycle.
--
-- Same signature, same STABLE SECURITY DEFINER, same search_path;
-- CREATE OR REPLACE keeps the function's ACL (anon/authenticated/service_role
-- EXECUTE) exactly as it was, and the canary asserts that.
--
-- groups.path itself is untouched: it is still the display breadcrumb and the
-- client's own group-subtree lookups still read it (a separate follow-up —
-- packages/player-vue/src/composables/schools/useClassesData.ts). What changes
-- here is that no ROW POLICY decides on it any more.
--
-- Canary: supabase/secfix-toolkit/canary_20260912_support_grant_and_govt_subtree.cjs
-- Applied live 2026-09-12 (job #300), canary style, one transaction.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_govt_admin_over_group(target_group_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  WITH RECURSIVE lineage AS (
    -- The target group itself…
    SELECT g.id, g.parent_id, 0 AS depth
    FROM public.groups g
    WHERE g.id = target_group_id
    UNION ALL
    -- …and each ancestor in turn, by parent_id — never by the slug path.
    SELECT g.id, g.parent_id, l.depth + 1
    FROM public.groups g
    JOIN lineage l ON g.id = l.parent_id
    WHERE l.depth < 32
  )
  SELECT EXISTS (
    SELECT 1
    FROM lineage l
    JOIN public.govt_admins ga ON ga.group_id = l.id
    WHERE ga.user_id = (auth.uid())::text
  );
$$;

COMMENT ON FUNCTION public.is_govt_admin_over_group(uuid) IS
  'Does the calling user govern this group or any ancestor of it? Membership walks groups.parent_id; groups.path is a name-derived slug and is never unique, so it must not decide a row policy.';

NOTIFY pgrst, 'reload schema';

COMMIT;
