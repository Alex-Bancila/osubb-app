-- #66: active Members may register, read, and remove only their own devices.
-- A stale membership claim must not preserve access after deactivation.
revoke all on public.push_tokens from public, anon;
revoke update on public.push_tokens from authenticated;
grant select, insert, delete on public.push_tokens to authenticated;

create policy push_tokens_read_self on public.push_tokens
  for select to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy push_tokens_create_self on public.push_tokens
  for insert to authenticated
  with check (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));

create policy push_tokens_delete_self on public.push_tokens
  for delete to authenticated
  using (public.auth_is_member()
    and (select private.caller_level()) >= 0
    and member_id = (select auth.uid()));
