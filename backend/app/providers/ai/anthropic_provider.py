"""Anthropic Claude provider using the Messages REST API.

Generic LLM client – the agent layer owns the prompts. Differs from the
OpenAI shape in three ways the Messages API enforces: auth via the
``x-api-key`` header plus a pinned ``anthropic-version``, the system prompt
as a top-level field (not a ``role: system`` message), and a mandatory
``max_tokens``. Failures propagate so the calling agent can persist a
``status="error"`` AIRun row.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from app.providers.ai._retry import post_with_retry
from app.providers.ai.base import AIProvider, CompletionResult
from app.providers.ai.pricing import estimate_cost

_ANTHROPIC_VERSION = "2023-06-01"
# Messages requires an explicit cap; agent JSON payloads are small, but leave
# generous headroom so a verbose verdict is never truncated mid-object.
_MAX_TOKENS = 4096


class AnthropicProvider(AIProvider):
    name = "anthropic"

    def __init__(self, endpoint: str, model: str, api_key: str | None = None) -> None:
        self.endpoint = endpoint
        self.model = model
        self.api_key = api_key

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise ValueError("Kein API-Key hinterlegt")
        return {
            "x-api-key": self.api_key,
            "anthropic-version": _ANTHROPIC_VERSION,
            "content-type": "application/json",
        }

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
        messages: list[dict[str, Any]] = [{"role": "user", "content": user_prompt}]
        # Claude has no JSON response mode; prefilling the assistant turn with
        # an opening brace forces the reply to start as a JSON object and skips
        # any prose/markdown preamble. We re-attach the brace before parsing.
        if json_schema is not None:
            messages.append({"role": "assistant", "content": "{"})

        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": _MAX_TOKENS,
            "temperature": temperature,
            "system": system_prompt,
            "messages": messages,
        }

        async with httpx.AsyncClient(timeout=120) as client:
            response = await post_with_retry(
                client, self.endpoint, headers=self._headers(), json=body
            )
            data = response.json()

        text = "".join(
            block.get("text", "") for block in data.get("content", []) if block.get("type") == "text"
        )
        usage = data.get("usage") or {}
        input_tokens = usage.get("input_tokens")
        output_tokens = usage.get("output_tokens")

        if json_schema is not None:
            raw_text = "{" + text
            try:
                parsed = json.loads(raw_text)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Provider lieferte kein valides JSON: {exc}") from exc
        else:
            raw_text = text
            parsed = {"text": raw_text}

        return CompletionResult(
            parsed=parsed,
            raw_text=raw_text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=estimate_cost(self.name, self.model, input_tokens, output_tokens),
        )
