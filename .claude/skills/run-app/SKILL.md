---
name: run-app
description: Start, stop, or restart the CompanyTracker app locally — FastAPI backend (uvicorn :8001) + React/Vite frontend (:5173) — and smoke-test that both came up. Use when asked to "start the app", "run the app", "launch it", "boot the backend/frontend", "starte die app", as well as "stop the app", "stoppe die app", "kill the backend/frontend", "restart it", or "free port 8001/5173". For verifying a specific change works, the `verify` / `run` skills wrap this.
---

# run-app — bring up CompanyTracker locally

Two long-running processes, started independently (single-process backend by design,
see ADR 0001). Run each in the **background** — they don't exit.

- **Backend** — FastAPI, `uvicorn app.main:app` on **:8001**, cwd `backend/`
- **Frontend** — Vite dev server on **:5173**, cwd `frontend/`, proxies `/api/*` → :8001

## Preflight (cheap, do it first)

The backend needs `backend/.env` with `JWT_SECRET` + `ENCRYPTION_KEY`, the conda env,
and the frontend needs `node_modules`. Reading `.env` is **deny-listed** for security,
so check *existence* only — never cat it:

```powershell
[System.IO.File]::Exists('C:\20_Dima\10_Workspace\Source\CorpAI\backend\.env')   # must be True
```

- `backend/.env` missing → stop and tell the user; secret generation one-liners are in
  `README.md`. Do not invent secrets.
- `frontend/node_modules` missing → `npm ci` from `frontend/` first.
- `backend/data/sqlite.db` missing is **fine** — first backend start creates it, runs
  migrations, and seeds `admin / changeme` + `stocks.seed.json`.

## Start it (Windows + conda — this machine)

Python is **not on PATH** here. Use the `companytracker` Anaconda interpreter by full
path (allow-listed in `.claude/settings.local.json`, so no permission prompt). The
default shell is PowerShell; `cd` into the service dir with `Set-Location`, and start
each command with `run_in_background: true`.

**Backend** (background):
```powershell
Set-Location backend; & "C:\Users\dimi_\anaconda3\envs\companytracker\python.exe" -m uvicorn app.main:app --port 8001
```

**Frontend** (background):
```powershell
Set-Location frontend; npm run dev
```

Start **without `--reload`**. The `--reload` watcher spawns a child worker via
`multiprocessing.spawn`; killing the parent can orphan it (it holds :8001 and the DB),
so a clean restart then fails on "port in use". Only add `--reload` when actively editing
backend code, and kill the whole process tree when done.

Portable fallback if the interpreter path is gone:
`conda activate companytracker` then `uvicorn app.main:app --port 8001` from `backend/`.

## Verify both came up (don't just trust the launch)

Backend startup runs Alembic migrations first — give it ~10s, then smoke-test. A **404
is still a live server**; only a connection error means it's down.

```powershell
Invoke-WebRequest http://localhost:8001/api/v1/health -UseBasicParsing   # 200 = backend up
Invoke-WebRequest http://localhost:5173/ -UseBasicParsing                # 200 = frontend up
```

Read the background task output files to confirm — backend should reach
`Application startup complete` / `Uvicorn running on ... :8001`; frontend prints
`VITE ready` + the Local URL.

## Report

Give the user the URLs and the login:

- **App (use this):** http://localhost:5173 — login `admin` / `changeme`
- **API docs (Swagger):** http://localhost:8001/docs  *(note: `/docs`, not `/api/v1/docs`)*
- **Health:** http://localhost:8001/api/v1/health

Both run as background processes for the session. Offer to stop them, restart with
`--reload`, or tail logs. Don't claim it's up unless you actually saw the 200s.

## Stop / cleanup

**Started in this session?** They're background tasks — just kill those tasks. No port
hunting needed. A **restart** is: stop both, then re-run the start steps above.

**Orphaned from a previous session** (the common case — an old `uvicorn --reload` worker
still holds :8001, so a fresh start fails with `[Errno 10048]`): find the listener by
port and kill the whole tree. `--reload` spawns a `multiprocessing.spawn` child that
survives killing the parent, so `/T` (kill children) matters.

```powershell
# Who is holding the ports?
Get-NetTCPConnection -LocalPort 8001,5173 -State Listen |
  Select-Object LocalPort, OwningProcess
# Kill each owning PID and its child processes
taskkill /PID <pid> /T /F
```

Verify it's free: re-run the `Get-NetTCPConnection` line — no rows means the port is
clear and a fresh start will bind. Only target :8001 / :5173 owners; don't blanket-kill
every `python.exe` / `node.exe` (you'll take out unrelated work, incl. other conda apps).

## Gotchas

- Ports already bound (`[Errno 10048]` / `EADDRINUSE`) → a previous instance (often an
  orphaned `--reload` worker) is still holding :8001 / :5173. Find and stop it before
  relaunching rather than picking a new port.
- This is the **local dev** path (Vite proxy). The Docker stack (`docker/`, app on :8080,
  plain-HTTP needs `COOKIE_SECURE=false`) is a separate runbook — not this skill.
- Don't touch `backend/data/sqlite.db` to "reset" unless asked; deleting it wipes local
  data (it re-seeds on next start).
