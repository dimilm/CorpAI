"""Tests for the AI batch RunLog bracket and its progress endpoints.

The batch endpoint wraps every queued ``(agent, stock)`` pair in a single
``RunLog`` (``run_type='ai'``) so the frontend can reuse the existing RunLog
progress machinery. These tests assert the wiring (bracket creation, the
``/run-logs/{id}/ai`` detail shape, and the cancel endpoint) without making
real LLM calls — the serial background task is patched out.
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.models.ai_run import AIRun
from app.models.run_log import RunLog
from app.models.stock import Stock


def _login(client: TestClient) -> str:
    resp = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "changeme"}
    )
    assert resp.status_code == 200
    return resp.json()["csrf_token"]


@pytest.fixture(autouse=True)
def _cleanup() -> None:
    def _wipe() -> None:
        db = SessionLocal()
        try:
            db.query(AIRun).filter(AIRun.isin.like("BAT%")).delete(
                synchronize_session=False
            )
            db.query(Stock).filter(Stock.isin.like("BAT%")).delete(
                synchronize_session=False
            )
            db.query(RunLog).filter(RunLog.run_type == "ai").delete(
                synchronize_session=False
            )
            db.commit()
        finally:
            db.close()

    _wipe()
    yield
    _wipe()


def _seed_stocks() -> list[str]:
    db = SessionLocal()
    try:
        isins = ["BAT000000001", "BAT000000002"]
        db.add(Stock(isin=isins[0], name="Batch Co One"))
        db.add(Stock(isin=isins[1], name="Batch Co Two"))
        db.commit()
        return isins
    finally:
        db.close()


def test_batch_creates_runlog_bracket_and_stamps_runs() -> None:
    isins = _seed_stocks()
    client = TestClient(app)
    csrf = _login(client)

    # Patch the serial executor so no real LLM call happens; we only assert
    # the synchronous wiring (RunLog bracket + AIRun.batch_run_id stamping).
    with patch("app.api.v1.ai.execute_batch_in_background"):
        resp = client.post(
            "/api/v1/ai/runs/batch",
            headers={"X-CSRF-Token": csrf},
            json={"agent_ids": ["fisher"], "isins": isins},
        )
    assert resp.status_code == 202
    body = resp.json()

    run_id = body["run_id"]
    assert run_id is not None
    assert len(body["queued"]) == 2
    assert body["skipped"] == []

    db = SessionLocal()
    try:
        run_log = db.get(RunLog, run_id)
        assert run_log is not None
        assert run_log.run_type == "ai"
        assert run_log.stocks_total == 2
        stamped = (
            db.query(AIRun).filter(AIRun.batch_run_id == run_id).count()
        )
        assert stamped == 2
    finally:
        db.close()

    # Detail endpoint returns one row per queued pair with names backfilled.
    detail = client.get(f"/api/v1/run-logs/{run_id}/ai")
    assert detail.status_code == 200
    rows = detail.json()
    assert len(rows) == 2
    assert {r["isin"] for r in rows} == set(isins)
    assert all(r["agent_id"] == "fisher" for r in rows)
    assert all(r["status"] == "running" for r in rows)
    names = {r["stock_name"] for r in rows}
    assert names == {"Batch Co One", "Batch Co Two"}


def test_batch_with_no_valid_pairs_returns_null_run_id() -> None:
    client = TestClient(app)
    csrf = _login(client)
    with patch("app.api.v1.ai.execute_batch_in_background") as task:
        resp = client.post(
            "/api/v1/ai/runs/batch",
            headers={"X-CSRF-Token": csrf},
            json={"agent_ids": ["fisher"], "isins": ["BAT099999999"]},
        )
    assert resp.status_code == 202
    body = resp.json()
    assert body["run_id"] is None
    assert body["queued"] == []
    assert len(body["skipped"]) == 1
    task.assert_not_called()


def test_ai_detail_endpoint_validates_run_type() -> None:
    db = SessionLocal()
    try:
        market = RunLog(run_type="market", stocks_total=0, phase="finished", status="ok")
        db.add(market)
        db.commit()
        market_id = market.id
    finally:
        db.close()

    client = TestClient(app)
    _login(client)

    assert client.get("/api/v1/run-logs/99999999/ai").status_code == 404
    resp = client.get(f"/api/v1/run-logs/{market_id}/ai")
    assert resp.status_code == 400

    db = SessionLocal()
    try:
        db.query(RunLog).filter(RunLog.id == market_id).delete(
            synchronize_session=False
        )
        db.commit()
    finally:
        db.close()


def test_cancel_endpoint_targets_latest_unfinished_ai_run() -> None:
    db = SessionLocal()
    try:
        run = RunLog(run_type="ai", stocks_total=3, phase="running", status="ok")
        db.add(run)
        db.commit()
        run_id = run.id
    finally:
        db.close()

    client = TestClient(app)
    csrf = _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch/cancel", headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cancelled"] is True
    assert body["run_id"] == run_id


def test_cancel_endpoint_no_active_run() -> None:
    client = TestClient(app)
    csrf = _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch/cancel", headers={"X-CSRF-Token": csrf}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["cancelled"] is False
    assert body["run_id"] is None
