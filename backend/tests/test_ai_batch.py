"""Tests for the AI batch endpoint (`POST /api/v1/ai/runs/batch`).

The background runner is monkeypatched to a no-op so the tests exercise only
the queue/skip bookkeeping without making real provider calls.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import app.api.v1.ai as ai_router
from app.db.session import SessionLocal
from app.main import app
from app.models.ai_run import AIRun
from app.models.stock import Stock


def _login(client: TestClient) -> str:
    resp = client.post("/api/v1/auth/login", json={"username": "admin", "password": "changeme"})
    assert resp.status_code == 200
    return resp.json()["csrf_token"]


@pytest.fixture(autouse=True)
def _cleanup() -> None:
    def _wipe() -> None:
        db = SessionLocal()
        try:
            db.query(AIRun).filter(AIRun.isin.like("BATCH%")).delete()
            db.query(Stock).filter(Stock.isin.like("BATCH%")).delete()
            db.commit()
        finally:
            db.close()

    _wipe()
    yield
    _wipe()


@pytest.fixture
def _no_background(monkeypatch: pytest.MonkeyPatch) -> list:
    """Replace the serial runner with a recorder so no LLM calls happen."""
    captured: list = []

    async def _fake(items: list, run_log_id: int) -> None:
        captured.extend(items)

    monkeypatch.setattr(ai_router, "execute_batch_in_background", _fake)
    return captured


def _seed_stocks(*isins: str) -> None:
    db = SessionLocal()
    try:
        for isin in isins:
            db.add(Stock(isin=isin, name=f"Batch {isin}"))
        db.commit()
    finally:
        db.close()


def _running_count() -> int:
    db = SessionLocal()
    try:
        return (
            db.query(AIRun)
            .filter(AIRun.isin.like("BATCH%"), AIRun.status == "running")
            .count()
        )
    finally:
        db.close()


def test_batch_queues_cartesian_product(_no_background: list) -> None:
    _seed_stocks("BATCH0000001", "BATCH0000002")
    client = TestClient(app)
    csrf = _login(client)

    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={"agent_ids": ["fisher", "redflag"], "isins": ["BATCH0000001", "BATCH0000002"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert len(body["queued"]) == 4
    assert body["skipped"] == []
    assert all(item["run_id"] is not None for item in body["queued"])
    assert _running_count() == 4
    # The single serial task received all four queued runs.
    assert len(_no_background) == 4


def test_batch_requires_csrf() -> None:
    client = TestClient(app)
    _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={"agent_ids": ["fisher"], "isins": ["BATCH0000001"]},
    )
    assert resp.status_code == 403


def test_batch_skips_unknown_agent_and_stock(_no_background: list) -> None:
    _seed_stocks("BATCH0000003")
    client = TestClient(app)
    csrf = _login(client)

    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={
            "agent_ids": ["fisher", "does-not-exist"],
            "isins": ["BATCH0000003", "BATCH9999999"],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    # Only fisher × BATCH0000003 is valid.
    assert len(body["queued"]) == 1
    assert body["queued"][0] == {
        "agent_id": "fisher",
        "isin": "BATCH0000003",
        "run_id": body["queued"][0]["run_id"],
        "status": "queued",
        "reason": None,
    }
    reasons = {(s["agent_id"], s["reason"]) for s in body["skipped"]}
    assert ("does-not-exist", "Agent unbekannt") in reasons
    assert ("fisher", "Aktie nicht gefunden") in reasons


def test_batch_skips_pair_already_running(_no_background: list) -> None:
    _seed_stocks("BATCH0000004")
    db = SessionLocal()
    try:
        from app.core.time import utcnow

        db.add(
            AIRun(
                isin="BATCH0000004",
                agent_id="fisher",
                created_at=utcnow(),
                provider="pending",
                model="pending",
                status="running",
                input_payload={},
            )
        )
        db.commit()
    finally:
        db.close()

    client = TestClient(app)
    csrf = _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={"agent_ids": ["fisher", "redflag"], "isins": ["BATCH0000004"]},
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert [q["agent_id"] for q in body["queued"]] == ["redflag"]
    assert [(s["agent_id"], s["reason"]) for s in body["skipped"]] == [
        ("fisher", "läuft bereits")
    ]


def test_batch_deduplicates_repeated_pairs(_no_background: list) -> None:
    _seed_stocks("BATCH0000005")
    client = TestClient(app)
    csrf = _login(client)
    resp = client.post(
        "/api/v1/ai/runs/batch",
        json={
            "agent_ids": ["fisher", "fisher"],
            "isins": ["BATCH0000005", "batch0000005"],
        },
        headers={"X-CSRF-Token": csrf},
    )
    assert resp.status_code == 202
    body = resp.json()
    assert len(body["queued"]) == 1
    assert _running_count() == 1
