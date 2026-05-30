"""Claude Code CLI provider — uses the locally authenticated Claude Code
subscription instead of a metered API key.

Each completion shells out to the ``claude`` CLI in headless mode
(``claude -p --output-format json``). The CLI authenticates via the local OAuth
credentials in ``~/.claude``, so no API key is required. This only works on a
machine where Claude Code is installed and logged in (local/dev use) — it is
intentionally not wired up for the Docker deployment.

Note on structured output: with ``--json-schema`` the CLI enforces the schema
through an internal ``StructuredOutput`` step and returns the parsed object under
the envelope's ``structured_output`` key. The free-text ``result`` field is
unreliable noise in that mode, so we read ``structured_output`` for schema calls
and ``result`` only for plain-text calls.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
from typing import Any

from app.providers.ai.base import AIProvider, CompletionResult

# Research runs (web search across many questions) can take minutes; ping and
# no-tool completions still return in seconds well under this ceiling.
_TIMEOUT_SECONDS = 600

# The only tools we expose to the headless CLI: read-only web research. We never
# grant file/Bash access. Listed under both --tools (restricts the available set)
# and --allowed-tools (pre-approves them so headless mode does not block on a
# permission prompt).
_WEB_TOOLS = ["WebSearch", "WebFetch"]

# Claude Code session env vars confuse a nested `claude` invocation (it thinks it
# runs inside another session). Strip them so the subprocess behaves like a fresh
# standalone call regardless of how the backend process was started.
_STRIP_ENV_PREFIXES = ("CLAUDE_CODE_", "CLAUDE_AGENT_")
_STRIP_ENV_KEYS = {"CLAUDECODE"}


class ClaudeCodeProvider(AIProvider):
    name = "claudecode"

    def __init__(self, model: str, cli_path: str = "claude", enable_web: bool = True) -> None:
        self.model = model or "sonnet"
        self.cli_path = cli_path or "claude"
        # When True, completions may use web research to ground qualitative
        # judgements (the unique advantage of this provider over the metered APIs).
        self.enable_web = enable_web

    def _resolve_cli(self) -> str:
        resolved = shutil.which(self.cli_path)
        if resolved is None:
            raise ValueError(
                f"Claude-Code-CLI '{self.cli_path}' nicht gefunden. "
                "Ist Claude Code installiert und auf dem PATH?"
            )
        return resolved

    def _clean_env(self) -> dict[str, str]:
        return {
            k: v
            for k, v in os.environ.items()
            if k not in _STRIP_ENV_KEYS and not k.startswith(_STRIP_ENV_PREFIXES)
        }

    async def _run_cli(self, args: list[str], stdin_text: str) -> dict[str, Any]:
        exe = self._resolve_cli()
        proc = await asyncio.create_subprocess_exec(
            exe,
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self._clean_env(),
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(stdin_text.encode("utf-8")),
                timeout=_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError as exc:
            proc.kill()
            await proc.wait()
            raise ValueError(
                f"Claude-Code-CLI hat nach {_TIMEOUT_SECONDS}s nicht geantwortet."
            ) from exc

        if proc.returncode != 0:
            detail = stderr.decode("utf-8", "replace").strip() or "unbekannter Fehler"
            raise ValueError(f"Claude-Code-CLI-Fehler (Exit {proc.returncode}): {detail}")

        try:
            envelope = json.loads(stdout.decode("utf-8", "replace"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Claude-Code-CLI lieferte kein valides JSON: {exc}") from exc

        if envelope.get("is_error"):
            raise ValueError(
                f"Claude-Code-CLI meldet Fehler: {envelope.get('result') or envelope}"
            )
        return envelope

    async def ping(self) -> None:
        args = [
            "-p",
            "--output-format",
            "json",
            "--model",
            self.model,
            "--no-session-persistence",
        ]
        await self._run_cli(args, "ping")

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        json_schema: dict[str, Any] | None = None,
        temperature: float = 0.2,
    ) -> CompletionResult:
        # The CLI exposes no temperature flag; the parameter is accepted to match
        # the AIProvider interface but ignored.
        args = [
            "-p",
            "--output-format",
            "json",
            "--model",
            self.model,
            "--no-session-persistence",
            "--system-prompt",
            system_prompt,
        ]
        if self.enable_web:
            args += ["--tools", *_WEB_TOOLS, "--allowed-tools", *_WEB_TOOLS]
        if json_schema is not None:
            args += ["--json-schema", json.dumps(json_schema)]

        envelope = await self._run_cli(args, user_prompt)

        usage = envelope.get("usage") or {}
        input_tokens = usage.get("input_tokens")
        output_tokens = usage.get("output_tokens")

        if json_schema is not None:
            parsed = envelope.get("structured_output")
            if not isinstance(parsed, dict):
                raise ValueError(
                    "Claude-Code-CLI lieferte kein strukturiertes Ergebnis "
                    "(structured_output fehlt)."
                )
            raw_text = json.dumps(parsed, ensure_ascii=False)
        else:
            raw_text = envelope.get("result", "") or ""
            parsed = {"text": raw_text}

        return CompletionResult(
            parsed=parsed,
            raw_text=raw_text,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            estimated_cost=0.0,
        )
