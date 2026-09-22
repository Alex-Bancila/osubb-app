-- #574: the Organization marker on public.groups — one native boolean that names the
-- Adunarea Generală's Group, so nothing has to ask `legacy_dept_id = 'org'` any more
-- (ADR-0009, Wave 3 ruling R1).
--
-- Why a column rather than a lookup: the three Event commands
-- (`create_event_impl`, `update_event_impl`, `cancel_event_impl`) currently recognise the
-- Organization by its legacy id, and `groups.legacy_dept_id` is one of the columns Wave 3
-- drops with `public.departments`. T9 switches those three readers onto this marker; this
-- migration only creates it, backfills it and teaches the mirror to keep producing it, so
-- the two changes can land in separate reviews.
--
-- Why an index instead of a check constraint: "exactly one" is a table-level fact, and a
-- CHECK is per-row. A partial unique index over the true rows is the only declarative form
-- Postgres offers, and it is the form Wave 3's `update_group_structure` will rely on when
-- BC moves the marker (it will clear the old row and set the new one in one statement).
-- The index is PARTIAL on purpose: a total unique index on the column would allow one
-- true row and one false row and nothing else.
--
-- The floor — "at least one" — is deliberately not enforced here. Nothing can express it
-- declaratively without a statement trigger over the whole table, and a database with no
-- Organization Group is a real intermediate state during Wave 3's strangler (a native
-- database built from scratch has no Organization until BC creates one in Administrare).

alter table public.groups
  add column is_organization boolean not null default false;

comment on column public.groups.is_organization is
  'Marks the one Group that is OSUBB itself (the Adunarea Generală''s Group, ADR-0009). Structural: only BC or a Moderator moves it. At most one Group carries it — groups_one_organization_uidx — and authority code asks this column, never groups.category and never legacy_dept_id.';

-- Unique over the marked rows only, so the unmarked majority is unconstrained.
create unique index groups_one_organization_uidx
  on public.groups (is_organization)
  where is_organization;

-- ==================== Backfill ====================
-- The `org` pseudo-department is the Organization today; #508 already mirrored it into the
-- Group named OSUBB. A direct UPDATE is correct here even though §10 forbids hand-editing
-- `groups`: `private.sync_department_groups` never writes this column on its conflict arm
-- (below), so nothing overwrites it afterwards.
update public.groups
   set is_organization = true
 where legacy_dept_id = 'org';

-- ==================== The mirror keeps producing it ====================
-- Mirror decision: `is_organization` joins the sync's INSERT column list and stays out of
-- its `do update` set and guard.
--
--   * In the insert list, because the Organization Group is a row the mirror can legitimately
--     (re-)create — `private.sync_groups_from_legacy()` sweeps orphans and re-inserts, and
--     `supabase/tests/groups_backfill_upgrade.test.sh` replays exactly that path over a
--     truncated mirror. Leaving the column outside the mapping would let a rebuilt mirror
--     come back with *zero* marked Groups, which groups_one_organization_uidx cannot catch:
--     a partial unique index forbids a second marker, never a missing one. Conventions §10
--     says mapping changes belong in `private.sync_*`, and this is one.
--   * Out of the `do update` arm, because the marker is a structural setting Wave 3 hands to
--     BC (decision 5). Re-syncing a Department must never reset it, and — just as important
--     — the `is distinct from` guard that keeps a no-op resync from touching `updated_at`
--     stays exactly as `groups_sync.test.sql`'s fixpoint assertion pins it.
--
-- Consequence, stated rather than discovered later: mirroring a *second* `kind = 'org'`
-- department now fails with 23505 on groups_one_organization_uidx instead of silently
-- creating a second Organization. No migration, seed or suite creates one — `0001_core_schema`
-- inserts the single `org` row as reference data — and the refusal is the invariant doing its
-- job. `supabase/tests/groups_sync.test.sql` pins it.
--
-- Everything else below is #508's mapping, unchanged.

create or replace function private.sync_department_groups(p_dept_id text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.groups as grp
    (name, category, parent_id, competes_in_cup, counts_toward_parent_cup, min_level,
     accepts_applications, application_level, shared_work_visibility, automatic_membership,
     manager_title, status, short, color, is_organization, legacy_dept_id)
  select case when dept.kind = 'org' then 'OSUBB' else dept.name end,
         case when dept.kind = 'org' then 'organization' else 'department' end,
         null,
         -- Diverse and Secretariat are Departments whose Cup setting is off
         -- (ADR-0009 Other rulings); `departments.kind` gets no successor column.
         dept.kind = 'department',
         true,
         0,
         false,
         -- Applications stay off everywhere: no Application flow exists before Wave 3.
         -- The level is pre-filled to the ADR's value so switching it on is one column.
         case when dept.kind = 'org' then null else 1 end,
         false,
         dept.kind = 'org',
         case when dept.kind = 'org' then null else 'BCE' end,
         'active',
         dept.short, dept.color,
         -- #574: set at first sight, never re-derived. See this migration's header.
         dept.kind = 'org',
         dept.id
    from public.departments as dept
   where p_dept_id is null or dept.id = p_dept_id
  on conflict (legacy_dept_id) do update
     set name = excluded.name, category = excluded.category,
         competes_in_cup = excluded.competes_in_cup,
         application_level = excluded.application_level,
         automatic_membership = excluded.automatic_membership,
         manager_title = excluded.manager_title,
         short = excluded.short, color = excluded.color
   where (grp.name, grp.category, grp.competes_in_cup, grp.application_level,
          grp.automatic_membership, grp.manager_title, grp.short, grp.color)
         is distinct from
         (excluded.name, excluded.category, excluded.competes_in_cup, excluded.application_level,
          excluded.automatic_membership, excluded.manager_title, excluded.short, excluded.color);
end;
$$;

comment on function private.sync_department_groups(text) is
  'Mirrors public.departments into public.groups: a delivery Department competes in the Cup, a coordination structure does not, and the org pseudo-department becomes the Organization Group — carrying groups.is_organization, which is set at first sight and never re-derived (#508, #574, ADR-0009).';
