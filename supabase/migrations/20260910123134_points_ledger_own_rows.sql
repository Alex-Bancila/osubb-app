-- #256: ordinary members may inspect only their own points history.
--
-- A JWT can keep organization claims until it expires after a member is
-- deactivated. auth_is_member() intentionally checks those claims, so this
-- policy also verifies the caller's current profile status in the database.
-- BC and Moderator retain the existing global-read behavior; #257 lowers that
-- deliberate leadership branch to BCE after its own role-matrix review.

alter policy ledger_read on public.points_ledger
using (
  (select public.auth_is_member())
  and (select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.status = 'activ'
  ))
  and (
       member_id = (select auth.uid())
    or (select public.auth_level()) >= 6
  )
);

-- Grants decide which operations reach RLS at all. Keep SELECT and the
-- temporary policy-controlled INSERT path explicit, while removing UPDATE and
-- DELETE from browser clients. The follow-up that removes manual awards also
-- removes INSERT; this migration does not overlap that independently assigned
-- work.
revoke all on table public.points_ledger from anon, authenticated;
grant select, insert on table public.points_ledger to authenticated;
