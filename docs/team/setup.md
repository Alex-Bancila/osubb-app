# Setting up your laptop, from zero

For a new teammate on their first day. It assumes nothing — not that you've used a terminal, not that you know what Docker is. Follow it top to bottom.

Budget **60–90 minutes**, most of it waiting for downloads. The Supabase images alone are several GB, so do this on decent wifi and make sure you have **~10 GB free**.

Every step ends with a **checkpoint** — one thing that proves it worked. If a checkpoint doesn't match, stop there and fix it before continuing; every later step depends on the earlier ones.

---

## Step 0 — Accept the two invitations

Two emails are waiting for you. They do different things:

| Invitation | What it gives you | Needed for local work? |
|---|---|---|
| **GitHub** — `Alex-Bancila/osubb-app` | the code, the issue list, the ability to open pull requests | **yes, essential** |
| **Supabase** — the OSUBB project | a look at the *staging* server's database | no |

That second one surprises people, so to be explicit: **you do not need Supabase access to develop.** Everything you build runs against a complete copy of the backend on your own machine. The dashboard invite is so you can look at staging when we deploy — reading, mostly, not working.

Accept both anyway.

**Checkpoint:** you can open <https://github.com/Alex-Bancila/osubb-app> and see the code rather than a 404.

---

## Step 1 — Install five tools

All free. On Windows, take the default options in every installer.

| Tool | Where | What it's for |
|---|---|---|
| **Git** | [git-scm.com](https://git-scm.com) | tracks every change to the code |
| **Node.js** (LTS) | [nodejs.org](https://nodejs.org) | runs the frontend and our command-line tools |
| **Docker Desktop** | [docker.com](https://www.docker.com/products/docker-desktop/) | runs the whole backend on your machine |
| **GitHub CLI** | [cli.github.com](https://cli.github.com) | `gh` — sign in, open pull requests from the terminal |
| **VS Code** | [code.visualstudio.com](https://code.visualstudio.com) | the editor |

### About Docker, because it's the one that gives trouble

A **container** is a small, disposable, self-contained copy of a machine with one piece of software already installed and configured in it. Docker is the program that downloads and runs containers.

This matters to us because our backend isn't one program — it's PostgreSQL, an authentication server, an API layer, a database browser, a fake email inbox and a few more, all wired together. Installing that by hand would be an afternoon per laptop and a different afternoon on every operating system. Instead, one command starts about nine containers that already are that stack, identically for everyone on the team.

It also means **you cannot break anything permanently**. Containers are throwaway. Delete them, start again, you're back to a clean backend in under a minute, and nothing on your actual machine was ever touched.

**On Windows** the installer needs WSL 2 (a small Linux layer Windows provides). The installer usually sets it up for you. If it complains:

1. Open PowerShell **as Administrator** and run `wsl --install`, then restart.
2. If it still complains about virtualization, it's off in your BIOS — search "enable virtualization" plus your laptop model. It's a one-time setting.

After installing, **start Docker Desktop and leave it running.** There's a whale icon in the system tray (Windows) or the menu bar (Mac). If the whale isn't there, nothing in Step 5 will work.

**Checkpoint:** close every terminal, open a fresh one, and run these four. Each should print a version number:

```bash
git --version
node --version
docker --version
gh --version
```

A "command not found" almost always means the terminal was open before you installed — close it and open a new one.

---

## Step 2 — Tell Git who you are

Your name goes on every commit you make. Use your real name and the email on your GitHub account.

```bash
git config --global user.name "Prenume Nume"
git config --global user.email "adresa@de-pe-github.com"
```

**Checkpoint:** `git config --global user.name` prints your name back.

---

## Step 3 — Sign in to GitHub from the terminal

```bash
gh auth login
```

Answer: **GitHub.com** → **HTTPS** → **yes**, authenticate Git with your GitHub credentials → **Login with a web browser**. Copy the code it shows, paste it in the browser page that opens.

**Checkpoint:** `gh auth status` says you're logged in as you.

---

## Step 4 — Get the code

Pick a folder you'll remember — `C:\Users\<you>\dev` on Windows, `~/dev` on Mac.

```bash
cd ~/dev
git clone https://github.com/Alex-Bancila/osubb-app.git
cd osubb-app
```

Every command from here on runs **inside `osubb-app`** unless it says otherwise.

**Checkpoint:** `ls` shows `CLAUDE.md`, `supabase`, `app`, `docs`.

---

## Step 5 — Start the backend

Docker Desktop must be running. Then:

```bash
npx supabase start
```

**The first run downloads several GB** and can take 10–20 minutes. It looks frozen at times; it isn't. Later runs take about 30 seconds.

`npx` means "fetch this tool and run it" — we don't install the Supabase CLI globally, so everyone always uses the same version.

When it finishes it prints a block of URLs and keys. The ones you'll use:

| | |
|---|---|
| API | `http://127.0.0.1:54321` |
| **Studio** — browse the database | `http://127.0.0.1:54323` |
| **Mailpit** — catches every email the app sends locally | `http://127.0.0.1:54324` |

**Checkpoint:** `npx supabase status` prints those URLs instead of an error.

---

## Step 6 — Build the database and prove it works

```bash
npx supabase db reset
npx supabase test db
```

The first rebuilds the database from scratch: it applies all 18 migrations in order and then loads the demo data. The second runs the whole test suite.

`db reset` is your undo button for the rest of your life on this project. Broke something? Confused about the state of your data? Run it. Half a minute later you have a pristine database with the demo data back. This is why experimenting locally is safe.

**Checkpoint:** the tests end with

```
All tests successful.
Files=16, Tests=292
Result: PASS
```

If you get 292 passing tests, your backend is correct and complete. You just built it from source.

---

## Step 7 — Start the app

The frontend lives in `app/` and has its own dependencies.

```bash
cd app
npm install
cp .env.example .env.local     # Windows PowerShell: copy .env.example .env.local
npm run dev
```

`.env.local` tells the app where the backend is. It's git-ignored on purpose — everyone has their own, and real keys must never land in the repository. (If `app/.env.example` isn't there yet, skip that line — the app still starts, it just can't reach the backend until the connection code lands.)

Open <http://localhost:5173>. Leave this terminal running; it rebuilds as you edit. Open a **second terminal** for everything else.

**Checkpoint:** the browser shows an OSUBB page rather than an error.

---

## Step 8 — Look around

Three things worth five minutes each.

**Studio** (`127.0.0.1:54323`) — the database in a browser. Table Editor → `profiles`, `tasks`, `points_ledger`. This is real data you can query. **Look, don't edit:** changes clicked in here vanish at your next `db reset`, because the only durable way to change the database is a migration file.

**Mailpit** (`127.0.0.1:54324`) — a fake inbox that catches every email the app sends locally. Empty now. When you test an invitation, the magic link lands here instead of a real address.

**The demo accounts.** The seed creates eight, one per role, all with the password `parola123`:

| Email | Role | What they show |
|---|---|---|
| `recrut@demo.osubb` | Recrut | the smallest view: 4 events, 6 tasks |
| `voluntar@demo.osubb` | Voluntar | a normal member with points and a team |
| `activ@demo.osubb` | Membru Activ | a sanction on the ledger |
| `vot@demo.osubb` | Drept de Vot | top of the leaderboard |
| `responsabil@demo.osubb` | Responsabil | task management, two departments |
| `bce@demo.osubb` | BCE | the volunteers directory |
| `bc@demo.osubb` | BC | everything: 7 events, 16 tasks |
| `moderator@demo.osubb` | Moderator | the moderation view |

Signing in as two of them and seeing different data — with no conditional code anywhere — is the clearest demonstration of how this app works. The database decides what you can see.

---

## Step 9 — Your first change

The loop, every time, forever:

```bash
git checkout main && git pull          # start from the latest code
git checkout -b feat/scurta-descriere  # your own branch — never work on main

# ... make your change ...

npx supabase db reset && npx supabase test db   # both green (backend work)
cd app && npm run typecheck && npm run lint && npm run build   # (frontend work)

git add -A
git commit -m "feat: ce ai făcut"
git push -u origin feat/scurta-descriere
gh pr create --title "Titlu" --body "Closes #<numărul issue-ului>"
```

Then the robot tests your pull request, someone reviews it, and it gets merged. Pick work from `gh issue list --label max-1h --state open` — every issue has a goal, the reasoning, the steps and its acceptance criteria written out.

Read [`docs/agents/onboarding.md`](../agents/onboarding.md) before your first real issue. It's the tour of the codebase and the list of traps we've already fallen into.

---

## When something breaks

| What you see | What it means |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop isn't running. Start it, wait for the whale, retry. |
| `port is not available` / `access permissions` **(Windows)** | Windows grabbed our ports after a reboot. Administrator PowerShell: `net stop winnat` then `net start winnat`, retry. |
| `wsl` errors while installing Docker | Administrator PowerShell: `wsl --install`, restart. If it mentions virtualization, enable it in the BIOS. |
| `npx: command not found` | Node isn't installed, or the terminal predates the install. Open a new terminal. |
| `supabase start` hangs for ages on the first run | Normal. It's downloading several GB. Leave it. |
| Tests fail on a fresh clone | Run `npx supabase db reset` first — the tests need the migrations applied. |
| Blank page, console says `Missing VITE_SUPABASE_URL` | You skipped the `.env.local` copy in Step 7. Copy it and restart `npm run dev`. |
| App says *"Contul tău nu este activ"* | You signed in with an account that has no profile. Use one of the demo addresses. |
| Everything worked yesterday, nothing starts today | Docker restarted or updated. `npx supabase stop` then `npx supabase start`. |
| Anything else | Screenshot it in the group chat with what you were doing. Setup problems are normal and are never "your fault". |

---

## The daily rhythm

```bash
npx supabase start     # morning, once — needs Docker Desktop running
npx supabase stop      # evening, frees the memory
```

Your database survives a `stop`. `db reset` is what wipes and rebuilds it.

Rule of thumb: **before you push, run the same checks CI will run.** For backend work that's `db reset` + `test db`; for frontend work it's `typecheck`, `lint` and `build` inside `app/`. Green locally means green in CI, and a green CI means your work can be merged.
