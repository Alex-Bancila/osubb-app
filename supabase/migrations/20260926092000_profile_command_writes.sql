-- #610: Member commands own client Role and Membership Status writes.
-- set_member_role and set_member_status preserve audit, notifications and Group
-- membership invariants. Server-side seed, csv-import, provision_profile and
-- future promotion jobs do not connect as authenticated and are unaffected.
revoke update (role, status) on table public.profiles from authenticated;
