-- Region-tier slice 2: leader surfaces (region-tier-design.md §1d, §5c revised).
--
-- 1. schools.admin_user_id becomes nullable — a leader-created school (revised
--    5c) is group-owned from birth with a VACANT admin seat: no client-facing
--    code path assumes NOT NULL (every read is an `.eq('admin_user_id', x)`
--    equality check, which simply doesn't match a NULL row — the existing
--    school_admin_join user_tags path is already the primary admin-identity
--    lookup, admin_user_id is only ever the fallback). Staff claim the seat
--    later via the pre-existing admin_join_code mechanic; nothing new to wire.
--
-- 2. groups.name_confirmed — drives the "name your region" first-run card.
--    Every EXISTING group was deliberately named (ssi_admin-authored or
--    already confirmed) so it backfills to true; every group created from now
--    on (including at govt_admin redemption) defaults to false until the
--    leader (or ssi_admin) explicitly saves a name via PATCH /api/groups/:id.

ALTER TABLE public.schools ALTER COLUMN admin_user_id DROP NOT NULL;

ALTER TABLE public.groups ADD COLUMN name_confirmed boolean;
UPDATE public.groups SET name_confirmed = true WHERE name_confirmed IS NULL;
ALTER TABLE public.groups ALTER COLUMN name_confirmed SET DEFAULT false;
ALTER TABLE public.groups ALTER COLUMN name_confirmed SET NOT NULL;

NOTIFY pgrst, 'reload schema';
