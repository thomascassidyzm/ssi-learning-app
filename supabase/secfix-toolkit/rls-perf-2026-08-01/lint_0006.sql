-- Local replication of splinter 0006_multiple_permissive_policies (exact logic, view wrapper removed)
select
    n.nspname as schema_name,
    c.relname as table_name,
    r.rolname as role_name,
    act.cmd as action,
    array_agg(p.polname order by p.polname) as policies
from
    pg_catalog.pg_policy p
    join pg_catalog.pg_class c on p.polrelid = c.oid
    join pg_catalog.pg_namespace n on c.relnamespace = n.oid
    join pg_catalog.pg_roles r
        on p.polroles @> array[r.oid]
        or p.polroles = array[0::oid]
    left join pg_catalog.pg_depend dep
        on c.oid = dep.objid
        and dep.deptype = 'e'
        and dep.classid = 'pg_catalog.pg_class'::regclass,
    lateral (
        select x.cmd
        from unnest((
            select
                case p.polcmd
                    when 'r' then array['SELECT']
                    when 'a' then array['INSERT']
                    when 'w' then array['UPDATE']
                    when 'd' then array['DELETE']
                    when '*' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
                    else array['ERROR']
                end as actions
        )) x(cmd)
    ) act(cmd)
where
    c.relkind = 'r'
    and p.polpermissive
    and n.nspname = 'public'
    and r.rolname not like 'pg\_%'
    and r.rolname not like 'supabase%admin'
    and not r.rolbypassrls
    and dep.objid is null
group by n.nspname, c.relname, r.rolname, act.cmd
having count(1) > 1
order by table_name, role_name, action;
