"""Tests for the subset market-data refresh.

Covers:
* `start_subset_refresh_background` creates a RunLog scoped to the chosen
  ISINs and seeds only those RunStockStatus rows.
* Lock contention and empty/unknown ISIN handling.
* `_execute_refresh(..., isins=[...])` processes only the subset, leaving
  other stocks untouched.
* `POST /jobs/refresh-all` still triggers a full run with no body and routes
  to the subset path when ISINs are supplied.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.core.time import utcnow
from app.db.session import SessionLocal
from app.main import app
from app.models.run_log import JobLock, RunLog, RunStockStatus
from app.models.stock import MarketData, Metrics, Stock
from app.providers.market.base import MarketProvider, MetricsData, QuoteData
from app.services import scheduler_service as ss


def _login(client: TestClient) -> str:
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "changeme"})
    assert resp.status_code == 200
    return resp.json()["csrf_token"]


@pytest.fixture(autouse=True)
def _reset_state():
    def _wipe() -> None:
        db = SessionLocal()
        try:
            db.query(RunStockStatus).delete()
            db.query(RunLog).delete()
            db.query(JobLock).delete()
            db.query(MarketData).delete()
            db.query(Metrics).delete()
            db.query(Stock).filter(Stock.isin.like("TEST%")).delete()
            db.commit()
        finally:
            db.close()

    _wipe()
    with ss._cancel_lock:
        ss._cancelled_run_ids.clear()
    yield
    _wipe()


def _seed_stocks(*isins: str) -> None:
    db = SessionLocal()
    try:
        for isin in isins:
            db.add(Stock(isin=isin, name=f"Co {isin}", sector="Tech", currency="EUR"))
        db.commit()
    finally:
        db.close()


class _FakeProvider(MarketProvider):
    async def resolve_symbol(self, *, isin: str, name=None, yahoo_link=None):
        return "FAKE"

    async def fetch_quote(self, symbol: str) -> QuoteData:
        return QuoteData(current_price=42.0, day_change_pct=1.5, currency="EUR")

    async def fetch_metrics(self, symbol: str) -> MetricsData:
        return MetricsData(pe_forward=18.0, dividend_yield_current=2.5)


# ---------------------------------------------------------------------------
# start_subset_refresh_background
# ---------------------------------------------------------------------------


def test_subset_refresh_scopes_run_to_selected_isins(monkeypatch) -> None:
    _seed_stocks("TEST00000001", "TEST00000002", "TEST00000003")
    submitted: list = []
    monkeypatch.setattr(ss.refresh_worker, "submit", lambda factory: submitted.append(factory))

    result = ss.start_subset_refresh_background(["TEST00000001", "TEST00000003"])
    assert result["status"] == "started"
    assert result["phase"] == "queued"

    db = SessionLocal()
    try:
        run = db.get(RunLog, result["run_id"])
        assert run is not None
        assert run.stocks_total == 2
        rows = (
            db.query(RunStockStatus)
            .filter(RunStockStatus.run_id == run.id)
            .all()
        )
        assert {r.isin for r in rows} == {"TEST00000001", "TEST00000003"}
    finally:
        db.close()
    assert len(submitted) == 1


def test_subset_refresh_normalises_and_dedupes_isins(monkeypatch) -> None:
    _seed_stocks("TEST00000001")
    monkeypatch.setattr(ss.refresh_worker, "submit", lambda factory: None)

    # lower-case + whitespace + duplicate should resolve to one matched stock.
    result = ss.start_subset_refresh_background([" test00000001 ", "TEST00000001"])
    assert result["status"] == "started"

    db = SessionLocal()
    try:
        run = db.get(RunLog, result["run_id"])
        assert run is not None and run.stocks_total == 1
    finally:
        db.close()


def test_subset_refresh_empty_list_returns_not_found(monkeypatch) -> None:
    monkeypatch.setattr(ss.refresh_worker, "submit", lambda factory: None)
    assert ss.start_subset_refresh_background([]) == {
        "run_id": None,
        "phase": None,
        "status": "not_found",
    }


def test_subset_refresh_unknown_isins_returns_not_found(monkeypatch) -> None:
    monkeypatch.setattr(ss.refresh_worker, "submit", lambda factory: None)
    assert ss.start_subset_refresh_background(["TEST00000404"])["status"] == "not_found"


def test_subset_refresh_returns_already_running_when_locked(monkeypatch) -> None:
    _seed_stocks("TEST00000001")
    monkeypatch.setattr(ss.refresh_worker, "submit", lambda factory: None)

    db = SessionLocal()
    try:
        existing = RunLog(phase="running", started_at=utcnow())
        db.add(existing)
        db.commit()
        existing_id = existing.id
        db.add(
            JobLock(
                name=ss._LOCK_NAME,
                locked=True,
                owner="other-process",
                acquired_at=utcnow(),
                heartbeat_at=utcnow(),
            )
        )
        db.commit()
    finally:
        db.close()

    result = ss.start_subset_refresh_background(["TEST00000001"])
    assert result["status"] == "already_running"
    assert result["run_id"] == existing_id

    db = SessionLocal()
    try:
        assert db.query(RunLog).count() == 1
    finally:
        db.close()


# ---------------------------------------------------------------------------
# _execute_refresh with an ISIN filter
# ---------------------------------------------------------------------------


def test_execute_refresh_processes_only_the_subset(monkeypatch) -> None:
    _seed_stocks("TEST00000010", "TEST00000011", "TEST00000012")
    monkeypatch.setattr(ss.refresh_worker, "submit", lambda factory: None)
    monkeypatch.setattr(ss.refresh_runner, "YFinanceProvider", lambda: _FakeProvider())

    subset = ["TEST00000010", "TEST00000011"]
    start = ss.start_subset_refresh_background(subset)
    run_id = start["run_id"]
    assert run_id is not None

    asyncio.run(ss._execute_refresh(run_id, ss._process_owner(), isins=subset))

    db = SessionLocal()
    try:
        run = db.get(RunLog, run_id)
        assert run is not None
        assert run.phase == "finished"
        assert run.status == "ok"
        assert run.stocks_done == 2
        assert run.stocks_success == 2

        done_isins = {
            r.isin
            for r in db.query(RunStockStatus).filter(RunStockStatus.run_id == run_id).all()
            if r.overall_status == "done"
        }
        assert done_isins == {"TEST00000010", "TEST00000011"}

        # The unselected stock must not have been refreshed at all.
        assert db.get(MarketData, "TEST00000012") is None
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Endpoint routing
# ---------------------------------------------------------------------------


def _fake_refresh_helpers(monkeypatch, calls: dict) -> None:
    def fake_full(*, manual):
        calls["full"] = manual
        return {"run_id": 1, "phase": "queued", "status": "started"}

    def fake_subset(isins):
        calls["subset"] = isins
        return {"run_id": 2, "phase": "queued", "status": "started"}

    monkeypatch.setattr("app.api.v1.jobs.start_refresh_all_background", fake_full)
    monkeypatch.setattr("app.api.v1.jobs.start_subset_refresh_background", fake_subset)


def test_refresh_all_endpoint_no_body_triggers_full_run(monkeypatch) -> None:
    calls: dict = {}
    _fake_refresh_helpers(monkeypatch, calls)

    client = TestClient(app)
    csrf = _login(client)
    resp = client.post("/api/v1/jobs/refresh-all", headers={"X-CSRF-Token": csrf})
    assert resp.status_code == 200
    assert calls == {"full": True}


def test_refresh_all_endpoint_with_isins_triggers_subset(monkeypatch) -> None:
    calls: dict = {}
    _fake_refresh_helpers(monkeypatch, calls)

    client = TestClient(app)
    csrf = _login(client)
    resp = client.post(
        "/api/v1/jobs/refresh-all",
        json={"isins": ["TEST00000001"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 200
    assert calls == {"subset": ["TEST00000001"]}
