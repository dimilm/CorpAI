---
name: add-ai-agent
description: Add a new manual AI agent to the backend (the Fisher / Tournament / Scenario / Red-Flag family). Use when the user asks to "add an agent", "create a new AI analysis/checklist", "add a <name> agent", or to introduce a new structured LLM analysis that runs per-stock and is logged as an AIRun.
---

# Add an AI agent

Agents live in `backend/app/agents/<id>/` and are provider-agnostic: each one builds
a JSON input payload from the DB, renders a **static** prompt, calls the configured
provider through the generic `complete()` API, validates the result against a Pydantic
schema, and persists an `AIRun` row. The provider/model is chosen elsewhere — the
agent never picks one.

**Read `backend/app/agents/fisher/` first** — it is the simplest complete example and
the canonical thing to clone. `tournament/` shows the advanced case (it overrides
`execute_run` for nested bracket calls).

## Files to create — `backend/app/agents/<id>/`

| File | Purpose |
|------|---------|
| `__init__.py` | empty (matches the existing agents) |
| `schema.py` | the Pydantic `output_schema` — the structured result contract |
| `prompt.md` | the **static** system prompt (persona + task). Read-only at runtime |
| `agent.py` | the `BaseAgent` subclass |

## The contract (`backend/app/agents/base.py`)

Subclass `BaseAgent` and set the `ClassVar`s, then implement `build_input`:

- `id: str` — stable identifier, also the agent dir name and API id
- `name: str` / `description: str` — shown in the UI (**German**, matching the house style)
- `prompt_path = Path(__file__).with_name("prompt.md")`
- `output_schema = <YourResult>` (your Pydantic model from `schema.py`)
- `build_input(self, db, stock, **kwargs) -> dict[str, Any]` — return the
  JSON-serialisable payload fed to the model. For most agents this is just
  `return build_stock_context(db, stock)` (from `app.agents.context`).

You normally do **not** override `render_prompt` / `execute_run` / `run`. The base
treats `prompt.md` as the system prompt and the JSON payload as the user turn, sends
`output_schema.model_json_schema()` to the provider, validates the reply, and writes
the `AIRun` row (status `running → done|error`, with cost + duration). Override
`execute_run` only for multi-call flows — see `tournament/agent.py`.

## Steps

1. **Scaffold the dir** from the table above; copy `fisher/` and rename.
2. **`schema.py`** — define the Pydantic result model (per-item scores, a total,
   a verdict, etc.). This shape becomes the JSON the LLM is required to return, so
   keep field names/descriptions tight; mirror `fisher/schema.py`.
3. **`prompt.md`** — write the persona + task. It is rendered as the system prompt
   and is **static / read-only at runtime** (served verbatim for the "Prompt
   anzeigen" modal, never editable via UI or API — a do-not-touch rule in CLAUDE.md).
   Do not interpolate the payload here; the base appends it as the user turn.
4. **`agent.py`** — subclass `BaseAgent` as below.
5. **Register it** in two files (copy an existing agent's lines):
   - `agents/registry.py`: add `from app.agents.<id>.agent import <Name>Agent` and
     append `<Name>Agent()` to the `instances` list in `_build_registry()`.
   - `agents/__init__.py`: add the same import and add `<Name>Agent` to `__all__`.
   The API and UI read `AGENTS` from the registry, so that's all the wiring needed.
6. **Test** — add `backend/tests/test_agents_<id>.py` mirroring
   `tests/test_agents_fisher.py`: define a `_StubProvider(AIProvider)` whose
   `complete()` returns a `CompletionResult` with a schema-valid `parsed` dict, then
   assert `agent.run(db, provider, stock)` persists a `done` `AIRun` with the parsed
   result, and that an invalid payload yields `status="error"`. The endpoint tests in
   that file also show the login + CSRF header and the 202 (queued) / 409
   (already-running) flow.
7. **Gate** from `backend/`: `pytest -k agents` then the full `pytest`. No frontend
   change is needed for a standard agent — the agent list is served from the registry.

## Template — `agent.py`

```python
"""<One-line German description of what the agent evaluates>."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.agents.base import BaseAgent
from app.agents.context import build_stock_context
from app.agents.<id>.schema import <YourResult>
from app.models.stock import Stock


class <Name>Agent(BaseAgent):
    id = "<id>"
    name = "<Anzeigename>"
    description = (
        "<Deutsche Beschreibung dessen, was der Agent bewertet und zurückgibt.>"
    )
    prompt_path = Path(__file__).with_name("prompt.md")
    output_schema = <YourResult>

    def build_input(self, db: Session, stock: Stock, **_: Any) -> dict[str, Any]:
        return build_stock_context(db, stock)
```

## Notes

- Provider failures (missing key, HTTP, timeout, invalid JSON) are caught by
  `execute_run` and stored as `status="error"` on the `AIRun` — do not add your own
  try/except in `build_input`.
- The same agent runs single-stock and in batch; batch progress reuses the shared
  `RunLog`/polling machinery — you get that for free, don't add a parallel path.
- Keep prompts in `prompt.md`, not in Python. No secrets in the prompt.
