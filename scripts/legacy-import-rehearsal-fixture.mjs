// scripts/legacy-import-rehearsal-fixture.mjs -- #1049: SQL for the LOCAL rehearsal of the Legacy Import.
//
// Reads the import file and prints SQL that provisions one placeholder Member
// per profile_id and one placeholder Group per group_id, carrying the file's
// ids. No name from the file is read or printed.
//
// The placeholders are deliberately not uniform, so the rehearsal imports the
// rows a finished Task added in the app would refuse:
//   * the first Member of the file is the rehearsal Moderator -- the acting
//     Member is then credited by their own run;
//   * the others rotate through bc, bce, vot and voluntar;
//   * every third Group carries a Minimum Level above a Voluntar.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REHEARSAL_MODERATOR_EMAIL = "rehearsal-moderator@test.local";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function placeholder(id, n) {
  if (n === 0) {
    return {
      id,
      name: "Moderator repetiție",
      email: REHEARSAL_MODERATOR_EMAIL,
      role: "moderator",
    };
  }
  const role =
    n % 12 === 3
      ? "bc"
      : n % 12 === 7
        ? "bce"
        : n % 4 === 1
          ? "vot"
          : "voluntar";
  return {
    id,
    name: `Membru repetiție ${n}`,
    email: `rehearsal-${n}@test.local`,
    role,
  };
}

export function fixtureSql(rows) {
  const members = [...new Set(rows.map((row) => row.profile_id))].sort();
  const groups = [...new Set(rows.map((row) => row.group_id))].sort(
    (a, b) => a - b,
  );
  for (const id of members)
    if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`);
  for (const id of groups)
    if (!Number.isInteger(id)) throw new Error(`not a Group id: ${id}`);
  const people = members.map(placeholder);
  const lines = ["begin;"];
  lines.push(
    "insert into auth.users (id, email) values",
    people.map((person) => `  ('${person.id}', '${person.email}')`).join(",\n"),
    "on conflict (id) do nothing;",
  );
  lines.push(
    "insert into public.profiles (id, full_name, email, role, status, joined_at) values",
    people
      .map(
        (person) =>
          `  ('${person.id}', '${person.name}', '${person.email}', '${person.role}', 'activ', '2025-01-01')`,
      )
      .join(",\n"),
    "on conflict (id) do nothing;",
  );
  lines.push(
    "insert into public.groups (id, name, category, min_level) overriding system value values",
    groups
      .map((id) => `  (${id}, 'Grup repetiție ${id}', 'project', 0)`)
      .join(",\n"),
    "on conflict (id) do nothing;",
    "select setval(pg_get_serial_sequence('public.groups', 'id'), (select max(id) from public.groups));",
    "update public.groups set status = 'active' where id in (" +
      groups.join(", ") +
      ");",
    // Every third Group gets a Minimum Level above a Voluntar. A Group that
    // accepts Applications keeps its application level at or above it
    // (groups_application_level_ck), and a Group with Child Groups is left
    // alone (its level may not rise above theirs).
    "update public.groups as grp set min_level = 3, " +
      "application_level = case when grp.application_level is not null then greatest(grp.application_level, 3) end " +
      "where grp.id in (" +
      (groups.filter((id) => id % 3 === 0).join(", ") || "null") +
      ") and not exists (select 1 from public.groups as child where child.parent_id = grp.id);",
  );
  lines.push("commit;");
  return lines.join("\n") + "\n";
}

// Only when run as a script: importing fixtureSql must not read a file.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!process.argv[2]) {
    console.error(
      "usage: node scripts/legacy-import-rehearsal-fixture.mjs <import-set.json>",
    );
    process.exitCode = 2;
  } else {
    process.stdout.write(
      fixtureSql(JSON.parse(readFileSync(process.argv[2], "utf8"))),
    );
  }
}
