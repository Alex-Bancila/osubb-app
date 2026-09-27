-- Security pass L5 (2026-09-27): validate the Latin-only profiles_nickname_ck
-- added NOT VALID by 20260927190000. Stored data is never rewritten: when a
-- stored Nickname still breaks the rule, the constraint stays NOT VALID (new
-- and changed rows are checked all the same) and a NOTICE reports the count,
-- so a human can ask the Members concerned to pick a new one.
do $$
declare
  v_failing bigint;
begin
  select count(*) into v_failing
    from public.profiles
   where nickname is not null
     and not (nickname = btrim(nickname)
              and nickname ~ '^[A-Za-z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u017E\u0218-\u021B ._-]{2,24}$');
  if v_failing = 0 then
    alter table public.profiles validate constraint profiles_nickname_ck;
  else
    raise notice 'profiles_nickname_ck left NOT VALID: % stored Nickname(s) use characters outside the Latin set', v_failing;
  end if;
end
$$;
