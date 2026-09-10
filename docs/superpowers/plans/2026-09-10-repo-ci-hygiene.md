# Repo & CI hygiene — Stack A (2026-09-10, batch 2)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. On approval this file is copied to `docs/superpowers/plans/2026-09-10-repo-ci-hygiene.md` and executed task-by-task (one implementer per task, task review after each, one whole-stack review at the end). Steps use `- [ ]` syntax.

**Goal:** Close the six unblocked, unassigned repo/CI hygiene issues — #359, #356, #358, #357, #373, #378 — as one standalone PR plus one five-deep stack, without changing what CI tests.

**Architecture:** Pure tooling: root files, `.github/`, `scripts/`, and the Edge-Function config. No migrations, no app code, no behavior change except (a) the invite Edge Function's CORS moves from `*` to an allow-list and (b) CI gains a secret-scan job. Every PR is `Closes #n`, CI green, merged by Alex.

**Tech stack:** GitHub Actions, npm (root + `app/`), Deno 2 (Edge Functions), bash + psql (`scripts/`), gitleaks.

**Spec:** the six issue bodies (dumped to the scratchpad `candidate-bodies.md`) + CLAUDE.md house rules 7–9. Codebase facts below were verified on `origin/main` @ `22ed8cd` (after #393).

## Context

Alex asked for the next batch of unblocked issues in priority order *clean the code → clean inconsistencies → Tracker backend/frontend → Calendar*, and chose to take **only Stack A (repo/CI hygiene)** this round. Blocker graph on 2026-09-10 (169 open issues): all six are `None — can start immediately`; none is assigned to a teammate (dobrerares holds #280/#287/#322/#362/#364/#370, PaulSchiop #283/#285, SuperGod25 #258). Stacking is explicitly allowed (“i don't mind stack prs”), but the earlier mishap (PRs #391/#392 merged into their *base branches*, not `main`) means the merge protocol below is part of the deliverable.

Alex's decisions for #356 (asked 2026-09-10): delete the 640 KB root transcript, gitignore `.codex-artifacts/` and `.claude/launch.json`, move `deliverables/` to a sibling folder outside the repo (`..\osubb-deliverables`), commit `docs/superpowers/plans/`.

### Verified facts that shape the tasks

- Untracked at root: `package.json` (npm-init boilerplate, `supabase ^2.117.0`), `package-lock.json`, `AGENTS.md` (stale 2026-08-24 fork of CLAUDE.md: “17 migrations”, “`app/` does not exist yet”, ADRs 0001–0006), `2026-08-26-205322-this-session-…txt` (652,986 B), `.codex-artifacts/` (12 MB PNG dumps), `deliverables/` (one 52 KB .docx), `docs/superpowers/plans/` (two .md, 80 KB), `.claude/launch.json`. No `.editorconfig`, no `.nvmrc` anywhere.
- Line endings: `git ls-files --eol | grep crlf` → 11 files, **all `i/lf w/crlf`** — the index is already LF; only the Windows working tree is CRLF (`README.md`, `docs/adr/0003-*.md`, `docs/backend/{inviting,seeding-staging}.md`, all 7 files under `supabase/functions/`). `git add --renormalize .` is therefore a no-op on the index; the real fixes are `.editorconfig` + a re-checkout recipe.
- `.github/` holds exactly two files: `workflows/ci.yml` (267 lines; jobs `db`, `functions`, `frontend`, `push-staging`) and `workflows/seed-staging.yml`. No `permissions:` anywhere; `concurrency` only job-level on `push-staging` (`group: staging-deploy`, cancel false) and on `seed-staging` (same group — deliberate, keep). Actions float: `actions/checkout@v4` ×5, `supabase/setup-cli@v1` ×2 (`version: 2.117.0` at ci.yml:17 and :248), `denoland/setup-deno@v2` (:177), `actions/setup-node@v4` (`node-version: 24`, :201).
- Inline seed re-runnability step = ci.yml **lines 42–152**: fingerprint SQL over 13 tables (:44-75), `docker exec -i supabase_db_osubb-app psql` (:77), sentinel UUID `e2750000-0000-0000-0000-000000000001`, demo-lead UUID `d0000000-…005`, and the hardcoded `"$guarded" != "1:8"` (:116). `supabase/config.toml:5` has `project_id = "osubb-app"` (→ container name).
- `supabase/functions/`: `invite-member/{deno.json,deno.lock,deps.ts,handler.ts,handler.test.ts,index.ts}` + `_shared/cors.ts`. `deno.json` imports: `@supabase/supabase-js → jsr:@supabase/supabase-js@^2` and the redundant self-mapping `"jsr:@std/assert@^1": "jsr:@std/assert@^1"`. ci.yml:183/186 hardcode `--config supabase/functions/invite-member/deno.json`. `cors.ts` exports a constant `corsHeaders` with `Access-Control-Allow-Origin: "*"` and `json(body, status)`. `config.toml:87` has a `[functions.invite-member]` section.
- `scripts/` holds only `create-github-issues.sh` (header says “Run ONCE”, first `gh` call at line 18 after `set -euo pipefail`).
- Repo owner is a **user account** (`Alex-Bancila`), so `gitleaks/gitleaks-action` needs no `GITLEAKS_LICENSE`.

## Global constraints

- One issue = one branch = one PR, body `Closes #n`, CI green; **never merge, never push to `main`** (house rule 7). Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Secrets never in git; **never `gh secret set` from a non-interactive shell** (house rule 8) — any secret/variable is a listed human action.
- `scripts/create-github-issues.sh` must never be executed (house rule 9) — Task 0 only edits it and proves it refuses to run.
- No change to what CI tests: every existing job keeps its steps' semantics; only where they get their inputs changes.
- Stacked PRs: create with `gh pr create --base <parent-branch>`; the PR body's first line names the base and says “merge after #<parent PR>”.
- Delete nothing on disk beyond what Alex approved (the transcript). `deliverables/` is *moved*, not deleted.

## Batch overview

| Order | Issue | Branch | Base | PR target | Size |
|---|---|---|---|---|---|
| 0 | #359 script guard | `chore/359-guard-issue-script` | `main` | `main` | 10 min |
| 1 | #356 root tooling / editorconfig / artefacts | `chore/356-root-hygiene` | `main` | `main` | 45 min |
| 2 | #358 templates / CODEOWNERS / dependabot / license | `chore/358-github-metadata` | `chore/356-root-hygiene` | that branch | 30 min |
| 3 | #357 CI hardening | `ci/357-hardening` | `chore/358-github-metadata` | that branch | 45 min |
| 4 | #373 seed check → script | `ci/373-seed-check-script` | `ci/357-hardening` | that branch | 60 min |
| 5 | #378 gitleaks / shared deno.json / CORS allow-list | `ci/378-secret-scan-deno-cors` | `ci/373-seed-check-script` | that branch | 60 min |

Why this stack shape: 2 needs 1's root `package.json` (license field); 3 needs 2's file (version pin check) and edits `ci.yml`; 4 and 5 edit `ci.yml` too (removing lines 42–152 and adding a job) — a linear stack avoids three-way rebases. Task 0 shares no file with anything and goes straight to `main`.

### Merge protocol for Alex (the part that prevents a repeat of #391/#392, and recurred anyway as the 2026-09-10 Stack A mishap)

**What happened on 2026-09-10:** PR #396 merged into `main` correctly, but #397, #398, #399 and #400 each merged into their *stacked base branch* instead, because that base branch was never deleted — GitHub had nothing to retarget. `main` was left missing the work from #358, #357, #373 and #378 even though every PR read "Merged". Recovered by the `fix/stack-a-recovery` PR (built from `ci/378-secret-scan-deno-cors`, the superset branch, merged up to date with `main`).

The corrected facts, in place of the older assumptions above:

1. GitHub retargets a stacked PR to `main` **only when its base branch is deleted**. This repo has "Automatically delete head branches" **off**, and "Delete branch" is a button on the merged PR's page — not a tick-box inside the merge dialog itself. Skip it and the next PR keeps its stale base and merges into that branch, not `main`.
2. Retargeting a PR's base fires a `pull_request: edited` event, which `ci.yml` does not listen to — CI does **not** automatically re-run against `main` after a retarget. Close and reopen the PR (or push a new commit to it) to force a fresh run before merging.
3. Always use "Create a merge commit" for a stack; squash or rebase on a lower PR rewrites its history and forces conflicts on the PR above it.
4. Before merging any PR, read its base field yourself; merge only when it says `main`. Never merge a PR whose base names a `chore/…` or `ci/…` branch — that is the mishap.
5. After merging, click "Delete branch" on that PR's page before moving to the next one in the stack — this is the step that makes step 1 above actually happen.

---

### Task 0: #359 — hard-guard the historical issue-creation script

**Files:** Modify `scripts/create-github-issues.sh` (header comment + new guard block). Model: cheapest tier.

- [ ] Branch from `main`: `git switch -c chore/359-guard-issue-script origin/main`.
- [ ] Replace the header line `# Run ONCE (gh issue create is not idempotent — re-running duplicates issues):` and the `#   bash scripts/create-github-issues.sh` line with:
  ```bash
  # HISTORICAL — EXECUTED 2026-08-12. DO NOT RUN.
  # This created the original backlog once. `gh issue create` is not idempotent:
  # running it again duplicates ~100 issues (CLAUDE.md house rule 9).
  ```
- [ ] Immediately after `set -euo pipefail` (before the first `command -v gh`), insert:
  ```bash
  if [ "${I_REALLY_WANT_TO_RECREATE_THE_BACKLOG:-}" != "1" ]; then
    echo "HISTORICAL — EXECUTED 2026-08-12. DO NOT RUN." >&2
    echo "This script would duplicate the whole GitHub backlog. Refusing." >&2
    echo "Override only on a fresh, empty repository: I_REALLY_WANT_TO_RECREATE_THE_BACKLOG=1 bash $0" >&2
    exit 1
  fi
  ```
- [ ] Prove it: `PATH=/nonexistent /usr/bin/bash scripts/create-github-issues.sh; echo "exit=$?"` → banner on stderr, `exit=1`, and no `gh` invocation possible (gh is not on that PATH). Do **not** run it with the override.
- [ ] Commit `chore(scripts): hard-guard the historical issue-creation script (#359)`; push; `gh pr create --base main` with `Closes #359`.

### Task 1: #356 — root tooling, `.editorconfig`, artefacts

**Files:** Create `.editorconfig`; overwrite root `package.json` + regenerate `package-lock.json`; modify `.gitignore`, `CLAUDE.md` (one Windows note); rewrite `AGENTS.md`; add `docs/superpowers/plans/*.md`; delete the transcript; move `deliverables/`. Model: standard tier (file moves + judgment).

- [ ] Branch from `main`: `chore/356-root-hygiene`.
- [ ] Root `package.json` — replace wholesale (exact pin = CI's `2.117.0`; license comes in Task 2):
  ```json
  {
    "name": "osubb-app",
    "private": true,
    "engines": { "node": ">=24" },
    "devDependencies": { "supabase": "2.117.0" }
  }
  ```
  then `rm package-lock.json && npm install` at root; verify `npx supabase --version` prints `2.117.0`.
- [ ] `.editorconfig`:
  ```ini
  root = true

  [*]
  charset = utf-8
  end_of_line = lf
  insert_final_newline = true
  trim_trailing_whitespace = true
  indent_style = space
  indent_size = 2

  [*.md]
  trim_trailing_whitespace = false
  ```
- [ ] `.gitignore` — append:
  ```gitignore
  # Coverage and TypeScript incremental build info
  coverage/
  *.tsbuildinfo

  # Agent/session artefacts — never project history
  .codex-artifacts/
  *-this-session-is-being-continued-*.txt
  .claude/launch.json
  ```
- [ ] Artefacts (Alex-approved): `rm 2026-08-26-205322-this-session-is-being-continued-from-a-previous-c.txt`; `mkdir -p ../osubb-deliverables && mv deliverables/* ../osubb-deliverables/ && rmdir deliverables`. `.codex-artifacts/` stays on disk, now ignored.
- [ ] `AGENTS.md` — replace the stale fork with a pointer and commit it:
  ```md
  # AGENTS.md

  Agent instructions for this repository live in [`CLAUDE.md`](CLAUDE.md): read it, then `CONTEXT.md`, ADR-0007 and ADR-0008, before taking work. This file exists only so tools that look for `AGENTS.md` land in the right place; it carries no rules of its own and must not be edited independently.
  ```
- [ ] `git add docs/superpowers/plans/` (both existing files — project history, per the issue).
- [ ] `git add --renormalize .` (expected: no index change — the 11 flagged files are already LF in the index). Fix the local working tree so the AC command is clean: `git ls-files --eol | awk '$2=="w/crlf"{print $4}' | xargs -r rm -- && git checkout -- .`; re-run `git ls-files --eol | grep w/crlf` → empty.
- [ ] `CLAUDE.md` — under the existing **Windows gotcha** bullet add one sentence: “If `git ls-files --eol | grep w/crlf` lists files, an editor wrote CRLF into your checkout: delete those files and `git checkout -- .` (the index is LF; `.editorconfig` keeps it that way).”
- [ ] Verify the AC: `git clone . ../osubb-clone-check && (cd ../osubb-clone-check && npm ci && cd app && npm ci && git status --porcelain)` → empty; then `rm -rf ../osubb-clone-check`.
- [ ] Commit `chore(repo): commit root tooling, add .editorconfig, ignore session artefacts (#356)`; PR → `main`, `Closes #356`, body lists what was deleted/moved and the AGENTS.md ruling.

### Task 2: #358 — PR/issue templates, CODEOWNERS, dependabot, license

**Files:** Create `.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/work-item.md`, `.github/CODEOWNERS`, `.github/dependabot.yml`; modify root `package.json`, `app/package.json`, `docs/team/team-plan.md`. Model: cheapest tier.

- [ ] Branch `chore/358-github-metadata` from `chore/356-root-hygiene`.
- [ ] `PULL_REQUEST_TEMPLATE.md`:
  ```md
  ## Summary

  <!-- What changed and why, in two or three sentences. Name the ADR / CONTEXT.md term when behavior changes. -->

  Closes #

  ## Checks run locally

  - [ ] `npx supabase db reset && npx supabase test db` (any change under `supabase/`)
  - [ ] `cd app && npm run typecheck && npm run lint && npm run format:check && npm run test:run && npm run build` (any change under `app/`)
  - [ ] `app/src/lib/database.types.ts` regenerated (`npm run gen:types`) if the schema changed

  ## Reviewer notes

  <!-- Stacked PR? First line: "Base: <branch> — merge after #n". Anything deliberately left out? -->
  ```
- [ ] `ISSUE_TEMPLATE/work-item.md` with front matter (`name: Work item`, `about: One issue = one branch = one PR. Link concrete #numbers under Blocked by.`, `labels: needs-triage`) and the house-rule-15 sections `## Goal`, `## Why`, `## What to build`, `## Implementation boundary`, `## Acceptance criteria` (one `- [ ]`), `## Required tests`, `## Blocked by` pre-filled with `None — can start immediately.`
- [ ] `CODEOWNERS`: `* @Alex-Bancila`.
- [ ] `dependabot.yml`: `github-actions` in `/` weekly (grouped, one PR); `npm` in `/app` weekly with a `minor-and-patch` group (`update-types: ["minor", "patch"]`). **No root npm entry** — the Supabase CLI pin moves together with `SUPABASE_CLI_VERSION` in CI (Task 3) and must stay a deliberate manual bump.
- [ ] `"license": "UNLICENSED"` in root `package.json` (after `"private"`) and in `app/package.json`.
- [ ] `docs/team/team-plan.md`: add a short “Branch protection on `main`” paragraph: required status checks = the three CI job display names (read them from `name:` in ci.yml — `db`, `functions`, `frontend` jobs), one approving review, linear history optional; enabling it is a human action in repo settings.
- [ ] Verify: `gh api repos/Alex-Bancila/osubb-app/contents/.github/dependabot.yml` is not needed — a local `npx --yes @dependabot/cli`? No: validate YAML shape by eye against docs and rely on the “Dependabot” tab after merge (AC is post-merge). `npm pkg get license` at root and in `app/` → `"UNLICENSED"`.
- [ ] Commit `chore(github): PR/issue templates, CODEOWNERS, dependabot, license field (#358)`; PR base `chore/356-root-hygiene`, `Closes #358`, first line `Base: chore/356-root-hygiene — merge after #<PR of Task 1>`.

### Task 3: #357 — CI least privilege, concurrency, SHA pins, one version source

**Files:** Modify `.github/workflows/ci.yml`, `.github/workflows/seed-staging.yml`; create `app/.nvmrc`. Model: standard tier.

- [ ] Branch `ci/357-hardening` from `chore/358-github-metadata`.
- [ ] Resolve pins (read-only API): for each of `actions/checkout`, `actions/setup-node`, `denoland/setup-deno`, `supabase/setup-cli`, `gitleaks/gitleaks-action`: `tag=$(gh api repos/<owner>/<repo>/releases/latest --jq .tag_name)` within the current major (v4 / v4 / v2 / v1 / v2), then `gh api repos/<owner>/<repo>/commits/$tag --jq .sha`. Record `<sha> # <tag>` for Task 5 too.
- [ ] `ci.yml` top level, after `on:`:
  ```yaml
  permissions:
    contents: read

  concurrency:
    group: ci-${{ github.ref }}
    cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}

  env:
    SUPABASE_CLI_VERSION: 2.117.0
  ```
  Keep the existing job-level `concurrency` on `push-staging` (`staging-deploy`, cancel false) — it serialises deploys against the seed workflow.
- [ ] Both `supabase/setup-cli` steps → `version: ${{ env.SUPABASE_CLI_VERSION }}`. Every `uses:` → `owner/repo@<sha> # <tag>`.
- [ ] `app/.nvmrc` containing `24`; `setup-node` → `node-version-file: app/.nvmrc` (path is workspace-relative even though the job's `working-directory` is `app`); refresh the comment above it. Keep `cache: npm` / `cache-dependency-path`.
- [ ] New step in the `db` job right after checkout — “CLI pin matches root package.json”:
  ```bash
  pinned="$(node -p "require('./package.json').devDependencies.supabase")"
  test "$pinned" = "$SUPABASE_CLI_VERSION" || { echo "::error::root package.json pins supabase $pinned but CI uses $SUPABASE_CLI_VERSION"; exit 1; }
  ```
- [ ] `seed-staging.yml`: `permissions: contents: read` at top; `environment: staging` on the job; pin checkout. (GitHub creates the `staging` environment on first run; adding required reviewers to it is a human action.)
- [ ] Verify locally: `npx --yes actionlint@latest` (or `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`) passes; `grep -c "2.117.0" .github/workflows/ci.yml` → `1`. After the PR opens: the run's *Set up job* log shows `GITHUB_TOKEN Permissions: Contents: read`; push twice quickly → the first run is cancelled.
- [ ] Commit `ci: least-privilege permissions, concurrency, pinned actions, one CLI version source (#357)`; PR base `chore/358-github-metadata`, `Closes #357`.

### Task 4: #373 — seed re-runnability check as a script

**Files:** Create `scripts/check-seed-rerunnable.sh`, `scripts/seed-fingerprint.sql`; modify `.github/workflows/ci.yml` (lines 42–152 → one `run:` line). Model: standard tier.

- [ ] Branch `ci/373-seed-check-script` from `ci/357-hardening`.
- [ ] `scripts/seed-fingerprint.sql`: the fingerprint query currently inlined at ci.yml:44-75, verbatim (13 tables; `\set`-free, plain SQL, one result row/text so `psql -At` prints something diff-able).
- [ ] `scripts/check-seed-rerunnable.sh` (`set -euo pipefail`, `cd "$(dirname "$0")/.."`):
  - Connection: `DB_URL="${DB_URL:-$(npx supabase status -o env 2>/dev/null | sed -n 's/^DB_URL=//p' | tr -d '"')}"`; define `run_sql() { psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -At "$@"; }`. If `psql` is not on PATH, fall back to `docker exec -i "supabase_db_$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 -At "$@"` (stdin-fed).
  - Steps, mirroring the inline block exactly: (1) `before=$(run_sql -f scripts/seed-fingerprint.sql)`; (2) `demo_before=$(run_sql -c "select count(*) from auth.users where email like '%@demo.osubb'")`; (3) create the preservation sentinel (same UUIDs/SQL as ci.yml today); (4) apply `supabase/seed.sql` again in one transaction (`-1 -f supabase/seed.sql`); (5) `after=$(…)`; `[ "$before" = "$after" ]` else print both and exit 1; (6) the guarded check compares against `"1:${demo_before}"` instead of `"1:8"`; (7) clean up the sentinel as today; print `seed.sql applied twice, same data`.
- [ ] `ci.yml`: replace the step body with `run: bash scripts/check-seed-rerunnable.sh`; keep a two-line version of the explanatory comment pointing at `docs/backend/seeding-staging.md`.
- [ ] Add a “Verify locally” line to `docs/backend/seeding-staging.md` naming the script.
- [ ] Verify: `npx supabase db reset && bash scripts/check-seed-rerunnable.sh` → passes (Git Bash on Windows; needs Docker running). Negative proof: temporarily append `insert into public.announcements (title, body) values ('dup', 'dup');` (no conflict clause) to `seed.sql`, re-run → script fails naming the fingerprint mismatch; revert.
- [ ] Commit `ci: extract the seed re-runnability check into scripts/check-seed-rerunnable.sh (#373)`; PR base `ci/357-hardening`, `Closes #373`.

### Task 5: #378 — secret scanning, shared Deno config, CORS allow-list

**Files:** Modify `.github/workflows/ci.yml` (new `secrets` job, deno config path); `git mv supabase/functions/invite-member/deno.json → supabase/functions/deno.json` and `deno.lock` alongside; modify `supabase/functions/_shared/cors.ts`, `invite-member/handler.ts`, `invite-member/handler.test.ts`, `invite-member/index.ts` (if it builds headers); create `.gitleaks.toml` only if needed; modify `docs/backend/inviting.md`; possibly `supabase/config.toml` (`[functions.invite-member] import_map`). Model: standard tier.

- [ ] Branch `ci/378-secret-scan-deno-cors` from `ci/373-seed-check-script`.
- [ ] Secret scan job (SHA from Task 3's lookup):
  ```yaml
  secrets:
    name: Secret scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # v4.x
        with: { fetch-depth: 0 }
      - uses: gitleaks/gitleaks-action@<sha> # v2.x
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITLEAKS_ENABLE_COMMENTS: "false"   # workflow token is contents: read only
  ```
  Before pushing, run the scanner locally over history: `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:latest git /repo --redact -v`. Any hit must be either a real secret (stop, tell Alex — never rewrite history unasked) or a well-known local demo key (the default local Supabase anon/service JWTs in docs/`.env.example`); allow-list those by path/regex in `.gitleaks.toml` with a comment saying why. No `GITLEAKS_LICENSE` — user-owned repo.
- [ ] Shared Deno config: move `deno.json` (drop the `"jsr:@std/assert@^1": "jsr:@std/assert@^1"` self-mapping) and `deno.lock` to `supabase/functions/`; ci.yml `deno check`/`deno test` → `--config supabase/functions/deno.json`; `deno check --config supabase/functions/deno.json supabase/functions/**/*.ts` and `deno test --allow-env --config supabase/functions/deno.json supabase/functions/` pass locally. Prove the CLI still resolves imports: `npx supabase functions serve invite-member --no-verify-jwt` starts without an import error (the CLI falls back to `supabase/functions/deno.json`); if it does not, add `import_map = "./functions/deno.json"` under `[functions.invite-member]` in `config.toml`.
- [ ] CORS allow-list — `_shared/cors.ts` becomes:
  ```ts
  const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

  export function allowedOrigins(): string[] {
    const raw = Deno.env.get("ALLOWED_ORIGINS");
    const list = raw?.split(",").map((o) => o.trim()).filter(Boolean) ?? [];
    return list.length > 0 ? list : DEFAULT_ALLOWED_ORIGINS;
  }

  export function corsHeaders(origin: string | null): Record<string, string> {
    const allowed = origin !== null && allowedOrigins().includes(origin);
    return {
      ...(allowed ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin" } : {}),
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    };
  }

  export function isAllowedOrigin(origin: string | null): boolean { … }
  export function json(body: unknown, status: number, origin: string | null): Response { … }
  ```
  Handler: `const origin = req.headers.get("origin")`; preflight from an unlisted origin → `403` with no `Access-Control-Allow-Origin`; every response uses `corsHeaders(origin)`. Tests added to `handler.test.ts`: allowed origin is echoed with `Vary: Origin`; unlisted origin gets no ACAO and preflight 403; `ALLOWED_ORIGINS="https://a.example, https://b.example"` parses both. Hosted value is set by a human: `npx supabase secrets set ALLOWED_ORIGINS=https://<app-origin>` from a real terminal (house rule 8) — document in `docs/backend/inviting.md`, with the note that the staging app origin does not exist until Cloudflare Pages (#109).
- [ ] Verify: local `deno test` green; CI on the PR shows the new **Secret scan** job green; `Edge Function checks` green with the new config path.
- [ ] Commit `security: secret scanning, shared Deno config, CORS allow-list (#378)`; PR base `ci/373-seed-check-script`, `Closes #378`.

---

## Verification (whole stack)

- Each PR: CI green on its own base; PR body `Closes #n`; stacked bodies name their base.
- After all six merge (bottom-up, deleting branches): fresh clone + `npm ci` (root and `app/`) → `git status --porcelain` empty; `npx supabase --version` = `2.117.0`; `git ls-files --eol | grep w/crlf` empty; `.github/` contains the four metadata files + two workflows; `gh run view --log` on the first `main` run shows `Contents: read`, the new `Secret scan` job, and the seed step as a one-liner; `bash scripts/check-seed-rerunnable.sh` passes locally against a fresh reset; `bash scripts/create-github-issues.sh` exits 1 with the banner; `deno test --config supabase/functions/deno.json` green.
- SDD ledger at `.superpowers/sdd/2026-09-10-repo-ci-hygiene/progress.md`; workspace deleted after the final review.

## Human actions after merge (Alex)

1. Merge bottom-up per the protocol above; delete each branch on merge. Also delete the leftovers `feat/361-strict-and-deny-warnings` and `feat/360-cache-clear-on-signout` (contents already on `main` via #393).
2. Repo settings → Branches → protect `main`: require the three CI checks named in `docs/team/team-plan.md`, one approving review. (Optional: Environments → `staging` → required reviewers.)
3. When a hosted app origin exists: `npx supabase secrets set ALLOWED_ORIGINS=…` from a real terminal, per `docs/backend/inviting.md`.
4. First Dependabot PRs appear within a week (AC of #358).

## Risks and rulings

- **Renormalize is a no-op** (index already LF). Ruling: keep the step for the AC's sake, deliver the working-tree fix recipe in CLAUDE.md, and rely on `.editorconfig` going forward. Cost if wrong: none.
- **AGENTS.md pointer inside #356.** No issue owns the stale fork (consistency audit A1); a root artefact belongs to the root-hygiene issue. Cost if wrong: one extra file in a PR.
- **gitleaks on history** may flag the well-known local Supabase JWTs. Allow-list by path, never by disabling rules. A genuine secret stops the task and is reported — no history rewrite.
- **Deno config move** may break `functions deploy` if the CLI does not fall back to `supabase/functions/deno.json`; mitigated by the `functions serve` check and the `import_map` fallback in `config.toml`.
- **CORS tightening** is the one user-visible behavior change: the BC panel's invite call from an origin not in `ALLOWED_ORIGINS` fails. Local default `http://localhost:5173` matches Vite; hosted needs the secret (listed above).
- **Concurrency cancel** applies to PR branches only (`main` queues) — matches the issue text.
- **Concurrent edits to `ci.yml`:** #365 (unassigned, next batch) changes the `db lint` line; #375 adds jobs. Both come after this stack; the stack merges first.

## Deferred (next batches, in priority order)

- **#375** root format/lint entry point (blocked by #356) — deliberately *not* in this stack: Prettier over ~30 markdown files collides with #374's docs truth pass and with teammates' open docs edits; do it together with #374.
- **Stack B — backend conventions:** #366 `docs/backend/conventions.md` → #365 `db lint --schema public,private` + `conventions.test.sql` (note: exclude trigger-returning functions from the anon-execute check — `sync_task_ledger`/`sync_assignee_ledger` still carry the PUBLIC default; allow-list views `profiles_contact`, `member_points`); standalone #371 (drop `role_capabilities`, edit `rls_deny_by_default`/`rls_teams_reference`), #215 (`Educațional`).
- **Stack C — Tracker schema:** #368 `private.set_updated_at()` + `created_at` on `events`/`project_members` → #313 `campaigns` (use `dept_id`, not `department_id`, to match every other table; fixture row in `rls_deny_by_default`) → #284 origin XOR (`num_nonnulls(dept_id, team_id, project_id) = 1`; seed `t-app` rows become team-origin; 10 test fixtures insert tasks with no origin) → #286 `mode text check ('direct','public')`, `status='open'` → `public` → #314 `campaign_id` + origin-consistency trigger → #320 `private.notify` / `private.task_managers` (true code dependency on #284's `project_id` — add #284 to #320's `## Blocked by`). Standalone #311 (BC/Moderator override in `private.require_active_project_lead`).
- **Stack D — notifications RLS:** #65 (self read + column-grant `update (read)`), #66 (push_tokens self policies; its AG-views half is #47/#48 — issue body needs a trim).
- **Stack E — Calendar schema:** #369 (`project_id`, `min_level in (0,3,4,5,6)`, `cancelled_at`/`cancel_reason`, 5-branch scope check) → #372 (`event_read` = `auth_is_member() and auth_level() >= min_level`; drop `for_recruits`/`team_admits_recruits`; seed + fingerprint). Unblocks dobrerares' #370.

---

<details>
<summary>Superseded plan on this file (executed 2026-09-10): Task Tracker realignment — docs amendment + issue graph</summary>

Outcome: docs PR #309 (+ #355) merged; new issues #310–#354 created; 44 existing issues edited; #106 closed as superseded. The follow-up implementation batch (#363, #310, #279, #361, #360, #326) shipped as PRs #380, #387, #388, #389, #393. Full record: `docs/superpowers/plans/2026-09-10-alex-assigned-issues.md` and the GitHub issue graph.
</details>
