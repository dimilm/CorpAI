"""Tests for the bull-vs-bear debate agent (three-call orchestration)."""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.agents.debate.agent import DebateAgent
from app.agents.debate.schema import DebateResult
from app.db.session import SessionLocal
from app.models.ai_run import AIRun
from app.models.stock import Stock
from app.providers.ai.base import AIProvider, CompletionResult


class _SequentialProvider(AIProvider):
    """Returns successive payloads for each `complete()` call (bull, bear, judge)."""

    name = "stub"
    model = "stub-model"

    def __init__(self, payloads: list[dict[str, Any]]) -> None:
        self._payloads = list(payloads)

    async def ping(self) -> None:
        return None

    async def complete(self, system_prompt, user_prompt, json_schema=None, temperature=0.2):
        if not self._payloads:
            raise RuntimeError("Mehr Aufrufe als erwartet")
        payload = self._payloads.pop(0)
        return CompletionResult(parsed=payload, raw_text="{}", estimated_cost=0.0004)


def _payloads() -> list[dict[str, Any]]:
    return [
        {"arguments": ["Starkes Umsatzwachstum", "Breiter Burggraben"]},
        {"arguments": ["Hohe Bewertung", "Steigender Wettbewerb"]},
        {
            "winning_side": "bull",
            "conviction": "medium",
            "judge_rationale": "Bull überzeugt knapp dank Wachstum.",
            "summary": "Leicht positives Gesamtbild.",
        },
    ]


@pytest.fixture(autouse=True)
def _cleanup() -> None:
    db = SessionLocal()
    try:
        db.query(AIRun).filter(AIRun.isin.like("DEB%")).delete()
        db.query(Stock).filter(Stock.isin.like("DEB%")).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(AIRun).filter(AIRun.isin.like("DEB%")).delete()
        db.query(Stock).filter(Stock.isin.like("DEB%")).delete()
        db.commit()
    finally:
        db.close()


def test_debate_run_aggregates_three_calls() -> None:
    db = SessionLocal()
    try:
        stock = Stock(isin="DEB000000001", name="Debate Test")
        db.add(stock)
        db.commit()
        run = asyncio.run(
            DebateAgent().run(db, _SequentialProvider(_payloads()), db.get(Stock, stock.isin))
        )
    finally:
        db.close()
    assert run.status == "done"
    parsed = DebateResult.model_validate(run.result_payload)
    assert parsed.winning_side == "bull"
    assert parsed.conviction == "medium"
    assert parsed.bull_arguments == ["Starkes Umsatzwachstum", "Breiter Burggraben"]
    assert parsed.bear_arguments == ["Hohe Bewertung", "Steigender Wettbewerb"]
    # Three calls each report a cost → summed onto the run.
    assert run.cost_estimate is not None
    assert run.cost_estimate == pytest.approx(0.0012)


def test_debate_run_records_error_on_bad_judge_payload() -> None:
    payloads = _payloads()
    payloads[2] = {"winning_side": "nobody"}  # invalid verdict
    db = SessionLocal()
    try:
        stock = Stock(isin="DEB000000002", name="Bad Judge")
        db.add(stock)
        db.commit()
        run = asyncio.run(
            DebateAgent().run(db, _SequentialProvider(payloads), db.get(Stock, stock.isin))
        )
    finally:
        db.close()
    assert run.status == "error"
    assert run.error_text
