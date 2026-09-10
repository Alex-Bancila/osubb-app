-- #261: manual awards are retired. Historical rows remain readable for
-- migration safety, but no new manual_award row may be created.

create or replace function public.reject_manual_award()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reason = 'manual_award' then
    raise exception 'manual_award ledger rows are no longer supported'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger points_ledger_reject_manual_award
  before insert on public.points_ledger
  for each row
  execute function public.reject_manual_award();

revoke all on function public.reject_manual_award() from public, anon, authenticated;
revoke insert on table public.points_ledger from anon, authenticated;
grant insert on table public.points_ledger to authenticated;

drop policy if exists ledger_award on public.points_ledger;

create policy ledger_sanction on public.points_ledger
  for insert to authenticated
  with check (
       (select public.auth_is_member())
   and (select exists (
         select 1
           from public.profiles p
          where p.id = (select auth.uid())
            and p.status = 'activ'
       ))
   and (select public.auth_level()) >= 6
   and reason = 'sanction'
   and awarded_by = (select auth.uid())
  );

comment on function public.reject_manual_award() is
  'Rejects new manual award ledger rows while preserving historical rows for migration safety.';
