-- Ruling R44, amended twice on 2026-10-08. Alex: "I, as a moderator should also
-- be able to select all members of the team", then "I am a superuser as a
-- moderator, so i should be able to do anything a BC member could do".
--
-- The rule, in one place: **the Moderator holds every Atribuție's powers.** A
-- Member whose live level is 9 has, in every Atribuție, the holder's place in
-- private.assignment_team_role -- the one definition every capability, policy
-- and command already reads. For OSUBB Deals that means the Moderator publishes
-- Deals (private.can_publish_announcement), edits and deletes any Deal
-- (private.can_manage_deal), reads the reveal count and the readers list, sets
-- both the Coordonator and the Responsabil (public.set_assignment_team_member),
-- and my_capabilities() answers manage_deals, manage_deals_team and
-- pick_deals_coordinator true -- with no change to any of those bodies. A future
-- Atribuție that reads private.assignment_team_role inherits the rule.
--
-- Unchanged: an Atribuție still has exactly one holder, a live BC member
-- (bc_assignments, public.set_bc_assignment); the Moderator is never that
-- holder and is never listed in Administrare BC (public.bc_assignments_directory
-- reads the rows, not this function); an Atribuție nobody holds still has no
-- team for anyone to pick, the Moderator included (set_assignment_team_member's
-- own check on the row); BC members who do not hold it keep what their rank
-- gives them. Live rows only: a Moderator demoted below level 9 loses the powers
-- whatever the token says.

create or replace function private.assignment_team_role(p_assignment text, p_member uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Live rows only: a holder demoted below bc, a Coordonator no longer bce, or
  -- anyone no longer activ keeps the row but loses the power until the
  -- Moderator or the holder changes it.
  select case
    -- R44 amended 2026-10-08: the Moderator holds every Atribuție's powers,
    -- without being its holder. The one place that says so.
    when private.actor_level(p_member) >= 9
      then 'holder'
    when exists (select 1 from public.bc_assignments as held
                  where held.assignment = p_assignment and held.member_id = p_member)
         and private.actor_level(p_member) = 6
      then 'holder'
    when exists (select 1 from public.assignment_team as team
                  where team.assignment = p_assignment and team.member_id = p_member
                    and team.team_role = 'coordinator')
         and private.actor_level(p_member) = 5
      then 'coordinator'
    when exists (select 1 from public.assignment_team as team
                  where team.assignment = p_assignment and team.member_id = p_member
                    and team.team_role = 'responsible')
         and private.actor_level(p_member) is not null
      then 'responsible'
  end;
$$;

comment on function private.assignment_team_role(text, uuid) is
  'R44: the Member''s live powers in an Atribuție -- holder (holds it and is live bc, level 6; or is the live Moderator, level 9, who holds every Atribuție''s powers without being its holder, R44 amended 2026-10-08), coordinator (the team''s Coordonator and live bce, level 5), responsible (the team''s Responsabil and live activ) -- or null. The one definition every capability, policy and command reads; who holds the Atribuție is bc_assignments, never this function. Granted to nobody: definer code calls it; policies call private.deals_team_role().';

comment on function private.deals_team_role() is
  'R44/R45: the caller''s live powers in the OSUBB Deals team (holder -- the holder or the Moderator --, coordinator, responsible) or null; null without organization claims. Policy predicate: authenticated may execute it.';

comment on function private.set_assignment_team_member_impl(text, text, uuid) is
  'R44: body of public.set_assignment_team_member. Step 1: PT400 invalid_assignment, invalid_team_role. Then 42501 assignment_team_forbidden unless the live caller has the holder''s powers (the holder or the Moderator, either place) or is the Coordonator (the responsible place only), judged by private.assignment_team_role under the Atribuție row FOR NO KEY UPDATE; nobody holds it -- nobody may pick, the Moderator included. The place is locked FOR UPDATE. A null member clears it. Otherwise PT400 coordinator_not_bce (a Coordonator is live bce, level 5), invalid_team_member (a Responsabil is a live activ Member), assignment_team_duplicate (the holder, or the member of the other place); the same member again changes nothing. Notifies the member set ("Ești acum Coordonator/Responsabil OSUBB Deals", link /administrare/deals) and the one replaced or cleared ("Nu mai ești ..."), kind system. Returns the row, or null when cleared.';

comment on function public.set_assignment_team_member(text, text, uuid) is
  'R44: the holder of an Atribuție -- and the Moderator, who holds every Atribuție''s powers (R44 amended 2026-10-08) -- picks its Coordonator (p_team_role coordinator, a BCE member) and its Responsabil (responsible, any active Member); the Coordonator picks only the Responsabil. p_member_id null clears the place. Reasons: PT400 invalid_assignment / invalid_team_role / coordinator_not_bce / invalid_team_member / assignment_team_duplicate, 42501 assignment_team_forbidden.';

comment on function private.my_capabilities_impl() is
  'The body of public.my_capabilities() (#576). Always exactly one row; every column false for a caller without organization claims or whose Profile is not activ (a stale claim is not authority). Columns from live state only: manages_any_group = holds_any_group_role() or level >= 6; manage_tasks = public.can_manage_tasks() (one predicate, two readers); see_directory and see_leadership = level >= 5; manage_roles, provision_members and create_top_level_groups = level >= 6; administer = manages_any_group or level >= 6 or manage_deals (R44: the Deals team reaches Administrare); administer_bc = level >= 9 (the Moderator, R44); manage_deals = a place in the OSUBB Deals team (holder, Coordonator or Responsabil, private.assignment_team_role); manage_deals_team = holder or Coordonator; pick_deals_coordinator = holder. The Moderator has the holder''s place in every Atribuție (R44 amended 2026-10-08), so all three Deals columns.';

comment on function private.can_publish_announcement(bigint, text) is
  '#909, R45: whether the live caller may publish an Announcement (p_kind announcement, the default) from this Origin Group -- the compose rule of announcements_create (#581), lifted into one predicate that the policy and create_event(p_announce) both read -- or a Deal (p_kind deal): the OSUBB Deals team (private.deals_team_role: holder, Coordonator or Responsabil) and the Moderator, who holds every Atribuție''s powers (R44 amended 2026-10-08).';
