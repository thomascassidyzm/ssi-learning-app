-- Region-tier slice 1: expose grants_group_id through invite_code_validation.
--
-- api/code/validate.ts needs it to resolve group-name context ("joining
-- {region}") instead of the legacy regions lookup. The view was created
-- before grants_group_id existed on invite_codes and was never refreshed.
-- Read only via service-role (api/code/validate.ts, api/code/redeem.ts) —
-- no grant change needed, security_invoker posture unchanged.

CREATE OR REPLACE VIEW public.invite_code_validation WITH (security_invoker='on') AS
 SELECT id,
    code,
    code_type,
    grants_region,
    grants_school_id,
    grants_class_id,
    grants_group_id,
    metadata,
    max_uses,
    use_count,
    expires_at,
    is_active,
    code_normalized
   FROM public.invite_codes;

NOTIFY pgrst, 'reload schema';
