---
name: add-ai-provider
description: Add a new AI/LLM provider to the backend so the manual agents (Fisher/Tournament/Scenario/Red-Flag) can run against it. Use when the user asks to "add a provider", "wire up <vendor>'s API", "support <model vendor / OpenAI-compatible endpoint>", or to add a new chat/completions backend. There are already five to clone: OpenAI, Anthropic, Gemini, Ollama, Claude Code.
---

# Add an AI provider

Providers live in `backend/app/providers/ai/`. A provider is a **generic LLM client
with zero domain knowledge**: it takes a system + user prompt (and an optional JSON
schema) and returns parsed text/JSON plus token & cost metadata. All stock-specific
prompting stays in `app.agents.*` — never put prompt logic in a provider.

**Clone the closest existing provider** rather than starting blank:

- `openai_provider.py` — OpenAI-style Chat Completions / any OpenAI-compatible REST API
- `anthropic_provider.py` — Anthropic Messages API (different auth + JSON handling)
- `gemini_provider.py` — Google Gemini
- `ollama_provider.py` — local Ollama (no API key)
- `claudecode_provider.py` — Claude Code

## The contract (`backend/app/providers/ai/base.py`)

Subclass `AIProvider`, set `name`, and implement `ping` + `complete`:

- `name: str` — stable provider id (also the key used by pricing and the factory)
- `__init__(self, endpoint, model, api_key=None)` — the factory passes these in
- `async ping() -> None` — make a **minimal real** network call and **raise** on any
  failure (missing key, HTTP error, timeout). The settings "test connection" endpoint
  relies on the raised exception to show a meaningful message — never swallow it.
- `async complete(system_prompt, user_prompt, json_schema=None, temperature=0.2) -> CompletionResult`
  — when `json_schema` is given, request JSON and return the parsed object in
  `CompletionResult.parsed`; without a schema, fall back to `parsed = {"text": raw_text}`
  so callers always get a dict.

`CompletionResult` fields: `parsed`, `raw_text`, `input_tokens`, `output_tokens`,
`estimated_cost`.

## Error handling — non-negotiable

CLAUDE.md: provider calls must tolerate a missing key **and** network errors and must
never hard-crash a refresh. The house convention (see the existing providers):

- Missing API key → `raise ValueError("Kein API-Key hinterlegt")` (German message).
- Let HTTP/timeout/parse failures **propagate** — the agent's `execute_run` catches
  them and records a `status="error"` AIRun. Do **not** add try/except in the provider
  except to convert an unparseable body into a clear `ValueError`
  (`"Provider lieferte kein valides JSON: ..."`).
- Reuse `post_with_retry` from `app.providers.ai._retry` for the HTTP POST (transient
  retry/backoff) instead of calling `client.post` directly.

## Steps

1. **Create `backend/app/providers/ai/<name>_provider.py`** from the template below
   (or by cloning the closest provider). Set `name`, the auth header, the request
   body shape, and the response parsing for your vendor.
2. **JSON mode is vendor-specific** — match the closest example:
   - OpenAI: `body["response_format"] = {"type": "json_object"}`, then `json.loads`.
   - Anthropic: no JSON mode — prefill the assistant turn with `"{"` and re-prepend it
     before `json.loads` (see `anthropic_provider.py`); auth is `x-api-key` +
     `anthropic-version`, `system` is top-level, `max_tokens` is required.
3. **Wire it into the factory** — `backend/app/services/provider_factory.py` →
   `build_ai_provider(row)` is an explicit `if provider_name == "...":` chain on
   `row.ai_provider`. Import your class and add a branch that returns it, defaulting
   the endpoint when `row.ai_endpoint` is empty:
   ```python
   if provider_name == "vendor":
       endpoint = row.ai_endpoint or "https://api.vendor.com/v1/chat"
       return VendorProvider(endpoint=endpoint, model=row.ai_model, api_key=api_key)
   ```
   (`api_key` is already decrypted above; the trailing `return` is the OpenAI default.)
4. **Add pricing** in `backend/app/providers/ai/pricing.py`: add a `_VENDOR_PRICES`
   dict (model id or family-prefix → `(input_per_1k, output_per_1k)` USD) **and** a
   branch for your provider in `estimate_cost`'s table selection. Prefix matching means
   `claude-opus-4` covers `claude-opus-4-8`, so key by family. If you skip this, an
   unknown provider falls through to `0.0` (the self-hosted/Ollama path) — costs show
   as zero rather than the real figure instead of erroring.
5. **Test** — add cases to `backend/tests/test_providers.py` following the existing
   ones: build a stubbed response with the `_mock_async_client(payload)` helper and
   `patch("app.providers.ai.<name>_provider.httpx.AsyncClient", return_value=cm)`.
   Cover the four canonical shapes: `complete(..., json_schema=...)` → parsed JSON +
   token metadata + non-zero `estimated_cost`; `complete(...)` without a schema →
   `{"text": ...}`; `ping()` with no key → `pytest.raises(ValueError, match="API-Key")`;
   `ping()` against `http://127.0.0.1:1/...` → raises. CI is offline — never hit a live
   endpoint. (`ping()` is also exercised end-to-end by `test_ai_test_endpoint.py`.)
6. **Add the provider to the frontend** — the settings UI enumerates providers
   client-side: the provider id/label list lives in `frontend/src/types.ts`, rendered
   by `components/settings/AiProviderCard.tsx` via `SettingsPage.tsx`. Add your
   provider's id + label (and any default model/endpoint hint) there so it appears in
   the dropdown. `ai_provider` is stored as a free string, so the backend accepts it
   the moment the factory branch (step 3) exists.
7. **Gate** from the repo root: `cd backend && pytest -k provider` then the full
   `pytest`; if you touched the frontend, `npm run typecheck && npm test`.

## Template (OpenAI-compatible REST)

```python
"""<Vendor> provider.

Generic LLM client — the agent layer owns the prompts. Failures propagate so the
calling agent can persist a `status="error"` AIRun row.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.providers.ai._retry import post_with_retry
from app.providers.ai.base import AIProvider, CompletionResult
from app.providers.ai.pricing import estimate_cost


class VendorProvider(AIProvider):
    name = "vendor"

    def __init__(self, endpoint: str, model: str, api_key: str | None = None) -> None:
        self.endpoint = endpoint
        self.model = model
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise ValueError("Kein API-Key hinterlegt")
        return {"Authorization": f"Bearer {self.api_key}"}

    async def ping(self) -> None:
        body = {
            "model": self.model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}],
        }
        async with httpx.AsyncClient(timeout=15) as client:
            await post_with_retry(client, self.endpoint, headers=self._headers(), json=body)

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        json_schema: dict[str, Any] | None = None,
        temperature: float = 0.2,
    ) -> CompletionResult:
        body: dict[str, Any] = {
            "model": self.model,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if json_schema is not None:
            body["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=120) as client:
            response = await post_with_retry(
                client, self.endpoint, headers=self._headers(), json=body
            )
            data = response.json()

        raw_text = data["choices"][0]["message"]["content"]
        usage = data.get("usage") or {}
        input_tokens = usage.get("prompt_tokens")
        output_tokens = usage.get("completion_tokens")

        if json_schema is not None:
            try:
                parsed = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Provider lieferte kein valides JSON: {exc}") from exc
        else:
            parsed = {"text": raw_text}

        return CompletionResult(
            parsed=parsed,
            raw_text=raw_text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=estimate_cost(self.name, self.model, input_tokens, output_tokens),
        )
```

## Notes

- The stored API key is Fernet-encrypted via `ENCRYPTION_KEY` — never log it.
- One provider is active at a time; the factory builds the configured one per run with
  a fresh value, so providers must be cheap to construct and hold no global state.
- Don't reach into agents or the DB from a provider — keep it a pure prompt-in /
  result-out client.
