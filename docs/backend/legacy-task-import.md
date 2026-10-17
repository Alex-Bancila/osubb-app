# Legacy Task Tracker import (#1049)

> **Closed.** The import ran once in production on 2026-10-17: 5 411 sheet rows, 29 392 Task Points, 219 Members, read back against the file (recorded on #1049). #1050 dropped `public.import_legacy_tasks` and `public.legacy_task_import_totals`, and every `legacy_migration` Evaluation is refused again. Nothing on this page can run any more; it stays as the record of how the run was done.

The one-time copy of the pre-app Google Sheets Task Tracker into production. Design: [the spec](../superpowers/specs/2026-10-13-legacy-task-import-design.md); rule: ADR-0007, amendment of 2026-10-14. After the verified production run the command is dropped (#1050) and none of this is ever run again.

## What you need

| Thing                 | Where it comes from                                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `import-set.json`     | `../osubb-legacy-import/`, built by `node parse.js && node match.js && node build-import.js`. Never in this repo. |
| `SUPABASE_URL`        | Project Settings → API → Project URL                                                                              |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → Secret keys. Read from the environment only; never printed.                         |
| The Moderator's email | The acting Member. Nobody else may run the import.                                                                |

Every Group the file names must exist and be active, and every Member must be `activ`. The dry run says which row is not.

## Rehearse locally first

On a branch that has the migration, with the local stack up and no other session using it:

```bash
npx supabase db reset
```

```bash
bash scripts/legacy-import-rehearsal.sh ../osubb-legacy-import/import-set.json
```

It provisions placeholder Members and Groups carrying the file's ids, runs the dry run, the real run and a second run, and ends with `REHEARSAL PASSED`. Open a few imported Tasks, one Member's points and a Clasament period in the local app, then reset the database again.

## The production run

Pick a quiet hour: every batch broadcasts its rows to open clients, and 67 promotion-candidate Notifications reach BC and the Moderator when the points land.

1. **Confirm a backup.** Dashboard → Database → Backups: note the time of the latest one. It is the only undo.
2. **Dry run** — writes nothing:

```bash
SUPABASE_URL=https://<production-ref>.supabase.co SUPABASE_SECRET_KEY=sb_secret_… node scripts/import-legacy-tasks.mjs --file ../osubb-legacy-import/import-set.json --actor <the Moderator's address> --dry-run
```

It must end with `Dry run: 5270 would be imported, 0 already imported. Nothing was written.` and the per-Group lines must match `import-summary.json`.

3. **The real run** — the same line with `--execute`. It must end with `Verified: … matching the file for every Group and Member.`
4. **Look.** Three imported Tasks from different Groups, one Member's total, Clasament for March 2026, the promotion candidates in Administrare → Evaluări de rol.

## When something goes wrong

- **A batch was refused** (a 4xx answer from the command). The line names the row. Nothing of that batch was written; the batches before it are in. Fix the row in `../osubb-legacy-import` (or the Member or Group in the app), rebuild the file and run the same command again: registered rows are skipped.
- **A batch got no answer** (a dropped connection, a 5xx, a gateway page). It may or may not have been written. Run the same command again; the registry decides.
- **A batch timed out** (`57014`). The statement was cancelled, so nothing of that batch was written. Run again with `--batch-size 50`.
- **The database scores a batch differently from the file.** The scoring guide in the database is not the one the import set assumes. In a dry run nothing was written; in the real run that one batch is in. Stop, and settle which guide is right before going on.
- **The totals do not match.** Do not close the import. The read-back compares the Evaluations, the ledger rows they paid, the first and last completion day, and every Group and Member; the mismatch lines name what differs. Compare with `import-set.csv`. A Task deleted for good since the run explains a lower total.
- **The data itself is wrong.** One Task: delete it for good in the app, which reverses its points. Many: restore the backup of step 1.

**Look before closing.** An imported Task cannot be edited or reopened, like any finished Task that has no `command` Evaluation. Once #1050 has dropped the command, a wrong one can only be deleted for good: adding the work again in the app dates it today and cannot credit a BC member or the Moderator, and its sheet row stays claimed. Whatever needs correcting is corrected in the import set, before the real run.

## Closing

When the run is verified, #1050 drops `public.import_legacy_tasks` and `public.legacy_task_import_totals`. `public.legacy_task_imports` stays: it is the record of which sheet row became which Task.
