# CLAUDE.md

Guidance for Claude Code when working in this repository.

> This is the single source of truth for working in this repo. Setup details and
> rationale live in [`README.md`](README.md) and the ADRs under [`docs/adr/`](docs/adr/).

## Project

**CompanyTracker** — a single-process FastAPI + React app that tracks a watchlist of
stocks, refreshes market data via `yfinance`, scrapes career-portal "open positions"
(Jobs pipeline), and runs manual AI agents (Fisher, Tournament, Scenario, Red-Flag)
against OpenAI / Gemini / Ollama. Storage is SQLite.

- **Backend** (`backend/`): FastAPI + SQLAlchemy 2 + Alembic, Python 3.12, entrypoint `app.main:app`
- **Frontend** (`frontend/`): React 18 + Vite + TanStack Query + React Router (Node 20+)
- **Docker** (`docker/`): compose stack, per-service Dockerfiles, nginx, backup helpers

## Commands

Run backend commands from `backend/`, frontend commands from `frontend/`.

```bash
# Backend (activate env first: conda activate companytracker, or the venv)
uvicorn app.main:app --reload --port 8001   # first start creates backend/data/sqlite.db,
                                             # runs migrations, seeds admin/changeme + stocks.seed.json
pytest                                       # full suite (run from backend/ so conftest picks up)
pytest tests/test_<name>.py -x               # focused, stop on first failure
pytest -k <substring>                        # filter by name
alembic revision --autogenerate -m "<msg>"   # new migration after a model change

# Frontend
npm run dev          # Vite on http://localhost:5173, proxies /api/* -> :8001 (override VITE_BACKEND_URL)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src --max-warnings=0
npm run build        # tsc --noEmit && vite build
npm test             # vitest run (one-shot)
npm run test:watch   # vitest watcher (inner loop)
npx vitest run src/<path>/<file>.test.tsx    # single test file
```

### Pre-commit gate (run from repo root; all three must be green)

```bash
(cd backend  && pytest)            && \
(cd frontend && npm run typecheck) && \
(cd frontend && npm test)
```

### Reset local DB

```powershell
Remove-Item backend\data\sqlite.db    # Windows / PowerShell
```

## Setup essentials

- **Env required to start the backend:** `JWT_SECRET` (signs auth tokens) and
  `ENCRYPTION_KEY` (Fernet, encrypts the stored AI API key). Local: `backend/.env`.
  Docker: `docker/.env`. Both gitignored. Generation one-liners are in `README.md`.
- **Backend install:** `pip install -e ".[dev]"`. The `playwright` extra
  (`pip install -e ".[playwright]" && python -m playwright install chromium`) is only
  needed for the three `playwright_*` job adapters; default install stays slim.
- **Docker quick start:** `cd docker && cp .env.example .env`, fill secrets,
  `docker compose up --build`. App at `http://localhost:8080`, API docs at
  `/api/v1/docs`, default login `admin / changeme`.
- Restart uvicorn manually (not just `--reload`) after changes to `app/main.py`
  startup/`lifespan` or after new Alembic revisions.

## Architecture

- **Backend layering:** keep route handlers thin — push logic into `app/services/`
  and `app/providers/`. Models in `app/models/`, Pydantic schemas in `app/schemas/`,
  routes in `app/api/v1/`. Provider integrations live in `app/providers/{ai,jobs,market}/`.
- **Refresh pipeline (per stock):** `resolve_symbol → fetch_quote → fetch_metrics`,
  tracked in `run_logs` + `run_stock_status`, guarded by the SQLite `JobLock` table
  against double-starts. Runs on the in-process `RefreshWorker` thread (manual trigger
  or cron). See ADR 0001.
- **Jobs pipeline:** a second `RunLog.run_type='jobs'` with its own lock domain
  (`daily_jobs_refresh`) so it runs alongside market refresh. Five HTTP adapters ship
  by default; three Playwright adapters need the optional extra. Note: for jobs runs the
  `RunLog.stocks_*` counters represent *job sources*, not stocks. See ADR 0002.
- **AI agents:** manual-only, one provider active at a time, each run logged in `ai_runs`.
  Provider calls (OpenAI/Gemini/Ollama/yfinance) must tolerate a missing API key **and**
  network errors — never assume a key is present and never hard-crash a refresh.
- **Single-process by design.** Cancel registry, rate limiter, and cron all live in the
  FastAPI process; this breaks under horizontal scaling. See
  [`docs/adr/0001-single-process-backend.md`](docs/adr/0001-single-process-backend.md).

## Conventions

- **Backend:** SQLAlchemy 2.x style (`db.execute(select(...))`, typed `Mapped[...]`).
- **Frontend:** functional components only; colocate hooks in `src/hooks/`, helpers in
  `src/lib/`. Server state goes through TanStack Query (queryKeys per resource; don't roll
  your own caching or use ad-hoc fetch in components). All HTTP goes through the typed
  client in `src/lib/` / `src/api/client.ts` — UI components must **not** call axios
  directly, and the shared client owns the CSRF header on mutating requests. Keep shared
  types in `src/types/`, matching backend schema (DTO) shapes.
- **Comments:** don't narrate (`# import foo`); only comment non-obvious intent or trade-offs.
- **Tests:** colocate frontend tests as `*.test.ts(x)`; backend tests under `tests/test_*.py`
  must never hit `backend/data/sqlite.db` (conftest provisions an isolated temp DB).

## Do-not-touch

- Never commit `backend/.env`, `docker/.env`, `backend/data/sqlite.db`, or `data/backups/`.
- Never edit a shipped Alembic revision under `backend/migrations/versions/` — add a
  follow-up revision instead. Commit the migration **and** model together.
- Don't bypass the shared frontend API client — it owns CSRF on mutating requests.
- AI prompts at `backend/app/agents/<id>/prompt.md` are static / read-only at runtime
  (not editable via UI or API).
- Rotating `ENCRYPTION_KEY` invalidates the stored AI API key — back it up first.

## Gotchas

- **Plain HTTP (no TLS) in Docker:** set `COOKIE_SECURE=false` in `docker/.env`, or auth
  cookies are silently dropped and every request fails with `{"detail":"Missing auth cookie"}`.
- Auth is **JWT cookie + CSRF** — keep that in mind when adding/testing endpoints.
- In Docker the SQLite DB and backups live in the `app_data` named volume, **not** the host
  `data/` dir; use `docker/restore-backups.{ps1,sh}` to copy them out.

## Further reading

- [`README.md`](README.md) — full setup, Docker, backup/restore, scaling notes
- [`docs/adr/0001-single-process-backend.md`](docs/adr/0001-single-process-backend.md)
- [`docs/adr/0002-jobs-pipeline-integration.md`](docs/adr/0002-jobs-pipeline-integration.md)
