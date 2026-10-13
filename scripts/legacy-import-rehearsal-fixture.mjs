// scripts/legacy-import-rehearsal-fixture.mjs -- #1049: SQL for the LOCAL rehearsal of the Legacy Import.
//
// Reads the import file and prints SQL that provisions one placeholder Member
// per profile_id and one placeholder Group per group_id, carrying the file's
// ids, plus the rehearsal Moderator. No name from the file is read or printed.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REHEARSAL_MODERATOR = {
  id: "facade00-0000-4000-8000-000000000001",
  email: "rehearsal-moderator@test.local",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fixtureSql(rows) {
  const members = [...new Set(rows.map((row) => row.profile_id))].sort();
  const groups = [...new Set(rows.map((row) => row.group_id))].sort(
    (a, b) => a - b,
  );
  for (const id of members)
    if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`);
  for (const id of groups)
    if (!Number.isInteger(id)) throw new Error(`not a Group id: ${id}`);
  const lines = ["begin;"];
  const users = [
    [REHEARSAL_MODERATOR.id, REHEARSAL_MODERATOR.email],
    ...members.map((id, n) => [id, `rehearsal-${n + 1}@test.local`]),
  ];
  lines.push(
    "insert into auth.users (id, email) values",
    users.map(([id, email]) => `  ('${id}', '${email}')`).join(",\n"),
    "on conflict (id) do nothing;",
  );
  lines.push(
    "insert into public.profiles (id, full_name, email, role, status, joined_at) values",
    [
      `  ('${REHEARSAL_MODERATOR.id}', 'Moderator repetiție', '${REHEARSAL_MODERATOR.email}', 'moderator', 'activ', '2025-01-01')`,
      ...members.map(
        (id, n) =>
          `  ('${id}', 'Membru repetiție ${n + 1}', 'rehearsal-${n + 1}@test.local', 'voluntar', 'activ', '2025-01-01')`,
      ),
    ].join(",\n"),
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
