"""Tests for the generic LLM provider strategy classes.

Tests stay offline – we mock httpx.AsyncClient so we never hit OpenAI,
Gemini or a local Ollama instance in CI.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.providers.ai.anthropic_provider import AnthropicProvider
from app.providers.ai.claudecode_provider import ClaudeCodeProvider
from app.providers.ai.gemini_provider import GeminiProvider
from app.providers.ai.ollama_provider import OllamaProvider
from app.providers.ai.openai_provider import OpenAIProvider


def _mock_async_client(json_payload: dict[str, Any]) -> Any:
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.json = MagicMock(return_value=json_payload)

    async_client = MagicMock()
    async_client.post = AsyncMock(return_value=response)
    async_client.get = AsyncMock(return_value=response)

    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=async_client)
    cm.__aexit__ = AsyncMock(return_value=None)
    return cm, async_client


# ---------------------------------------------------------------------------
# OpenAI
# ---------------------------------------------------------------------------


def test_openai_complete_returns_parsed_json_and_token_metadata() -> None:
    payload = {
        "choices": [{"message": {"content": json.dumps({"score": 7})}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 20},
    }
    cm, _ = _mock_async_client(payload)
    provider = OpenAIProvider(endpoint="https://api.test", model="gpt-4o-mini", api_key="sk-key")

    with patch("app.providers.ai.openai_provider.httpx.AsyncClient", return_value=cm):
        result = asyncio.run(
            provider.complete("system", "user", json_schema={"type": "object"})
        )

    assert result.parsed == {"score": 7}
    assert result.input_tokens == 100
    assert result.output_tokens == 20
    assert result.estimated_cost is not None and result.estimated_cost > 0


def test_openai_complete_without_schema_wraps_text() -> None:
    payload = {
        "choices": [{"message": {"content": "hello"}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 1},
    }
    cm, _ = _mock_async_client(payload)
    provider = OpenAIProvider(endpoint="https://api.test", model="gpt-4o-mini", api_key="sk-key")

    with patch("app.providers.ai.openai_provider.httpx.AsyncClient", return_value=cm):
        result = asyncio.run(provider.complete("system", "user"))

    assert result.parsed == {"text": "hello"}
    assert result.raw_text == "hello"


def test_openai_ping_without_key_raises() -> None:
    provider = OpenAIProvider(endpoint="https://invalid.example", model="gpt-4o-mini", api_key=None)
    with pytest.raises(ValueError, match="API-Key"):
        asyncio.run(provider.ping())


def test_openai_ping_unreachable_endpoint_raises() -> None:
    provider = OpenAIProvider(
        endpoint="http://127.0.0.1:1/does-not-exist",
        model="gpt-4o-mini",
        api_key="sk-fake",
    )
    with pytest.raises(Exception):
        asyncio.run(provider.ping())


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------


def test_gemini_complete_returns_parsed_json() -> None:
    payload = {
        "candidates": [{"content": {"parts": [{"text": json.dumps({"verdict": "ok"})}]}}],
        "usageMetadata": {"promptTokenCount": 50, "candidatesTokenCount": 10},
    }
    cm, _ = _mock_async_client(payload)
    provider = GeminiProvider(
        endpoint="https://generativelanguage.googleapis.com/v1beta",
        model="gemini-1.5-flash",
        api_key="fake-key",
    )

    with patch("app.providers.ai.gemini_provider.httpx.AsyncClient", return_value=cm):
        result = asyncio.run(
            provider.complete("system", "user", json_schema={"type": "object"})
        )

    assert result.parsed == {"verdict": "ok"}
    assert result.input_tokens == 50
    assert result.output_tokens == 10


def test_gemini_ping_without_key_raises() -> None:
    provider = GeminiProvider(
        endpoint="https://generativelanguage.googleapis.com/v1beta",
        model="gemini-1.5-flash",
        api_key=None,
    )
    with pytest.raises(ValueError, match="API-Key"):
        asyncio.run(provider.ping())


def test_gemini_ping_unreachable_endpoint_raises() -> None:
    provider = GeminiProvider(
        endpoint="http://127.0.0.1:1/does-not-exist",
        model="gemini-1.5-flash",
        api_key="fake-key",
    )
    with pytest.raises(Exception):
        asyncio.run(provider.ping())


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------


def test_anthropic_complete_returns_parsed_json_and_token_metadata() -> None:
    # The provider prefills the assistant turn with "{", so the API echoes
    # only the remainder of the object.
    payload = {
        "content": [{"type": "text", "text": '"score": 7}'}],
        "usage": {"input_tokens": 120, "output_tokens": 15},
    }
    cm, client = _mock_async_client(payload)
    provider = AnthropicProvider(
        endpoint="https://api.anthropic.com/v1/messages",
        model="claude-sonnet-4-6",
        api_key="sk-ant-key",
    )

    with patch("app.providers.ai.anthropic_provider.httpx.AsyncClient", return_value=cm):
        result = asyncio.run(
            provider.complete("system", "user", json_schema={"type": "object"})
        )

    assert result.parsed == {"score": 7}
    assert result.raw_text == '{"score": 7}'
    assert result.input_tokens == 120
    assert result.output_tokens == 15
    assert result.estimated_cost is not None and result.estimated_cost > 0

    # System prompt is a top-level field, not a role:system message, and the
    # JSON path prefills an assistant turn opening the object.
    sent_body = client.post.call_args.kwargs["json"]
    assert sent_body["system"] == "system"
    assert sent_body["messages"][-1] == {"role": "assistant", "content": "{"}


def test_anthropic_complete_without_schema_wraps_text() -> None:
    payload = {
        "content": [{"type": "text", "text": "hello"}],
        "usage": {"input_tokens": 5, "output_tokens": 1},
    }
    cm, _ = _mock_async_client(payload)
    provider = AnthropicProvider(
        endpoint="https://api.anthropic.com/v1/messages",
        model="claude-sonnet-4-6",
        api_key="sk-ant-key",
    )

    with patch("app.providers.ai.anthropic_provider.httpx.AsyncClient", return_value=cm):
        result = asyncio.run(provider.complete("system", "user"))

    assert result.parsed == {"text": "hello"}
    assert result.raw_text == "hello"


def test_anthropic_ping_without_key_raises() -> None:
    provider = AnthropicProvider(
        endpoint="https://api.anthropic.com/v1/messages",
        model="claude-sonnet-4-6",
        api_key=None,
    )
    with pytest.raises(ValueError, match="API-Key"):
        asyncio.run(provider.ping())


def test_anthropic_ping_unreachable_endpoint_raises() -> None:
    provider = AnthropicProvider(
        endpoint="http://127.0.0.1:1/does-not-exist",
        model="claude-sonnet-4-6",
        api_key="sk-ant-fake",
    )
    with pytest.raises(Exception):
        asyncio.run(provider.ping())


# ---------------------------------------------------------------------------
# Ollama
# ---------------------------------------------------------------------------


def test_ollama_complete_returns_parsed_json() -> None:
    payload = {
        "response": json.dumps({"flag": "low"}),
        "prompt_eval_count": 30,
        "eval_count": 8,
    }
    cm, _ = _mock_async_client(payload)
    provider = OllamaProvider(endpoint="http://localhost:11434/api/generate", model="llama3")

    with patch("app.providers.ai.ollama_provider.httpx.AsyncClient", return_value=cm):
        result = asyncio.run(
            provider.complete("system", "user", json_schema={"type": "object"})
        )

    assert result.parsed == {"flag": "low"}
    assert result.input_tokens == 30
    assert result.output_tokens == 8
    assert result.estimated_cost == 0.0


def test_ollama_ping_unreachable_endpoint_raises() -> None:
    provider = OllamaProvider(endpoint="http://127.0.0.1:1/api/generate", model="llama3")
    with pytest.raises(Exception):
        asyncio.run(provider.ping())


# ---------------------------------------------------------------------------
# Claude Code (CLI subprocess, subscription auth — no API key)
# ---------------------------------------------------------------------------


def _mock_claude_proc(
    envelope: dict[str, Any] | str, returncode: int = 0, stderr: str = ""
) -> Any:
    """Build a fake `subprocess.CompletedProcess` for the CLI call.

    The provider runs the CLI via the blocking `subprocess.run` (offloaded to a
    thread), not asyncio's subprocess API — so tests mock `subprocess.run` and
    receive a completed-process stand-in with bytes stdout/stderr.
    """
    stdout = (envelope if isinstance(envelope, str) else json.dumps(envelope)).encode("utf-8")
    completed = MagicMock()
    completed.returncode = returncode
    completed.stdout = stdout
    completed.stderr = stderr.encode("utf-8")
    return completed


def test_claudecode_complete_reads_structured_output() -> None:
    # In schema mode the parsed object lives in `structured_output`; `result` is noise.
    envelope = {
        "is_error": False,
        "result": "free-text noise that must be ignored",
        "structured_output": {"score": 9},
        "usage": {"input_tokens": 42, "output_tokens": 7},
    }
    completed = _mock_claude_proc(envelope)
    provider = ClaudeCodeProvider(model="sonnet")

    with patch(
        "app.providers.ai.claudecode_provider.shutil.which", return_value="/usr/bin/claude"
    ), patch(
        "app.providers.ai.claudecode_provider.subprocess.run",
        return_value=completed,
    ) as spawn:
        result = asyncio.run(
            provider.complete("system", "user", json_schema={"type": "object"})
        )

    assert result.parsed == {"score": 9}
    assert result.input_tokens == 42
    assert result.output_tokens == 7
    assert result.estimated_cost == 0.0
    # Schema mode passes --json-schema; the user prompt is fed via stdin.
    cmd = spawn.call_args.args[0]
    assert "--json-schema" in cmd
    assert spawn.call_args.kwargs["input"] == b"user"


def test_claudecode_complete_without_schema_wraps_result_text() -> None:
    envelope = {"is_error": False, "result": "plain answer", "usage": {}}
    completed = _mock_claude_proc(envelope)
    provider = ClaudeCodeProvider(model="sonnet")

    with patch(
        "app.providers.ai.claudecode_provider.shutil.which", return_value="/usr/bin/claude"
    ), patch(
        "app.providers.ai.claudecode_provider.subprocess.run",
        return_value=completed,
    ):
        result = asyncio.run(provider.complete("system", "user"))

    assert result.parsed == {"text": "plain answer"}
    assert result.raw_text == "plain answer"


def test_claudecode_complete_nonzero_exit_raises() -> None:
    completed = _mock_claude_proc("", returncode=1, stderr="not logged in")
    provider = ClaudeCodeProvider(model="sonnet")

    with patch(
        "app.providers.ai.claudecode_provider.shutil.which", return_value="/usr/bin/claude"
    ), patch(
        "app.providers.ai.claudecode_provider.subprocess.run",
        return_value=completed,
    ):
        with pytest.raises(ValueError, match="not logged in"):
            asyncio.run(
                provider.complete("system", "user", json_schema={"type": "object"})
            )


def test_claudecode_complete_timeout_raises() -> None:
    provider = ClaudeCodeProvider(model="sonnet")

    with patch(
        "app.providers.ai.claudecode_provider.shutil.which", return_value="/usr/bin/claude"
    ), patch(
        "app.providers.ai.claudecode_provider.subprocess.run",
        side_effect=subprocess.TimeoutExpired(cmd="claude", timeout=600),
    ):
        with pytest.raises(ValueError, match="nicht geantwortet"):
            asyncio.run(
                provider.complete("system", "user", json_schema={"type": "object"})
            )


def test_claudecode_missing_cli_raises() -> None:
    provider = ClaudeCodeProvider(model="sonnet")
    with patch("app.providers.ai.claudecode_provider.shutil.which", return_value=None):
        with pytest.raises(ValueError, match="nicht gefunden"):
            asyncio.run(provider.ping())


def test_claudecode_complete_enables_web_tools_by_default() -> None:
    completed = _mock_claude_proc(
        {"is_error": False, "structured_output": {"score": 1}, "usage": {}}
    )
    provider = ClaudeCodeProvider(model="sonnet")  # enable_web defaults to True

    with patch(
        "app.providers.ai.claudecode_provider.shutil.which", return_value="/usr/bin/claude"
    ), patch(
        "app.providers.ai.claudecode_provider.subprocess.run",
        return_value=completed,
    ) as spawn:
        asyncio.run(provider.complete("system", "user", json_schema={"type": "object"}))

    cmd = spawn.call_args.args[0]
    assert "--tools" in cmd and "--allowed-tools" in cmd
    assert "WebSearch" in cmd and "WebFetch" in cmd
    # Read-only research only — never file/Bash tools.
    assert "Bash" not in cmd and "Edit" not in cmd


def test_claudecode_complete_web_tools_can_be_disabled() -> None:
    completed = _mock_claude_proc(
        {"is_error": False, "structured_output": {"score": 1}, "usage": {}}
    )
    provider = ClaudeCodeProvider(model="sonnet", enable_web=False)

    with patch(
        "app.providers.ai.claudecode_provider.shutil.which", return_value="/usr/bin/claude"
    ), patch(
        "app.providers.ai.claudecode_provider.subprocess.run",
        return_value=completed,
    ) as spawn:
        asyncio.run(provider.complete("system", "user", json_schema={"type": "object"}))

    assert "--tools" not in spawn.call_args.args[0]
