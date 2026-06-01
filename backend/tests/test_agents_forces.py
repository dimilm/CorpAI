"""Tests for the Porter's Five Forces agent."""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.agents.forces.agent import FiveForcesAgent
from app.agents.forces.schema import FiveForcesResult
from app.db.session import SessionLocal
from app.models.ai_run import AIRun
from app.models.stock import Stock
from app.providers.ai.base import AIProvider, CompletionResult


class _StubProvider(AIProvider):
    name = "stub"
    model = "stub-model"

    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    async def ping(self) -> None:
        return None

    async def complete(self, system_prompt, user_prompt, json_schema=None, temperature=0.2):
        return CompletionResult(parsed=self._payload, raw_text="{}")


def _payload() -> dict[str, Any]:
    return {
        "forces": [
            {
                "force": "new_entrants",
                "intensity": "low",
                "rationale": "Hohe Eintrittsbarrieren durch Kapitalbedarf.",
                "drivers": ["Kapitalbedarf", "Regulierung"],
            },
            {
                "force": "rivalry",
                "intensity": "high",
                "rationale": "Viele etablierte Wettbewerber.",
                "drivers": [],
            },
        ],
        "industry_attractiveness": "neutral",
        "summary": "Gemischtes Strukturbild.",
    }


@pytest.fixture(autouse=True)
def _cleanup() -> None:
    db = SessionLocal()
    try:
        db.query(AIRun).filter(AIRun.isin.like("FORC%")).delete()
        db.query(Stock).filter(Stock.isin.like("FORC%")).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(AIRun).filter(AIRun.isin.like("FORC%")).delete()
        db.query(Stock).filter(Stock.isin.like("FORC%")).delete()
        db.commit()
    finally:
        db.close()


def test_forces_run_validates_and_persists() -> None:
    db = SessionLocal()
    try:
        stock = Stock(isin="FORC00000001", name="Forces Test", sector="Industrials")
        db.add(stock)
        db.commit()
        run = asyncio.run(
            FiveForcesAgent().run(db, _StubProvider(_payload()), db.get(Stock, stock.isin))
        )
    finally:
        db.close()
    assert run.status == "done"
    parsed = FiveForcesResult.model_validate(run.result_payload)
    assert parsed.industry_attractiveness == "neutral"
    assert {f.force for f in parsed.forces} == {"new_entrants", "rivalry"}


def test_forces_run_rejects_invalid_intensity() -> None:
    bad = _payload()
    bad["forces"][0]["intensity"] = "extreme"  # not in Literal
    db = SessionLocal()
    try:
        stock = Stock(isin="FORC00000002", name="Bad Intensity")
        db.add(stock)
        db.commit()
        run = asyncio.run(
            FiveForcesAgent().run(db, _StubProvider(bad), db.get(Stock, stock.isin))
        )
    finally:
        db.close()
    assert run.status == "error"
    assert run.error_text
