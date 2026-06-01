"""Tests for the reverse-DCF / intrinsic value agent."""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.agents.dcf.agent import DcfAgent
from app.agents.dcf.schema import DcfResult
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
        "forecast_years": 5,
        "discount_rate_pct": 8.5,
        "terminal_growth_pct": 2.0,
        "fair_value_low": 90.0,
        "fair_value_base": 120.0,
        "fair_value_high": 150.0,
        "current_price": 100.0,
        "upside_pct": 20.0,
        "margin_of_safety_pct": -10.0,
        "implied_growth_pct": 6.0,
        "implied_expectations": ["Umsatz wächst ~6 % p. a."],
        "key_assumptions": ["FCF-Marge stabil bei 20 %"],
        "verdict": "cheap",
        "summary": "Leicht unterbewertet.",
    }


@pytest.fixture(autouse=True)
def _cleanup() -> None:
    db = SessionLocal()
    try:
        db.query(AIRun).filter(AIRun.isin.like("DCF%")).delete()
        db.query(Stock).filter(Stock.isin.like("DCF%")).delete()
        db.commit()
    finally:
        db.close()
    yield
    db = SessionLocal()
    try:
        db.query(AIRun).filter(AIRun.isin.like("DCF%")).delete()
        db.query(Stock).filter(Stock.isin.like("DCF%")).delete()
        db.commit()
    finally:
        db.close()


def test_dcf_run_validates_and_persists() -> None:
    db = SessionLocal()
    try:
        stock = Stock(isin="DCF000000001", name="DCF Test")
        db.add(stock)
        db.commit()
        run = asyncio.run(
            DcfAgent().run(db, _StubProvider(_payload()), db.get(Stock, stock.isin))
        )
    finally:
        db.close()
    assert run.status == "done"
    parsed = DcfResult.model_validate(run.result_payload)
    assert parsed.verdict == "cheap"
    assert parsed.upside_pct == 20.0


def test_dcf_run_rejects_unordered_fair_values() -> None:
    bad = _payload()
    bad["fair_value_low"] = 200.0  # low > base must fail the ordering validator
    db = SessionLocal()
    try:
        stock = Stock(isin="DCF000000002", name="Bad Order")
        db.add(stock)
        db.commit()
        run = asyncio.run(
            DcfAgent().run(db, _StubProvider(bad), db.get(Stock, stock.isin))
        )
    finally:
        db.close()
    assert run.status == "error"
    assert run.error_text
