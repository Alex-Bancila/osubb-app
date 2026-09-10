-- #257: BCE joins BC and Moderator as a global points-ledger reader.
-- Lower-level members retain access to their own rows only. The live profile
-- check closes the stale-token path for deactivated members.

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
    or (select public.auth_level()) >= 5
  )
);

comment on policy ledger_read on public.points_ledger is
  'Active members read their own ledger rows; BCE, BC, and Moderator read all rows.';
