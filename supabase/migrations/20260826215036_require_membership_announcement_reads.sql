-- A valid auth uid is not proof of active OSUBB membership: a deactivated
-- member can keep an access token until it expires. Read receipts therefore
-- need both the organisation claim and self-ownership (ADR-0003, house rule 12).
alter policy announcement_reads_self on public.announcement_reads
  using (
    public.auth_is_member()
    and member_id = (select auth.uid())
  )
  with check (
    public.auth_is_member()
    and member_id = (select auth.uid())
  );
