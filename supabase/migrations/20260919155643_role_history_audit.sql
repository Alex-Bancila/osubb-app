-- #50: immutable Role decisions, attributed to a human or automatic job.
create table public.role_history (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.profiles (id),
  from_role public.member_role not null,
  to_role public.member_role not null,
  changed_by uuid references public.profiles (id),
  actor_kind text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint role_history_changed_role_ck check (from_role <> to_role),
  constraint role_history_reason_ck check (reason ~ '[^[:space:]]'),
  constraint role_history_actor_ck check (
    (actor_kind = 'human' and changed_by is not null)
    or (actor_kind = 'automatic' and changed_by is null)),
  constraint role_history_voting_actor_ck check (
    (from_role <> 'vot' and to_role <> 'vot') or actor_kind = 'human')
);
alter table public.role_history enable row level security;
create index role_history_member_created_idx on public.role_history (member_id, created_at);
revoke all on public.role_history from public, anon, authenticated, service_role;
grant select on public.role_history to authenticated, service_role;

create policy role_history_read on public.role_history
  for select to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and (member_id = (select auth.uid()) or (select private.caller_level()) >= 6));

-- The future promotion job and role-change command write this table as
-- trusted owners, within the same transaction as the profile Role change.
-- Human voting decisions must still name live BC/Moderator authority.
create function private.guard_role_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception using errcode = '23514', message = 'role_history_immutable';
  end if;
  if (new.from_role = 'vot' or new.to_role = 'vot')
     and (new.changed_by is null or coalesce(private.actor_level(new.changed_by), -1) < 6) then
    raise exception using errcode = '23514', message = 'voting_role_requires_bc_actor';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_role_history()
  from public, anon, authenticated, service_role;
create trigger role_history_guard
  before insert or update or delete on public.role_history
  for each row execute function private.guard_role_history();

comment on table public.role_history is
  'Append-only Role decisions. Trusted jobs/commands insert in the same transaction as the profile change; automatic actions use actor_kind=automatic and changed_by=NULL, human decisions name changed_by. Voting-right changes always require a live BC/Moderator actor. No client write path.';
