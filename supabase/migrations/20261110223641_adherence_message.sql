-- R66 (2026-11-10; spec docs/superpowers/specs/2026-11-10-voluntar-activ-message-design.md): the Adherence Message -- BC's own words, with the adherence form's link, shown until answered to every Voluntar Activ who studies at UBB.
--
-- AG Eligibility belongs to a Voluntar Activ at UBB, and only they can be
-- granted Drept de Vot (R58). Until now the adherence form's address went,
-- in a fixed sentence, to every Member promoted to Voluntar Activ, inside a
-- Notification that is easy to miss. BC now writes the message, its heading
-- and its button, and the app shows it as a window the Member must answer.
--
-- Sections:
--   1. public.adherence_message: the one row BC writes (off on day one).
--   2. public.adherence_message_reads: the latest version each Member answered.
--   3. Who is eligible, the Member's read and answer, BC's command and counts.
--   4. The adherence form's address moves here from org_settings, and
--      set_org_setting forgets the key.
--   5. The "Rol actualizat" Notification loses the adherence sentence.
--   6. Member Deletion (R59): an answer goes with the account.

-- ---------------------------------------------------------------------------
-- 1. The message.
-- ---------------------------------------------------------------------------
create table public.adherence_message (
  id          smallint primary key,
  title       text,
  body        text,
  link_url    text,
  link_label  text,
  version     integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id),
  constraint adherence_message_singleton_ck check (id = 1),
  -- A message is a heading and a body together; neither alone.
  constraint adherence_message_text_ck check ((title is null) = (body is null)),
  constraint adherence_message_title_length_ck
    check (title is null or char_length(title) between 1 and 120),
  -- R60's stored cap; the visible one (2000) is judged by the command.
  constraint adherence_message_body_length_ck
    check (body is null or char_length(body) <= 4000),
  -- The Attached Link rule (#684): an address and its label together.
  constraint adherence_message_link_ck check ((link_url is null) = (link_label is null)),
  constraint adherence_message_link_label_length_ck
    check (link_label is null or char_length(link_label) between 1 and 60),
  constraint adherence_message_link_url_ck
    check (link_url is null or (char_length(link_url) <= 2048 and link_url ~ '^https?://')),
  constraint adherence_message_version_ck check (version >= 0),
  constraint adherence_message_updated_at_ck check (updated_at >= created_at)
);

alter table public.adherence_message enable row level security;

create trigger adherence_message_set_updated_at
before update on public.adherence_message
for each row execute function private.set_updated_at();

-- ADR-0011: a save re-reads the message in every open app.
create trigger broadcast_change after insert or update or delete on public.adherence_message
  for each statement execute function private.broadcast_change();

-- Every foreign key is indexed (advisor_findings.test.sql).
create index adherence_message_updated_by_idx on public.adherence_message (updated_by);

comment on table public.adherence_message is
  'R66: the Adherence Message (Mesajul pentru Voluntarii Activi) -- one row BC or the Moderator writes on Administrare -> Portofoliu Interne -> Mesaj. While body is set, every eligible Member (private.adherence_message_eligible: active, Voluntar Activ, Universitatea Babeș-Bolyai) meets it as a window they must answer (public.answer_adherence_message), then on Profil. title and body are null while there is no message; the link and its label are kept either way. version moves when BC asks everyone again, and when a message is turned on from none. Read by BC and the Moderator only; a Member reads it through public.my_adherence_message. The only write path is public.set_adherence_message.';
comment on column public.adherence_message.id is 'R66: always 1 (adherence_message_singleton_ck).';
comment on column public.adherence_message.title is 'R66: the heading BC writes, plain text, 1-120 characters; null while there is no message.';
comment on column public.adherence_message.body is 'R66: the message, Formatted Text (R60): at most 4000 stored and 2000 visible characters; null while there is no message.';
comment on column public.adherence_message.link_url is 'R66: the adherence form''s address, http(s), at most 2048 characters; null for no link. Copied on day one from org_settings.adherence_form_url.';
comment on column public.adherence_message.link_label is 'R66: the label of the link''s button, plain text, 1-60 characters; set exactly when link_url is.';
comment on column public.adherence_message.version is 'R66: the version a Member must have answered. Moves only when BC asks everyone again (Salvează și arată din nou) or a message is turned on from none; a quiet correction keeps it, so those who answered are not asked again.';
comment on column public.adherence_message.updated_by is 'R66: the Member who saved it last; null while the row is as its migration seeded it.';

revoke all on table public.adherence_message from public, anon, authenticated, service_role;
grant select on table public.adherence_message to authenticated, service_role;

create policy adherence_message_read on public.adherence_message
  for select to authenticated
  using ((select public.auth_is_member()) and (select private.caller_level()) >= 6);

comment on policy adherence_message_read on public.adherence_message is
  'R66: BC and the Moderator read the row as they write it (organization claims plus live level >= 6). A Member meets the message only through public.my_adherence_message, which returns it to the eligible.';

-- ---------------------------------------------------------------------------
-- 2. The answers.
-- ---------------------------------------------------------------------------
create table public.adherence_message_reads (
  member_id  uuid primary key references public.profiles (id) on delete cascade,
  version    integer not null,
  read_at    timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint adherence_message_reads_version_ck check (version >= 1)
);

alter table public.adherence_message_reads enable row level security;

-- ADR-0011, as announcement_reads: an answer closes the window on the
-- Member's other devices and moves BC's counts. The signal names the table.
create trigger broadcast_change after insert or update or delete on public.adherence_message_reads
  for each statement execute function private.broadcast_change();

comment on table public.adherence_message_reads is
  'R66: the latest version of the Adherence Message each Member answered with Am citit -- one row per Member, overwritten by each answer (read_at moves). A Member reads their own row, BC and the Moderator every row; public.answer_adherence_message is the only write path. Goes with a deleted account (R59).';
comment on column public.adherence_message_reads.version is 'R66: the adherence_message.version the Member last answered; they have answered the message while it is >= the current version.';
comment on column public.adherence_message_reads.read_at is 'R66: when the Member last answered.';
comment on column public.adherence_message_reads.created_at is 'R66: when the Member first answered.';

revoke all on table public.adherence_message_reads from public, anon, authenticated, service_role;
grant select on table public.adherence_message_reads to authenticated, service_role;

create policy adherence_message_reads_read on public.adherence_message_reads
  for select to authenticated
  using ((select public.auth_is_member())
         and (member_id = (select auth.uid()) and (select private.caller_level()) >= 0
              or (select private.caller_level()) >= 6));

comment on policy adherence_message_reads_read on public.adherence_message_reads is
  'R66: a live active Member reads their own answer; BC and the Moderator read every answer. Organization claims first (house rule 12).';

-- ---------------------------------------------------------------------------
-- 3. Eligibility, the Member's read and answer, BC's command and counts.
-- ---------------------------------------------------------------------------
create function private.adherence_message_eligible(p_member uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles as profile
     where profile.id = p_member
       and profile.status = 'activ'
       and profile.role = 'activ'
       and profile.university = private.ubb_university());
$$;

comment on function private.adherence_message_eligible(uuid) is
  'R66: whether a Member receives the Adherence Message -- an active Profile whose Role is Voluntar Activ (activ) and whose Universitate is Universitatea Babeș-Bolyai (private.ubb_university). An unknown Universitate is not eligible. public.adherence_message_status counts the same rule set-wise. Called from security-definer bodies; granted to nobody.';
revoke execute on function private.adherence_message_eligible(uuid)
  from public, anon, authenticated, service_role;

create function private.my_adherence_message_impl()
returns table (
  title      text,
  body       text,
  link_url   text,
  link_label text,
  version    integer,
  answered   boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select message.title, message.body, message.link_url, message.link_label, message.version,
         coalesce(answer.version, 0) >= message.version
    from public.adherence_message as message
    left join public.adherence_message_reads as answer
      on answer.member_id = (select auth.uid())
   where message.id = 1
     and message.body is not null
     and (select public.auth_is_member())
     and private.adherence_message_eligible((select auth.uid()));
$$;

comment on function private.my_adherence_message_impl() is
  'R66: body of public.my_adherence_message. One row for an eligible caller with organization claims while a message exists, else none.';

create function public.my_adherence_message()
returns table (
  title      text,
  body       text,
  link_url   text,
  link_label text,
  version    integer,
  answered   boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.my_adherence_message_impl();
$$;

comment on function public.my_adherence_message() is
  'R66: the Adherence Message for the caller -- one row (title, body, link_url, link_label, version, answered) when the caller is an active Voluntar Activ at Universitatea Babeș-Bolyai and a message exists; no row otherwise, a claimless or deactivated session included. answered is true once the caller has answered the current version: the app shows the window while it is false and the message on Profil once it is true.';

revoke execute on function private.my_adherence_message_impl() from public, anon, authenticated, service_role;
revoke execute on function public.my_adherence_message() from public, anon, authenticated, service_role;
grant execute on function private.my_adherence_message_impl() to authenticated;
grant execute on function public.my_adherence_message() to authenticated;

create function private.answer_adherence_message_impl(p_version integer)
returns public.adherence_message_reads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_message public.adherence_message%rowtype;
  v_read    public.adherence_message_reads%rowtype;
begin
  -- 1. Nothing is malformed for every caller: a null or old version is a
  -- version that is not the current one, answered below.

  -- 2. The gate: claims and a live activ Profile.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'adherence_message_answer_forbidden';
  end;

  -- 3. The message held for share, so the answer serialises behind a save
  -- (which holds it for no key update); then the Member's Profile for share,
  -- so a Role or Universitate change serialises with it.
  select * into v_message
    from public.adherence_message as message
   where message.id = 1
     for share;
  perform 1 from public.profiles as profile where profile.id = v_actor for share;

  -- 4. State. Not eligible and no message are one answer (conventions §3).
  if v_message.body is null or not private.adherence_message_eligible(v_actor) then
    raise sqlstate 'PT404' using message = 'adherence_message_not_found';
  end if;
  if p_version is distinct from v_message.version then
    raise sqlstate 'PT409' using message = 'adherence_message_changed';
  end if;

  -- 5. Write. Answering again only moves read_at.
  insert into public.adherence_message_reads as answer (member_id, version, read_at)
  values (v_actor, p_version, clock_timestamp())
  on conflict (member_id) do update
     set version = excluded.version,
         read_at = excluded.read_at
  returning * into v_read;

  return v_read;
end;
$$;

comment on function private.answer_adherence_message_impl(integer) is
  'R66: body of public.answer_adherence_message. 42501 adherence_message_answer_forbidden without claims or a live activ Profile; the message row for share, then the caller''s Profile for share; PT404 adherence_message_not_found when the caller is not eligible or no message exists; PT409 adherence_message_changed when p_version is not the current version (null included). Upserts the caller''s adherence_message_reads row.';

create function public.answer_adherence_message(p_version integer)
returns public.adherence_message_reads
language sql
security invoker
set search_path = ''
as $$
  select * from private.answer_adherence_message_impl(p_version);
$$;

comment on function public.answer_adherence_message(integer) is
  'R66: Am citit -- the caller answers the Adherence Message''s version p_version (the version my_adherence_message returned). 42501 adherence_message_answer_forbidden; PT404 adherence_message_not_found (not eligible, or no message); PT409 adherence_message_changed (BC asked everyone again meanwhile: read it again). Returns the caller''s answer row.';

revoke execute on function private.answer_adherence_message_impl(integer) from public, anon, authenticated, service_role;
revoke execute on function public.answer_adherence_message(integer) from public, anon, authenticated, service_role;
grant execute on function private.answer_adherence_message_impl(integer) to authenticated;
grant execute on function public.answer_adherence_message(integer) to authenticated;

create function private.set_adherence_message_impl(
  p_title      text,
  p_body       text,
  p_link_url   text,
  p_link_label text,
  p_ask_again  boolean
)
returns public.adherence_message
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid;
  v_title   text;
  v_body    text;
  v_url     text;
  v_label   text;
  v_current public.adherence_message%rowtype;
  v_bump    boolean;
begin
  -- 1. Malformed for every caller. Each text trimmed, blank -> null.
  v_title := nullif(regexp_replace(coalesce(p_title, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_body  := nullif(regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_url   := nullif(regexp_replace(coalesce(p_link_url, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_label := nullif(regexp_replace(coalesce(p_link_label, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  -- A heading and a body go together; both blank turns the message off.
  if v_body is not null and v_title is null then
    raise sqlstate 'PT400' using message = 'title_required';
  end if;
  if v_title is not null and v_body is null then
    raise sqlstate 'PT400' using message = 'body_required';
  end if;
  perform private.require_text_length('title', v_title, null, 120);
  perform private.require_formatted_text_length('body', v_body);
  perform private.require_attached_link(v_label, v_url);

  -- 2. The gate: claims and a live activ Profile, then BC or Moderator.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'adherence_message_manage_forbidden';
  end;
  if coalesce(private.actor_level(v_actor), -1) < 6 then
    raise exception using errcode = '42501', message = 'adherence_message_manage_forbidden';
  end if;

  -- 3. The one row.
  select * into v_current
    from public.adherence_message as message
   where message.id = 1
     for no key update;

  -- 4. State. A new version is due when the result is a message and BC asks
  -- everyone again, or there was no message before.
  v_bump := v_body is not null and (coalesce(p_ask_again, false) or v_current.body is null);
  if not v_bump
     and v_current.title is not distinct from v_title
     and v_current.body is not distinct from v_body
     and v_current.link_url is not distinct from v_url
     and v_current.link_label is not distinct from v_label then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write.
  update public.adherence_message
     set title      = v_title,
         body       = v_body,
         link_url   = v_url,
         link_label = v_label,
         version    = version + case when v_bump then 1 else 0 end,
         updated_by = v_actor
   where id = 1
  returning * into v_current;

  return v_current;
end;
$$;

comment on function private.set_adherence_message_impl(text, text, text, text, boolean) is
  'R66: body of public.set_adherence_message. Step 1 trims each text (blank -> null): PT400 title_required (a body without a heading), body_required (a heading without a body), title_too_long (120), body_too_long (R60: 4000 stored, 2000 visible), and the Attached Link rule (link_incomplete, link_label_too_long, link_url_too_long, link_url_invalid). Then private.require_active_member() and live level >= 6, every refusal 42501 adherence_message_manage_forbidden; the row for no key update; PT409 nothing_to_update when nothing changes and no new version is due. version + 1 when the result is a message and p_ask_again is true or there was no message before.';

create function public.set_adherence_message(
  p_title      text,
  p_body       text,
  p_link_url   text,
  p_link_label text,
  p_ask_again  boolean
)
returns public.adherence_message
language sql
security invoker
set search_path = ''
as $$
  select * from private.set_adherence_message_impl(p_title, p_body, p_link_url, p_link_label, p_ask_again);
$$;

comment on function public.set_adherence_message(text, text, text, text, boolean) is
  'R66: BC or the Moderator writes the Adherence Message -- its heading (plain, 1-120), its body (Formatted Text) and the adherence form''s link and button label (the Attached Link rule). Both heading and body blank turns the message off: nobody sees it, Profil shows nothing, the link is kept. p_ask_again true (Salvează și arată din nou) makes every eligible Member answer it again; false (Salvează) is a correction those who answered are not asked about. Turning a message on from none always reaches everyone eligible. 42501 adherence_message_manage_forbidden; PT400 title_required, body_required, title_too_long, body_too_long, link_incomplete, link_label_too_long, link_url_too_long, link_url_invalid; PT409 nothing_to_update. Returns the row.';

revoke execute on function private.set_adherence_message_impl(text, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke execute on function public.set_adherence_message(text, text, text, text, boolean) from public, anon, authenticated, service_role;
grant execute on function private.set_adherence_message_impl(text, text, text, text, boolean) to authenticated;
grant execute on function public.set_adherence_message(text, text, text, text, boolean) to authenticated;

create function private.adherence_message_status_impl()
returns table (eligible_count integer, answered_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  -- private.adherence_message_eligible's rule, over every Profile at once.
  select counts.eligible_count, counts.answered_count
    from (
      select count(*)::integer as eligible_count,
             (count(*) filter (where message.body is not null
                                 and coalesce(answer.version, 0) >= message.version))::integer as answered_count
        from public.profiles as profile
        cross join public.adherence_message as message
        left join public.adherence_message_reads as answer on answer.member_id = profile.id
       where message.id = 1
         and profile.status = 'activ'
         and profile.role = 'activ'
         and profile.university = private.ubb_university()
    ) as counts
   where (select public.auth_is_member())
     and (select private.caller_level()) >= 6;
$$;

comment on function private.adherence_message_status_impl() is
  'R66: body of public.adherence_message_status. One row for organization claims and live level >= 6, else none.';

create function public.adherence_message_status()
returns table (eligible_count integer, answered_count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.adherence_message_status_impl();
$$;

comment on function public.adherence_message_status() is
  'R66: for BC and the Moderator, how many Members are eligible for the Adherence Message (active Voluntari Activi at Universitatea Babeș-Bolyai) and how many of them have answered its current version (0 while there is no message). No row for anyone else.';

revoke execute on function private.adherence_message_status_impl() from public, anon, authenticated, service_role;
revoke execute on function public.adherence_message_status() from public, anon, authenticated, service_role;
grant execute on function private.adherence_message_status_impl() to authenticated;
grant execute on function public.adherence_message_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The adherence form's address moves to the message.
-- ---------------------------------------------------------------------------
-- The day-one row has no heading or body (no window until BC writes one) and,
-- when org_settings held an address, that address with a label BC can change.
-- The statements between the markers are replayed by
-- supabase/tests/adherence_message_day_one_upgrade.test.sh.
-- move: begin
insert into public.adherence_message (id, link_url, link_label)
select 1, setting.url,
       case when setting.url is null then null else 'Deschide formularul de adeziune' end
  from (select (select nullif(btrim(org.value), '')
                  from public.org_settings as org
                 where org.key = 'adherence_form_url') as url) as setting;
delete from public.org_settings where key = 'adherence_form_url';
-- move: end

alter table public.org_settings drop constraint org_settings_adherence_form_url_ck;

-- Restated from 20261018170000_portofoliu_interne.sql without the
-- adherence_form_url branch: the key is unknown now (PT404).
create or replace function private.set_org_setting_impl(p_key text, p_value text)
 RETURNS public.org_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor       uuid;
  v_actor_level integer;
  v_value       text;
  v_setting     public.org_settings%rowtype;
begin
  -- 1. Malformed for every caller, so answered ahead of any authority verdict.
  v_value := nullif(regexp_replace(coalesce(p_value, ''),
                                   '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  perform private.require_text_length('value', v_value, null, 2048);
  -- #512, #824: a Group id is a positive integer that fits a bigint.
  if p_key in ('adunarea_generala_group_id', 'board_group_id')
     and v_value is not null
     and v_value !~ '^[1-9][0-9]{0,17}$' then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #771: the Privacy Notice version is dotted numbers and is never cleared.
  if p_key = 'privacy_notice_version'
     and (v_value is null or v_value !~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;
  -- #775: the Email Digest quota is a whole number 0-99999 and is never
  -- cleared (0 pauses the digest).
  if p_key = 'email_daily_quota'
     and (v_value is null or v_value !~ '^(0|[1-9][0-9]{0,4})$') then
    raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
  end if;

  -- 2. Authority: BC or Moderator, live, held for the transaction.
  begin
    v_actor := private.require_active_member();
  exception when insufficient_privilege then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end;

  select role.level into v_actor_level
    from public.profiles as actor
    join public.roles as role on role.id = actor.role
   where actor.id = v_actor
     and actor.status = 'activ'
   for share of actor;
  if coalesce(v_actor_level, -1) < 6 then
    raise exception using errcode = '42501', message = 'org_settings_manage_forbidden';
  end if;

  -- 3. Target under lock.
  select * into v_setting
    from public.org_settings
   where key = p_key
   for update;
  if not found then
    raise sqlstate 'PT404' using message = 'org_setting_not_found';
  end if;
  -- #512, #824: the Adunarea Generală and the board are existing, active
  -- Groups, and the board a Private one. `for key share` keeps the row from being deleted under the write
  -- without blocking the `for no key update` every Group command takes on a
  -- Group row.
  if p_key in ('adunarea_generala_group_id', 'board_group_id') and v_value is not null then
    perform 1
      from public.groups as grp
     where grp.id = v_value::bigint
       and grp.status = 'active'
       and (p_key <> 'board_group_id' or grp.is_private)
       for key share;
    if not found then
      raise sqlstate 'PT400' using message = 'invalid_org_setting_value';
    end if;
  end if;

  -- 4. State.
  if v_value is not distinct from v_setting.value then
    raise sqlstate 'PT409' using message = 'nothing_to_update';
  end if;

  -- 5. Write.
  update public.org_settings
     set value = v_value,
         updated_by = v_actor
   where key = p_key
  returning * into v_setting;

  return v_setting;
end;
$function$;

comment on function private.set_org_setting_impl(text, text) is
  '#681, extended by #512, #48, #771, #775, #824 and #866; R58 removed vote_retention_percent and R66 adherence_form_url: body of public.set_org_setting. Step 1 trims the value (blank -> null), PT400 value_too_long above 2048 characters, PT400 invalid_org_setting_value for an adunarea_generala_group_id or board_group_id that is not a positive integer, a privacy_notice_version that is not dotted numbers (1.0, 1.1, 2.0.1; blank included: the version is never cleared), or an email_daily_quota that is not a whole number 0-99999 (blank included: the quota is never cleared); then 42501 org_settings_manage_forbidden unless the caller is a live active BC or Moderator (level >= 6, Profile held for share); PT404 org_setting_not_found for an unseeded key (vote_retention_percent included: y lives in evaluation_settings since R58; adherence_form_url too: the address lives in adherence_message since R66); PT400 invalid_org_setting_value for an adunarea_generala_group_id naming no active Group or a board_group_id naming no active Private Group (checked after the gate, so nobody below BC probes Group ids); PT409 nothing_to_update for an unchanged value.';
comment on function public.set_org_setting(text, text) is
  '#681 (ruling R20), extended by #512, #48, #771, #775, #824 and #866: BC or the Moderator sets one organization setting. The value is trimmed and a blank value clears it (null). adunarea_generala_group_id must be the id of an active Group -- the Adunarea Generală, whose Group Managers and Group Responsibles (and those of its ancestors) then read the full Role Evaluation ranking. privacy_notice_version must be dotted numbers (1.0, 1.1) and cannot be cleared; raising it makes every Member acknowledge the Privacy Notice again (#771). email_daily_quota must be a whole number 0-99999 and cannot be cleared: how many Email Digests go out per UTC day (#775; 0 pauses them). board_group_id must be the id of an active Private Group -- the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title Profil shows as their board title (#824); it confers nothing. Records updated_by; the trigger moves updated_at. Keys are seeded by migrations: an unknown key is PT404 org_setting_not_found -- vote_retention_percent too since R58, which moved y to evaluation_settings (public.set_evaluation_percent), and adherence_form_url since R66, which moved the address into the Adherence Message (public.set_adherence_message).';
comment on table public.org_settings is
  '#681 (ruling R20): organization-wide settings BC sets from the app instead of a migration. Every live active Member reads every row; the write path is public.set_org_setting (BC/Moderator). Keys are reference data seeded by migrations. adunarea_generala_group_id (#512): the id of the Group that is the Adunarea Generală -- its Group Managers and Group Responsibles, and those of its ancestors, read the full Role Evaluation ranking (private.can_read_evaluation_rankings); null until BC sets it. privacy_notice_version (#771, ruling L16): the current version of the Privacy Notice every Member acknowledges once (public.acknowledge_privacy_notice); dotted numbers such as 1.0 or 1.1, never null; bumping it re-asks everyone. email_daily_quota (#775): how many Email Digests may be sent per UTC day, a whole number 0-99999 (0 pauses the digest), never null; seeded 90, leaving Resend''s free daily cap of 100 room for sign-in emails. board_group_id (#824, decision D1; #963): the id of the Private Group "Biroul de Conducere", whose Group Responsibles'' position_title is each BC/BCE member''s Board Title -- read by private.board_title for profiles_directory and member_card, and by Profil (Funcția în OSUBB); never an authority input; null until BC sets it. vote_retention_percent (#48, #866) left this table with R58: y is evaluation_settings.vot_percent. adherence_form_url (#681) left it with R66: the address is adherence_message.link_url.';

-- ---------------------------------------------------------------------------
-- 5. "Rol actualizat" without the adherence sentence.
-- ---------------------------------------------------------------------------
-- Restated from 20260929110000_bc_rank_authority.sql (its only body) without
-- the activ branch and the org_settings read: a Member promoted to Voluntar
-- Activ reads "Rolul tău în OSUBB este acum Voluntar Activ.", whatever their
-- Universitate. Those at UBB meet the Adherence Message instead.
create or replace function private.apply_member_role(
  p_member_id uuid,
  p_role      public.member_role,
  p_actor     uuid,
  p_reason    text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_from        public.member_role;
  v_role_name   text;
  v_new_level   integer;
  v_groups_left text[];
  v_member      public.profiles%rowtype;
begin
  -- No gate: the caller holds the Member's Profile `for update` and has
  -- decided the change is allowed. What lives here is what every rank change
  -- writes, whoever decided it.
  select profile.role into strict v_from
    from public.profiles as profile
   where profile.id = p_member_id;

  select role.name, role.level into strict v_role_name, v_new_level
    from public.roles as role
   where role.id = p_role;

  update public.profiles
     set role = p_role
   where id = p_member_id
  returning * into v_member;

  insert into public.role_history (
    member_id, from_role, to_role, changed_by, actor_kind, reason
  ) values (
    p_member_id, v_from, p_role, p_actor, 'human', p_reason
  );

  -- The one case where a Role change edits rosters. A Group states the rank
  -- its members must hold; once the Member falls below it they are not a
  -- member of that Group any more, whatever position they held there, so the
  -- row goes -- ordinary membership and Group Role alike. Only Groups whose
  -- *own* Minimum Level is above the new rank are touched: an ancestor with a
  -- lower Minimum keeps its row, and the authority it carries still flows down
  -- through `groups.path`.
  --
  -- The rows are locked `for update` before anything is decided about them.
  -- `for update of membership` locks `group_members` only: a `groups` row is
  -- read here, never locked, because a share lock on one would ABBA against
  -- any Group command holding it `for update`. Ordering by `group_id` keeps
  -- two concurrent demotions over the same Groups in one sequence.
  perform 1
     from public.group_members as membership
     join public.groups as grp on grp.id = membership.group_id
    where membership.member_id = p_member_id
      and grp.min_level > v_new_level
    order by membership.group_id
      for update of membership;

  with removed as (
    delete from public.group_members as membership
     using public.groups as grp
     where grp.id = membership.group_id
       and membership.member_id = p_member_id
       and grp.min_level > v_new_level
    returning grp.name as group_name
  )
  select array_agg(distinct group_name order by group_name)
    into v_groups_left
    from removed;

  -- #584 (ruling R30). The Application half of the same rule, locked in id
  -- order before anything is decided about the rows.
  perform 1
     from public.group_applications as application
     join public.groups as grp on grp.id = application.group_id
    where application.member_id = p_member_id
      and application.status = 'pending'
      and grp.min_level > v_new_level
    order by application.id
      for update of application;

  update public.group_applications as application
     set status     = 'withdrawn',
         decided_by = p_actor,
         decided_at = clock_timestamp()
    from public.groups as grp
   where grp.id = application.group_id
     and application.member_id = p_member_id
     and application.status = 'pending'
     and grp.min_level > v_new_level;

  perform private.notify(
    array[p_member_id],
    'system'::public.noti_kind,
    'Rol actualizat',
    case
      when p_role = 'vot' then
        'Rolul tău în OSUBB este acum Voluntar cu Drept de Vot. Ești membru al Adunării Generale.'
      else
        'Rolul tău în OSUBB este acum ' || v_role_name || '.'
    end
    || case
         when v_groups_left is null then ''
         else ' Nu mai faci parte din: '
              || array_to_string(v_groups_left, ', ') || '.'
       end,
    null,
    null,
    p_actor,
    -- #843 (D24): the new Role is on Profil.
    '/profil'
  );

  return v_member;
end;
$function$;

revoke execute on function private.apply_member_role(uuid, public.member_role, uuid, text)
  from public, anon, authenticated, service_role;
comment on function private.apply_member_role(uuid, public.member_role, uuid, text) is
  'The effect of one audited rank change (#905), with no gate of its own: sets the rank, writes the public.role_history row naming p_actor with p_reason, deletes the Member''s roster rows on every Group whose own Minimum Level is above the new rank (R23 -- ordinary membership and Group Role alike; an ancestor with a lower Minimum keeps its row), withdraws their pending Applications to those Groups with p_actor as decider (#584, ruling R30), and sends the one "Rol actualizat" Notification to the Member (private.notify drops the actor, so a Member who re-ranks themselves as a named replacement hears nothing). Since R66 a promotion to Voluntar Activ says only the new Role: the adherence form reaches the Members at UBB through the Adherence Message, nobody through the Notification. The caller must hold the Member''s Profile FOR UPDATE and have decided the change is allowed; only private.set_member_role_impl (for a named replacement and then for the target) and private.set_member_status_impl (for a named replacement, #917) call it. Granted to nobody.';

-- ---------------------------------------------------------------------------
-- 6. Member Deletion (R59): an answer is the account's own.
-- ---------------------------------------------------------------------------
-- Restated from 20261020205141_member_deletion.sql with adherence_message_reads
-- on both lists. adherence_message.updated_by stays out of them: a save holds
-- the account, as every actor column does.
create or replace function private.member_deletion_goes(p_member_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(goes.kind, goes.n) filter (where goes.n > 0), '{}'::jsonb)
    from (values
      ('adherence_message_reads',         (select count(*) from public.adherence_message_reads where member_id = p_member_id)),
      ('announcement_reads',              (select count(*) from public.announcement_reads where member_id = p_member_id)),
      ('deal_code_reveals',               (select count(*) from public.deal_code_reveals where member_id = p_member_id)),
      ('email_digests',                   (select count(*) from private.email_digests where member_id = p_member_id)),
      -- An ordinary membership only: a Group position is history.
      ('group_members',                   (select count(*) from public.group_members
                                            where member_id = p_member_id and group_role = 'member')),
      ('member_group_unselected',         (select count(*) from public.member_group_unselected where member_id = p_member_id)),
      ('member_imports',                  (select count(*) from public.member_imports where member_id = p_member_id)),
      ('notification_email_preferences',  (select count(*) from public.notification_email_preferences where member_id = p_member_id)),
      ('notification_push_preferences',   (select count(*) from public.notification_push_preferences where member_id = p_member_id)),
      ('notifications',                   (select count(*) from public.notifications where member_id = p_member_id)),
      ('privacy_notice_acknowledgements', (select count(*) from public.privacy_notice_acknowledgements where member_id = p_member_id)),
      ('push_tokens',                     (select count(*) from public.push_tokens where member_id = p_member_id)),
      -- The Role and Status History about the Member, an earlier deactivation
      -- included (R59 decision 2).
      ('role_history',                    (select count(*) from public.role_history where member_id = p_member_id))
    ) as goes(kind, n);
$$;

comment on function private.member_deletion_goes(uuid) is
  'R59 (#1087): the rows that go with a deleted account, counted by table, only the non-zero ones. These columns are the only foreign keys into profiles that private.member_deletion_holds does not count. R66 adds the Member''s answer to the Adherence Message (adherence_message_reads).';

create or replace function private.member_deletion_holds(p_member_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_fk    record;
  v_n     bigint;
  v_holds jsonb := '{}'::jsonb;
begin
  for v_fk in
    select namespace.nspname as schema_name,
           relation.relname  as table_name,
           attribute.attname as column_name
      from pg_catalog.pg_constraint as fk
      join pg_catalog.pg_class as relation on relation.oid = fk.conrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      join pg_catalog.pg_attribute as attribute
        on attribute.attrelid = fk.conrelid and attribute.attnum = fk.conkey[1]
     where fk.contype = 'f'
       and fk.confrelid in ('public.profiles'::regclass, 'auth.users'::regclass)
       -- Auth's own tables, and the key profiles.id -> auth.users itself, are
       -- the account. Any other column of profiles naming a Member counts.
       and namespace.nspname <> 'auth'
       and not (fk.conrelid = 'public.profiles'::regclass
                and fk.confrelid = 'auth.users'::regclass)
       and (namespace.nspname, relation.relname, attribute.attname) not in (
         ('public',  'adherence_message_reads',         'member_id'),
         ('public',  'announcement_reads',              'member_id'),
         ('public',  'deal_code_reveals',               'member_id'),
         ('private', 'email_digests',                   'member_id'),
         ('public',  'member_group_unselected',         'member_id'),
         ('public',  'member_imports',                  'member_id'),
         ('public',  'notification_email_preferences',  'member_id'),
         ('public',  'notification_push_preferences',   'member_id'),
         ('public',  'notifications',                   'member_id'),
         ('public',  'privacy_notice_acknowledgements', 'member_id'),
         ('public',  'push_tokens',                     'member_id'),
         ('public',  'role_history',                    'member_id'))
     order by 1, 2, 3
  loop
    if (v_fk.schema_name, v_fk.table_name, v_fk.column_name) = ('public', 'group_members', 'member_id') then
      -- A Group Manager or Group Responsible position holds the account; an
      -- ordinary membership goes with it.
      select count(*) into v_n
        from public.group_members
       where member_id = p_member_id and group_role <> 'member';
    elsif (v_fk.schema_name, v_fk.table_name) = ('public', 'profiles') then
      -- A column of profiles naming the Member on their own row goes with
      -- that row; naming them on someone else's holds the account.
      execute format('select count(*) from public.profiles where %I = $1 and id <> $1',
                     v_fk.column_name)
         into v_n
        using p_member_id;
    elsif (v_fk.schema_name, v_fk.table_name, v_fk.column_name) = ('public', 'role_history', 'changed_by') then
      -- A Role change the Member decided for someone else; a row about the
      -- Member themselves goes with them.
      select count(*) into v_n
        from public.role_history
       where changed_by = p_member_id and member_id <> p_member_id;
    else
      execute format('select count(*) from %I.%I where %I = $1',
                     v_fk.schema_name, v_fk.table_name, v_fk.column_name)
         into v_n
        using p_member_id;
    end if;
    if v_n > 0 then
      v_holds := v_holds || jsonb_build_object(
        case when v_fk.schema_name = 'public' then '' else v_fk.schema_name || '.' end
          || v_fk.table_name || '.' || v_fk.column_name,
        v_n);
    end if;
  end loop;
  return v_holds;
end;
$$;

comment on function private.member_deletion_holds(uuid) is
  'R59 (#1087): what holds an account, one key per referencing column ("tasks.created_by") with its count, only the non-zero ones. Read from the catalog: every foreign key into profiles or auth.users outside the auth schema counts, a SET NULL actor column and any other column of profiles included, except the login key profiles.id itself, the account''s own columns (private.member_deletion_goes, R66''s adherence_message_reads among them), an ordinary Group membership, the Role History about the Member and a profiles column naming the Member on their own row.';
