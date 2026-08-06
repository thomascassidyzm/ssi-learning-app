-- Local replication of splinter 0003_auth_rls_initplan (exact predicate, view wrapper removed)
with policies as (
    select
        nsp.nspname as schema_name,
        pb.tablename as table_name,
        pc.relrowsecurity as is_rls_active,
        polname as policy_name,
        qual,
        with_check
    from
        pg_catalog.pg_policy pa
        join pg_catalog.pg_class pc on pa.polrelid = pc.oid
        join pg_catalog.pg_namespace nsp on pc.relnamespace = nsp.oid
        join pg_catalog.pg_policies pb
            on pc.relname = pb.tablename
            and nsp.nspname = pb.schemaname
            and pa.polname = pb.policyname
)
select schema_name, table_name, policy_name
from policies
where
    is_rls_active
    and schema_name = 'public'
    and (
        (qual like '%auth.uid()%' and lower(qual) not like '%select auth.uid()%')
        or (qual like '%auth.jwt()%' and lower(qual) not like '%select auth.jwt()%')
        or (qual like '%auth.role()%' and lower(qual) not like '%select auth.role()%')
        or (qual like '%auth.email()%' and lower(qual) not like '%select auth.email()%')
        or (qual like '%current\_setting(%)%' and lower(qual) not like '%select current\_setting(%)%')
        or (with_check like '%auth.uid()%' and lower(with_check) not like '%select auth.uid()%')
        or (with_check like '%auth.jwt()%' and lower(with_check) not like '%select auth.jwt()%')
        or (with_check like '%auth.role()%' and lower(with_check) not like '%select auth.role()%')
        or (with_check like '%auth.email()%' and lower(with_check) not like '%select auth.email()%')
        or (with_check like '%current\_setting(%)%' and lower(with_check) not like '%select current\_setting(%)%')
    )
order by table_name, policy_name;
