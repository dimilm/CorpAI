"""Bull-vs-Bear debate agent.

Three sequential LLM calls: a bull persona builds the strongest buy case, a
bear persona the strongest avoid case, and a judge weighs both and renders a
verdict with a conviction level. Modelled after the tournament agent's
multi-call `execute_run` override.

The single `prompt.md` holds all three role briefings, split on the
`## BULL` / `## BEAR` / `## RICHTER` headers, so the read-only "Prompt anzeigen"
modal still shows the full method in one place.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.agents.base import BaseAgent
from app.agents.context import build_stock_context
from app.agents.debate.schema import DebateResult, JudgeVerdict, SideArguments
from app.models.ai_run import AIRun
from app.models.stock import Stock
from app.providers.ai.base import AIProvider, CompletionResult

_ROLE_MARKERS = {"## BULL": "bull", "## BEAR": "bear", "## RICHTER": "judge"}


class DebateAgent(BaseAgent):
    id = "debate"
    name = "Bull-vs-Bear-Debatte"
    description = (
        "Lässt zwei gegnerische Personas die stärksten Kauf- und Gegenargumente "
        "formulieren und einen Richter ein Verdikt mit Konviktion fällen."
    )
    prompt_path = Path(__file__).with_name("prompt.md")
    output_schema = DebateResult

    def build_input(self, db: Session, stock: Stock, **_: Any) -> dict[str, Any]:
        return build_stock_context(db, stock)

    def _roles(self) -> dict[str, str]:
        """Split `prompt.md` into the bull / bear / judge role briefings.

        Text before the first marker (the human-facing method overview) is
        ignored as a role and only surfaces in the prompt modal.
        """
        roles: dict[str, str] = {}
        current: str | None = None
        buffer: list[str] = []
        for line in self.load_prompt().splitlines():
            marker = _ROLE_MARKERS.get(line.strip())
            if marker is not None:
                if current is not None:
                    roles[current] = "\n".join(buffer).strip()
                current = marker
                buffer = []
            elif current is not None:
                buffer.append(line)
        if current is not None:
            roles[current] = "\n".join(buffer).strip()
        return roles

    async def execute_run(  # type: ignore[override]
        self,
        db: Session,
        provider: AIProvider,
        run: AIRun,
        stock: Stock,
        **_: Any,
    ) -> AIRun:
        payload = run.input_payload
        provider_name = getattr(provider, "name", provider.__class__.__name__.lower())
        provider_model = getattr(provider, "model", "unknown")
        context_json = json.dumps(payload, ensure_ascii=False, indent=2)
        roles = self._roles()

        total_cost = 0.0
        cost_seen = False
        started = time.perf_counter()
        status = "done"
        error_text: str | None = None
        result_dict: dict[str, Any] | None = None
        try:
            bull, c1 = await self._side(provider, roles.get("bull", ""), context_json)
            bear, c2 = await self._side(provider, roles.get("bear", ""), context_json)
            judge_user = json.dumps(
                {
                    "context": payload,
                    "bull_arguments": bull.arguments,
                    "bear_arguments": bear.arguments,
                },
                ensure_ascii=False,
                indent=2,
            )
            verdict, c3 = await self._judge(provider, roles.get("judge", ""), judge_user)
            for cost in (c1, c2, c3):
                if cost is not None:
                    total_cost += cost
                    cost_seen = True
            result = DebateResult(
                bull_arguments=bull.arguments,
                bear_arguments=bear.arguments,
                winning_side=verdict.winning_side,
                conviction=verdict.conviction,
                judge_rationale=verdict.judge_rationale,
                summary=verdict.summary,
            )
            result_dict = result.model_dump(mode="json")
        except Exception as exc:
            status = "error"
            error_text = str(exc) or exc.__class__.__name__

        run.provider = provider_name
        run.model = provider_model
        run.status = status
        run.result_payload = result_dict
        run.error_text = error_text
        run.cost_estimate = total_cost if cost_seen else None
        run.duration_ms = int((time.perf_counter() - started) * 1000)
        db.add(run)
        db.commit()
        db.refresh(run)
        return run

    async def _side(
        self, provider: AIProvider, system_prompt: str, user_prompt: str
    ) -> tuple[SideArguments, float | None]:
        completion: CompletionResult = await provider.complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_schema=SideArguments.model_json_schema(),
        )
        return SideArguments.model_validate(completion.parsed), completion.estimated_cost

    async def _judge(
        self, provider: AIProvider, system_prompt: str, user_prompt: str
    ) -> tuple[JudgeVerdict, float | None]:
        completion: CompletionResult = await provider.complete(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            json_schema=JudgeVerdict.model_json_schema(),
        )
        return JudgeVerdict.model_validate(completion.parsed), completion.estimated_cost
