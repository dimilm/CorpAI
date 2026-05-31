---
name: ship-check
description: Run the project's pre-commit gate — backend pytest + frontend typecheck + frontend vitest — and fix failures until all three are green. Use before committing or pushing, or when asked to "run the gate", "make it green", "run all the checks/tests", "is this ready to commit", or to verify the working tree passes the CI-equivalent checks.
---

# ship-check — the pre-commit gate

CLAUDE.md defines a three-part gate; **all three must be green** before a commit:

1. **Backend tests** — `pytest`, from `backend/`
2. **Frontend types** — `npm run typecheck` (`tsc --noEmit`), from `frontend/`
3. **Frontend tests** — `npm test` (`vitest run`), from `frontend/`

## Running it on this machine (Windows + conda)

Python is **not on PATH** here — use the `companytracker` Anaconda interpreter
explicitly (the exact form allow-listed in `.claude/settings.json`, so it runs without
a permission prompt). Run each check as its own command; do **not** rely on bash
`&&` / subshell chaining — the default shell is PowerShell, where that is a parse error.

- **Backend** (cwd `backend/`): `C:/Users/dimi_/anaconda3/envs/companytracker/python.exe -m pytest -q`
- **Typecheck** (cwd `frontend/`): `npm run typecheck`
- **Frontend tests** (cwd `frontend/`): `npm test`

Portable fallback if that interpreter path is gone: `conda activate companytracker`
then `pytest`. The canonical bash form (from the repo root, e.g. in CI / git-bash) is:

```bash
(cd backend && pytest) && (cd frontend && npm run typecheck) && (cd frontend && npm test)
```

## Workflow

1. Run all three (backend first — it's the slowest and catches the most real bugs).
2. **If any fails:** read the output, fix the *root cause* — not the test, unless the
   test is genuinely wrong. Re-run that one check; don't move on while it's red. For
   triage use a focused run (`... -m pytest tests/test_x.py -x` or `-k <name>`, or
   `npx vitest run src/<file>.test.tsx`); note these may prompt for permission since
   only the bare `-q` pytest form is allow-listed.
3. Once each is individually green, **re-run all three together once more** so a fix in
   one area didn't break another.
4. Report the final status plainly — what passed, and paste the failing output if you
   could not reach green. Never claim green unless you actually saw all three pass.
5. **Do not commit or push** unless explicitly asked — this skill only verifies.

## Repo-specific notes

- Backend tests must run from `backend/` so `conftest.py` provisions the isolated temp
  DB; they must never touch `backend/data/sqlite.db`. A test that needs the real DB is
  a bug in the test, not a reason to point the gate at it.
- `npm test` is one-shot (`vitest run`). Use `npm run test:watch` only for the inner
  loop — never as the gate.
- Lint and build are **not** part of the three-part gate but are cheap insurance and
  catch things `typecheck` won't: `npm run lint` (`eslint --max-warnings=0`) and
  `npm run build`. Run them when the change is non-trivial.
- Keep files LF (`.gitattributes` pins `eol=lf`); a "fix" that re-encodes to CRLF
  shows up as a whole-file diff — don't introduce one.
- A green test run does **not** verify runtime startup. If you changed
  `app/main.py` startup/`lifespan` or added an Alembic revision, a manual `uvicorn`
  restart is still needed to confirm the app boots — flag that, but it's outside this
  gate (use the `verify` / `run` skills for live checks).
